import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  DeleteUndoToken,
  Profile,
  ProjectSummary,
  Todo,
  UUID,
} from "../../types/domain";
import type {
  TodoRequestOptions,
  TodoService,
  UpdateTodoDetailsInput,
} from "./todoService";
import type {
  TodoLoadState,
  TodoMutationErrorKind,
} from "./todoUiState";
import {
  isDeleteUndoToken,
  readTodoResponse,
  readTodoWorkspaceSnapshot,
  todoMatchesDetails,
} from "./todoWorkspaceValidation";

export type TodoWorkspaceLoadState = TodoLoadState;

export interface TodoWorkspaceMutationResult {
  /** Monotonic for the lifetime of this controller instance. */
  readonly sequence: number;
  readonly todoId: UUID;
  readonly action: "complete" | "delete";
  readonly status: "succeeded" | "failed" | "cancelled";
}

export interface TodoWorkspaceUndoNotice {
  readonly todoId: UUID;
  readonly todoText: string;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}

export interface TodoWorkspaceController {
  readonly loadState: TodoWorkspaceLoadState;
  readonly profile: Profile | null;
  readonly projects: readonly ProjectSummary[];
  readonly todos: readonly Todo[];
  readonly pendingTodoIds: ReadonlySet<UUID>;
  readonly mutationResult: TodoWorkspaceMutationResult | null;
  readonly mutationError: TodoMutationErrorKind | null;
  readonly undoNotice: TodoWorkspaceUndoNotice | null;
  readonly retryLoad: () => void;
  /** Reconcile one persisted create response without reloading the workspace. */
  readonly acceptCreatedTodo: (todo: Todo) => boolean;
  /** Returns false when the row is absent or already has a mutation in flight. */
  readonly setCompleted: (todoId: UUID, completed: boolean) => boolean;
  /** Rejects safely so an edit form can retain its entered values for retry. */
  readonly updateDetails: (
    todoId: UUID,
    input: UpdateTodoDetailsInput,
    options?: TodoRequestOptions,
  ) => Promise<Todo>;
  /** Returns false when the row is absent or already has a mutation in flight. */
  readonly deleteTodo: (todoId: UUID) => boolean;
}

interface InternalUndoNotice {
  readonly todo: Todo;
  readonly originalIndex: number;
  readonly token: DeleteUndoToken;
  readonly pending: boolean;
  readonly error: string | null;
}

export class TodoMutationNotStartedError extends Error {
  constructor() {
    super("This todo is no longer available for editing.");
    this.name = "TodoMutationNotStartedError";
  }
}

export class TodoMutationFailedError extends Error {
  constructor() {
    super("The todo changes were not saved. Try again.");
    this.name = "TodoMutationFailedError";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Owns one authenticated Todo workspace without knowing the data provider.
 * Replacing or unmounting the service immediately clears user-scoped state and
 * aborts outstanding work, which keeps account changes fail closed.
 */
export function useTodoWorkspaceController(
  service: TodoService,
  /**
   * Identifies the mounted authenticated workspace solely for client-state
   * isolation. It is never sent to the provider or used to establish row
   * ownership; the provider must still derive ownership from its session.
   */
  workspaceSessionKey: string,
): TodoWorkspaceController {
  const [loadGeneration, setLoadGeneration] = useState(0);
  const [loadState, setLoadState] = useState<TodoWorkspaceLoadState>({
    status: "loading",
  });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [todos, setTodos] = useState<readonly Todo[]>([]);
  const [pendingTodoIds, setPendingTodoIds] = useState<ReadonlySet<UUID>>(
    () => new Set(),
  );
  const [mutationResult, setMutationResult] =
    useState<TodoWorkspaceMutationResult | null>(null);
  const [mutationError, setMutationError] =
    useState<TodoMutationErrorKind | null>(null);
  const [undo, setUndo] = useState<InternalUndoNotice | null>(null);

  const activeGenerationRef = useRef(0);
  const settlementSequenceRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());
  const todosRef = useRef<readonly Todo[]>([]);
  const pendingTodoIdsRef = useRef<ReadonlySet<UUID>>(new Set());
  const undoRef = useRef<InternalUndoNotice | null>(null);
  const readyRef = useRef(false);
  const workspaceSessionKeyRef = useRef(workspaceSessionKey);
  const activeServiceRef = useRef<TodoService | null>(service);
  const deleteInFlightRef = useRef(false);

  // Retained callbacks belong to the service/key pair that created them, even
  // after a replacement service has finished loading the same workspace.
  const isCurrentScope = useCallback(
    () =>
      activeServiceRef.current === service &&
      workspaceSessionKeyRef.current === workspaceSessionKey,
    [service, workspaceSessionKey],
  );

  const publishTodos = useCallback((next: readonly Todo[]) => {
    todosRef.current = next;
    setTodos(next);
  }, []);

  const publishPending = useCallback((next: ReadonlySet<UUID>) => {
    pendingTodoIdsRef.current = next;
    setPendingTodoIds(next);
  }, []);

  const publishUndo = useCallback((next: InternalUndoNotice | null) => {
    undoRef.current = next;
    setUndo(next);
  }, []);

  const abortOutstandingWork = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
  }, []);

  const retryLoad = useCallback(() => {
    if (!isCurrentScope()) return;
    activeGenerationRef.current += 1;
    readyRef.current = false;
    deleteInFlightRef.current = false;
    abortOutstandingWork();
    publishTodos([]);
    publishPending(new Set());
    publishUndo(null);
    setProfile(null);
    setProjects([]);
    setMutationResult(null);
    setMutationError(null);
    setLoadState({ status: "loading" });
    setLoadGeneration((current) => current + 1);
  }, [
    abortOutstandingWork,
    isCurrentScope,
    publishPending,
    publishTodos,
    publishUndo,
  ]);

  useLayoutEffect(() => {
    const generation = ++activeGenerationRef.current;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    workspaceSessionKeyRef.current = workspaceSessionKey;
    activeServiceRef.current = service;
    readyRef.current = false;
    deleteInFlightRef.current = false;
    publishTodos([]);
    publishPending(new Set());
    publishUndo(null);
    setProfile(null);
    setProjects([]);
    setMutationResult(null);
    setMutationError(null);
    setLoadState({ status: "loading" });

    void (async () => {
      try {
        const response = await service.loadWorkspace({
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          generation !== activeGenerationRef.current ||
          !isCurrentScope()
        ) {
          return;
        }

        const snapshot = readTodoWorkspaceSnapshot(response);
        if (!snapshot) {
          throw new Error("Invalid Todo workspace response.");
        }

        readyRef.current = true;
        setProfile(snapshot.profile);
        setProjects(snapshot.projects);
        publishTodos(snapshot.todos);
        setLoadState({ status: "idle" });
      } catch (error: unknown) {
        if (
          controller.signal.aborted ||
          generation !== activeGenerationRef.current ||
          !isCurrentScope()
        ) {
          return;
        }

        readyRef.current = false;
        setLoadState({
          status: "error",
          kind: "load_failed",
        });
      } finally {
        controllersRef.current.delete(controller);
      }
    })();

    return () => {
      activeGenerationRef.current += 1;
      activeServiceRef.current = null;
      readyRef.current = false;
      abortOutstandingWork();
      todosRef.current = [];
      pendingTodoIdsRef.current = new Set();
      undoRef.current = null;
      deleteInFlightRef.current = false;
    };
  }, [
    abortOutstandingWork,
    isCurrentScope,
    loadGeneration,
    publishPending,
    publishTodos,
    publishUndo,
    service,
    workspaceSessionKey,
  ]);

  const beginTodoMutation = useCallback((todoId: UUID): Todo | null => {
    if (
      !readyRef.current ||
      !isCurrentScope() ||
      pendingTodoIdsRef.current.has(todoId)
    ) {
      return null;
    }
    const todo = todosRef.current.find((candidate) => candidate.id === todoId);
    if (!todo) return null;

    const nextPending = new Set(pendingTodoIdsRef.current);
    nextPending.add(todoId);
    publishPending(nextPending);
    setMutationError(null);
    return todo;
  }, [isCurrentScope, publishPending]);

  const finishTodoMutation = useCallback((todoId: UUID) => {
    if (!pendingTodoIdsRef.current.has(todoId)) return;
    const nextPending = new Set(pendingTodoIdsRef.current);
    nextPending.delete(todoId);
    publishPending(nextPending);
  }, [publishPending]);

  const settle = useCallback(
    (
      todoId: UUID,
      action: TodoWorkspaceMutationResult["action"],
      status: TodoWorkspaceMutationResult["status"],
    ) => {
      setMutationResult({
        sequence: ++settlementSequenceRef.current,
        todoId,
        action,
        status,
      });
    },
    [],
  );

  const acceptCreatedTodo = useCallback((response: Todo): boolean => {
    if (!readyRef.current || !isCurrentScope()) return false;
    const todo = readTodoResponse(response);
    if (!todo || pendingTodoIdsRef.current.has(todo.id)) return false;

    const existingIndex = todosRef.current.findIndex((candidate) => candidate.id === todo.id);
    const nextTodos = [...todosRef.current];
    if (existingIndex < 0) nextTodos.push(todo);
    else nextTodos[existingIndex] = todo;
    publishTodos(nextTodos);
    return true;
  }, [isCurrentScope, publishTodos]);

  const setCompleted = useCallback(
    (todoId: UUID, completed: boolean): boolean => {
      const todo = beginTodoMutation(todoId);
      if (!todo || todo.completed === completed) {
        if (todo) finishTodoMutation(todoId);
        return false;
      }

      const generation = activeGenerationRef.current;
      const controller = new AbortController();
      controllersRef.current.add(controller);

      void (async () => {
        try {
          const response = await service.setTodoCompleted(todoId, completed, {
            signal: controller.signal,
          });
          if (
            controller.signal.aborted ||
            generation !== activeGenerationRef.current ||
            !isCurrentScope()
          ) {
            return;
          }

          const savedTodo = readTodoResponse(response);
          if (!savedTodo || savedTodo.id !== todoId || savedTodo.completed !== completed) {
            throw new Error("Invalid completion response.");
          }

          publishTodos(
            todosRef.current.map((candidate) =>
              candidate.id === todoId ? savedTodo : candidate,
            ),
          );
          settle(todoId, "complete", "succeeded");
        } catch (error: unknown) {
          if (
            generation !== activeGenerationRef.current ||
            !isCurrentScope()
          ) {
            return;
          }
          if (isAbortError(error) || controller.signal.aborted) {
            settle(todoId, "complete", "cancelled");
          } else {
            setMutationError("completion_failed");
            settle(todoId, "complete", "failed");
          }
        } finally {
          controllersRef.current.delete(controller);
          if (
            generation === activeGenerationRef.current &&
            isCurrentScope()
          ) {
            finishTodoMutation(todoId);
          }
        }
      })();

      return true;
    }, [
      beginTodoMutation,
      finishTodoMutation,
      isCurrentScope,
      publishTodos,
      service,
      settle,
    ],
  );

  const updateDetails = useCallback(
    async (
      todoId: UUID,
      input: UpdateTodoDetailsInput,
      options?: TodoRequestOptions,
    ): Promise<Todo> => {
      if (options?.signal.aborted) throw new TodoMutationNotStartedError();
      const todo = beginTodoMutation(todoId);
      if (!todo) throw new TodoMutationNotStartedError();

      const generation = activeGenerationRef.current;
      const controller = new AbortController();
      controllersRef.current.add(controller);
      const abortFromCaller = () => controller.abort();
      options?.signal.addEventListener("abort", abortFromCaller, { once: true });
      let rejectOnAbort!: () => void;
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectOnAbort = () => reject(new DOMException("Todo edit interrupted.", "AbortError"));
        controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
      });

      try {
        // Abort ends this local request even if the provider ignores its
        // signal. It cannot promise that a remote write was rolled back.
        const providerRequest = (async () =>
          service.updateTodoDetails(todoId, input, { signal: controller.signal }))();
        const response = await Promise.race([
          providerRequest,
          aborted,
        ]);
        if (
          controller.signal.aborted ||
          generation !== activeGenerationRef.current ||
          !isCurrentScope()
        ) {
          throw new TodoMutationNotStartedError();
        }

        const savedTodo = readTodoResponse(response);
        if (
          !savedTodo ||
          savedTodo.id !== todoId ||
          !todoMatchesDetails(savedTodo, input)
        ) {
          throw new Error("Invalid Todo details response.");
        }

        publishTodos(
          todosRef.current.map((candidate) =>
            candidate.id === todoId ? savedTodo : candidate,
          ),
        );
        return savedTodo;
      } catch (error) {
        if (
          generation === activeGenerationRef.current &&
          isCurrentScope() &&
          !controller.signal.aborted &&
          !isAbortError(error)
        ) {
          setMutationError("update_failed");
          throw new TodoMutationFailedError();
        }
        throw new TodoMutationNotStartedError();
      } finally {
        options?.signal.removeEventListener("abort", abortFromCaller);
        controller.signal.removeEventListener("abort", rejectOnAbort);
        controllersRef.current.delete(controller);
        if (
          generation === activeGenerationRef.current &&
          isCurrentScope()
        ) {
          finishTodoMutation(todoId);
        }
      }
    }, [
      beginTodoMutation,
      finishTodoMutation,
      isCurrentScope,
      publishTodos,
      service,
    ],
  );

  const deleteTodo = useCallback(
    (todoId: UUID): boolean => {
      // A single visible Undo token is deliberate. Serialize from delete start
      // through Undo/dismiss so tokens cannot overwrite each other or race a
      // restore that has already committed remotely.
      if (deleteInFlightRef.current || undoRef.current !== null) return false;
      const todo = beginTodoMutation(todoId);
      if (!todo) return false;
      deleteInFlightRef.current = true;

      const originalIndex = todosRef.current.findIndex(
        (candidate) => candidate.id === todoId,
      );
      const generation = activeGenerationRef.current;
      const controller = new AbortController();
      controllersRef.current.add(controller);

      void (async () => {
        try {
          const token = await service.softDeleteTodo(todoId, {
            signal: controller.signal,
          });
          if (
            controller.signal.aborted ||
            generation !== activeGenerationRef.current ||
            !isCurrentScope()
          ) {
            return;
          }

          if (!isDeleteUndoToken(token)) {
            throw new Error("Invalid Todo deletion response.");
          }

          publishTodos(
            todosRef.current.filter((candidate) => candidate.id !== todoId),
          );
          publishUndo({
            todo,
            originalIndex,
            token,
            pending: false,
            error: null,
          });
          settle(todoId, "delete", "succeeded");
        } catch (error: unknown) {
          if (
            generation !== activeGenerationRef.current ||
            !isCurrentScope()
          ) {
            return;
          }
          if (isAbortError(error) || controller.signal.aborted) {
            settle(todoId, "delete", "cancelled");
          } else {
            setMutationError("delete_failed");
            settle(todoId, "delete", "failed");
          }
        } finally {
          controllersRef.current.delete(controller);
          if (
            generation === activeGenerationRef.current &&
            isCurrentScope()
          ) {
            deleteInFlightRef.current = false;
            finishTodoMutation(todoId);
          }
        }
      })();

      return true;
    }, [
      beginTodoMutation,
      finishTodoMutation,
      isCurrentScope,
      publishTodos,
      publishUndo,
      service,
      settle,
    ],
  );

  const undoDelete = useCallback(() => {
    const currentUndo = undoRef.current;
    if (
      !currentUndo ||
      currentUndo.pending ||
      !readyRef.current ||
      !isCurrentScope()
    ) {
      return;
    }

    const pendingUndo = { ...currentUndo, pending: true, error: null };
    publishUndo(pendingUndo);
    const generation = activeGenerationRef.current;
    const controller = new AbortController();
    controllersRef.current.add(controller);

    void (async () => {
      try {
        const restored = await service.restoreTodo(
          currentUndo.todo.id,
          currentUndo.token,
          { signal: controller.signal },
        );
        if (
          controller.signal.aborted ||
          generation !== activeGenerationRef.current ||
          !isCurrentScope() ||
          undoRef.current !== pendingUndo
        ) {
          return;
        }

        if (typeof restored !== "boolean") {
          throw new Error("Invalid Todo restore response.");
        }
        if (restored === false) {
          publishUndo({
            ...currentUndo,
            error: "Undo is no longer available for this todo.",
          });
          return;
        }

        const nextTodos = [...todosRef.current];
        if (!nextTodos.some((todo) => todo.id === currentUndo.todo.id)) {
          nextTodos.splice(
            Math.min(currentUndo.originalIndex, nextTodos.length),
            0,
            currentUndo.todo,
          );
        }
        publishTodos(nextTodos);
        publishUndo(null);
      } catch (error: unknown) {
        if (
          generation !== activeGenerationRef.current ||
          !isCurrentScope() ||
          undoRef.current !== pendingUndo
        ) {
          return;
        }
        if (!controller.signal.aborted) {
          publishUndo({
            ...currentUndo,
            error: isAbortError(error)
              ? "The restore was interrupted. Try Undo again."
              : "The todo could not be restored. Try Undo again.",
          });
        }
      } finally {
        controllersRef.current.delete(controller);
      }
    })();
  }, [isCurrentScope, publishTodos, publishUndo, service]);

  const dismissUndo = useCallback(() => {
    if (
      !isCurrentScope() ||
      undoRef.current?.pending
    ) {
      return;
    }
    publishUndo(null);
  }, [isCurrentScope, publishUndo]);

  const undoNotice = useMemo<TodoWorkspaceUndoNotice | null>(() => {
    if (!undo) return null;
    return {
      todoId: undo.todo.id,
      todoText: undo.todo.text,
      pending: undo.pending,
      error: undo.error,
      onUndo: undoDelete,
      onDismiss: dismissUndo,
    };
  }, [dismissUndo, undo, undoDelete]);

  const scopeMatches = isCurrentScope();

  return {
    loadState: scopeMatches ? loadState : { status: "loading" },
    profile: scopeMatches ? profile : null,
    projects: scopeMatches ? projects : [],
    todos: scopeMatches ? todos : [],
    pendingTodoIds: scopeMatches ? pendingTodoIds : new Set(),
    mutationResult: scopeMatches ? mutationResult : null,
    mutationError: scopeMatches ? mutationError : null,
    undoNotice: scopeMatches ? undoNotice : null,
    retryLoad,
    acceptCreatedTodo,
    setCompleted,
    updateDetails,
    deleteTodo,
  };
}
