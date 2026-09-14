import { useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { DeleteUndoToken, LocalDate, TodayTodo, Todo, UUID } from "../../types/domain";
import { asSqlDate, compareSqlDates, type SqlDate } from "./dateDomain";
import {
  applyOptimisticTodayRanks,
  applyPersistedTodayRanks,
  buildTodayListModel,
  moveTodayListTodo,
  placeTodayListTodo,
  type TodayDropPlacement,
  type TodayListModel,
} from "./todayListModel";
import type { MoveDirection } from "./todayOrder";
import type { TodoRequestOptions, TodoService, UpdateTodoDetailsInput } from "./todoService";
import { isDeleteUndoToken, readTodoResponse, todoMatchesDetails } from "./todoWorkspaceValidation";

export type TodayListLoadStatus = "idle" | "loading" | "ready" | "error";
export type TodayListMutationKind =
  | "reorder" | "complete" | "reschedule" | "update" | "delete" | "restore";

export interface TodayListAnnouncement {
  readonly sequence: number;
  readonly message: string;
}

export interface TodayListUndoNotice {
  readonly todoId: UUID;
  readonly todoText: string;
  readonly pending: boolean;
  readonly error: string | null;
}

export interface TodayListControllerState {
  readonly loadStatus: TodayListLoadStatus;
  readonly model: TodayListModel;
  readonly loadError: string | null;
  readonly mutationError: string | null;
  readonly pendingMutation: {
    readonly kind: TodayListMutationKind;
    readonly todoId: UUID;
  } | null;
  readonly undoNotice: TodayListUndoNotice | null;
  readonly announcement: TodayListAnnouncement;
}

const LOAD_ERROR = "Today could not be loaded. Try again.";
const REORDER_ERROR = "That order was not saved. The previous order was restored.";
const COMPLETE_ERROR = "The task was not completed. It is back in Today.";
const RESCHEDULE_ERROR = "The new date was not saved. The task is back in Today.";
const UPDATE_ERROR = "The changes were not saved. The previous task details were restored.";
const DELETE_ERROR = "The task was not deleted. It is back in Today.";
const RESTORE_ERROR = "The task could not be restored. Try Undo again.";
const RESTORED_REFRESH_ERROR =
  "The task was restored, but Today could not be refreshed. Try again to refresh Today.";
const CANCELLED_ERROR = "The change was cancelled. Refresh Today to confirm its saved state.";

type StatePatch = Partial<Omit<TodayListControllerState, "announcement">> & {
  readonly announcement?: string | TodayListAnnouncement;
};

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function todoLabel(todo: Pick<Todo, "text">): string {
  return todo.text.trim() || "Task";
}

function asTodayTodo(todo: Todo, localDate: SqlDate, previous?: TodayTodo): TodayTodo | null {
  if (todo.completed || todo.dueDate === null || compareSqlDates(todo.dueDate, localDate) > 0) {
    return null;
  }
  return {
    ...todo,
    completed: false,
    completedAt: null,
    dueDate: todo.dueDate,
    isOverdue: compareSqlDates(todo.dueDate, localDate) < 0,
    isManuallyOrdered: todo.todayRank !== null,
    projectTitle: previous?.projectId === todo.projectId ? previous.projectTitle : null,
  };
}

function rebaseModel(model: TodayListModel, localDate: SqlDate): TodayListModel {
  return buildTodayListModel(
    model.todos.flatMap((todo) => {
      const row = asTodayTodo(todo, localDate, todo);
      return row ? [row] : [];
    }),
    localDate,
  );
}

function replaceTodo(model: TodayListModel, todo: Todo, localDate: SqlDate): TodayListModel {
  const previous = model.todos.find((row) => sameId(row.id, todo.id));
  const row = asTodayTodo(todo, localDate, previous);
  const others = model.todos.filter((candidate) => !sameId(candidate.id, todo.id));
  return buildTodayListModel(row ? [...others, row] : others, localDate);
}

function removeTodo(model: TodayListModel, todoId: UUID): TodayListModel {
  return buildTodayListModel(
    model.todos.filter((todo) => !sameId(todo.id, todoId)),
    model.localDate,
  );
}

/** Validate the complete provider shape before displaying any of its fields. */
function readTodayModel(value: unknown, localDate: SqlDate): TodayListModel {
  if (!Array.isArray(value)) throw new RangeError("Invalid Today response.");
  const ids = new Set<string>();
  const todos = Array.from(value, (candidate: unknown) => {
    const todo = readTodoResponse(candidate);
    const row = todo && asTodayTodo(todo, localDate);
    const source = candidate as Partial<TodayTodo> | null;
    if (
      !row || !source ||
      source.isOverdue !== row.isOverdue ||
      source.isManuallyOrdered !== row.isManuallyOrdered ||
      (source.projectTitle !== null && typeof source.projectTitle !== "string") ||
      ids.has(row.id.toLowerCase())
    ) {
      throw new RangeError("Invalid Today response.");
    }
    ids.add(row.id.toLowerCase());
    return { ...row, projectTitle: row.projectId === null ? null : source.projectTitle! };
  });
  return buildTodayListModel(todos, localDate);
}

/** Also settle cancellation when an adapter ignores AbortSignal. */
function withAbort<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener("abort", cancel);
      reject(new DOMException("Request cancelled.", "AbortError"));
    };
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
    // Always observe the provider promise, including its eventual rejection.
    request.then(
      (value) => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted) cancel();
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
  });
}

/**
 * Provider-neutral Today orchestration. Session ownership remains in the
 * service, never in a browser-supplied user ID. One write is active at a time;
 * a settled Delete notice does not block unrelated edits/completion/reorder.
 */
export class TodayListController {
  private readonly listeners = new Set<() => void>();
  private localDate: SqlDate;
  private state: TodayListControllerState;
  private confirmedModel: TodayListModel;
  private active = true;
  private loadAbort: AbortController | null = null;
  private mutationAbort: AbortController | null = null;
  private removeExternalAbort: (() => void) | null = null;
  private loadRevision = 0;
  private mutationRevision = 0;
  private announcementSequence = 0;
  private reloadAfterMutation = false;
  private undo: { readonly todo: Todo; readonly token: DeleteUndoToken; stage: "deleted" | "restored" } | null = null;
  private creationSequence = 0;
  private readonly recentCreates = new Map<string, { readonly sequence: number; readonly todo: Todo }>();
  private readonly seenIds = new Set<string>();

  constructor(private readonly service: TodoService, localDate: LocalDate) {
    this.localDate = asSqlDate(localDate);
    this.confirmedModel = buildTodayListModel([], this.localDate);
    this.state = {
      loadStatus: "idle",
      model: this.confirmedModel,
      loadError: null,
      mutationError: null,
      pendingMutation: null,
      undoNotice: null,
      announcement: { sequence: 0, message: "" },
    };
  }

  readonly getSnapshot = (): TodayListControllerState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private replace(patch: StatePatch): void {
    const announcement = typeof patch.announcement === "string"
      ? { sequence: ++this.announcementSequence, message: patch.announcement }
      : (patch.announcement ?? this.state.announcement);
    this.state = { ...this.state, ...patch, announcement };
    for (const listener of this.listeners) listener();
  }

  /** Explicit lifecycle restart supports React Strict Mode effect replay. */
  readonly start = async (): Promise<boolean> => {
    this.active = true;
    return this.load();
  };

  /** Disable retained callbacks and clear account-specific transient data. */
  readonly stop = (): void => {
    if (!this.active) return;
    this.active = false;
    ++this.loadRevision;
    ++this.mutationRevision;
    this.loadAbort?.abort();
    this.mutationAbort?.abort();
    this.removeExternalAbort?.();
    this.removeExternalAbort = null;
    this.loadAbort = null;
    this.mutationAbort = null;
    this.reloadAfterMutation = false;
    this.undo = null;
    this.recentCreates.clear();
    this.seenIds.clear();
    this.confirmedModel = buildTodayListModel([], this.localDate);
    this.replace({
      loadStatus: "idle", model: this.confirmedModel,
      loadError: null, mutationError: null, pendingMutation: null,
      undoNotice: null, announcement: "",
    });
  };

  /**
   * Keep the same session controller (and exact Undo token) across midnight.
   * Reclassify known rows immediately; fetch newly eligible rows after an active
   * write settles, rather than aborting a token-bearing Delete response.
   */
  readonly setLocalDate = async (localDate: LocalDate): Promise<boolean> => {
    if (!this.active) return false;
    const nextDate = asSqlDate(localDate);
    if (nextDate === this.localDate) return true;
    this.localDate = nextDate;
    ++this.loadRevision;
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.confirmedModel = rebaseModel(this.confirmedModel, nextDate);
    this.replace({ model: rebaseModel(this.state.model, nextDate) });
    if (this.state.pendingMutation) {
      this.reloadAfterMutation = true;
      return false;
    }
    return this.load();
  };

  private async fetchCurrentToday(signal: AbortSignal): Promise<TodayListModel> {
    for (;;) {
      const requestDate = this.localDate;
      const startedAt = this.creationSequence;
      const rows = await withAbort(this.service.loadToday(requestDate, { signal }), signal);
      if (requestDate !== this.localDate) continue;
      let model = readTodayModel(rows, requestDate);
      // A create accepted after this read started must not disappear behind the
      // older read. No other write can overlap this read.
      for (const { sequence, todo } of this.recentCreates.values()) {
        if (sequence > startedAt) model = replaceTodo(model, todo, requestDate);
      }
      return model;
    }
  }

  private confirm(model: TodayListModel): void {
    this.confirmedModel = model;
    for (const todo of model.todos) this.seenIds.add(todo.id.toLowerCase());
  }

  readonly load = async (): Promise<boolean> => {
    if (!this.active) return false;
    if (this.state.pendingMutation) {
      this.reloadAfterMutation = true;
      return false;
    }
    this.loadAbort?.abort();
    const revision = ++this.loadRevision;
    const abortController = new AbortController();
    this.loadAbort = abortController;
    this.replace({ loadStatus: "loading", model: this.confirmedModel, loadError: null });
    try {
      const model = await this.fetchCurrentToday(abortController.signal);
      if (!this.active || revision !== this.loadRevision) return false;
      const restored = this.undo?.stage === "restored";
      if (restored) this.undo = null;
      this.loadAbort = null;
      this.confirm(model);
      this.replace({
        loadStatus: "ready", model, loadError: null,
        ...(restored ? { undoNotice: null, announcement: "Today refreshed. The task was restored." } : {}),
      });
      return true;
    } catch {
      if (!this.active || revision !== this.loadRevision) return false;
      this.loadAbort = null;
      this.replace({
        loadStatus: "error", model: this.confirmedModel,
        loadError: this.undo?.stage === "restored" ? RESTORED_REFRESH_ERROR : LOAD_ERROR,
      });
      return false;
    }
  };

  private beginMutation(
    kind: TodayListMutationKind,
    todoId: UUID,
    options?: TodoRequestOptions,
  ): { readonly revision: number; readonly signal: AbortSignal } | null {
    if (!this.active || this.state.pendingMutation || options?.signal.aborted ||
      (this.state.loadStatus !== "ready" && !(kind === "restore" && this.state.loadStatus === "error"))) {
      return null;
    }
    const revision = ++this.mutationRevision;
    const abortController = new AbortController();
    this.mutationAbort = abortController;
    if (options) {
      const cancel = () => abortController.abort();
      options.signal.addEventListener("abort", cancel, { once: true });
      this.removeExternalAbort = () => options.signal.removeEventListener("abort", cancel);
    }
    this.replace({ mutationError: null, pendingMutation: { kind, todoId } });
    return { revision, signal: abortController.signal };
  }

  private isCurrentMutation(revision: number): boolean {
    return this.active && revision === this.mutationRevision;
  }

  private finishMutation(patch: StatePatch): void {
    this.removeExternalAbort?.();
    this.removeExternalAbort = null;
    this.mutationAbort = null;
    this.replace({ pendingMutation: null, ...patch });
    if (this.reloadAfterMutation) {
      this.reloadAfterMutation = false;
      void this.load();
    }
  }

  private failMutation(revision: number, signal: AbortSignal, error: string): false {
    if (this.isCurrentMutation(revision)) {
      this.finishMutation({
        model: this.confirmedModel,
        mutationError: signal.aborted ? CANCELLED_ERROR : error,
        announcement: "",
      });
    }
    return false;
  }

  private async persistReorder(
    reorderedTodos: readonly TodayTodo[], movedTodo: TodayTodo, announcement: string,
  ): Promise<boolean> {
    if (!this.active) return false;
    let optimisticTodos: readonly TodayTodo[];
    try {
      optimisticTodos = applyOptimisticTodayRanks(reorderedTodos);
    } catch {
      this.replace({ mutationError: "Today has too many tasks to reorder at once.", announcement: "" });
      return false;
    }
    const mutation = this.beginMutation("reorder", movedTodo.id);
    if (!mutation) return false;
    const requestDate = this.localDate;
    this.replace({ model: buildTodayListModel(optimisticTodos, requestDate) });
    try {
      const updates = await withAbort(this.service.reorderToday(
        requestDate, optimisticTodos.map((todo) => todo.id), { signal: mutation.signal },
      ), mutation.signal);
      if (!this.isCurrentMutation(mutation.revision)) return false;
      const persisted = applyPersistedTodayRanks(optimisticTodos, updates);
      const requestedIds = new Set(optimisticTodos.map((todo) => todo.id.toLowerCase()));
      const model = buildTodayListModel([
        ...persisted.flatMap((todo) => {
          const row = asTodayTodo(todo, this.localDate, todo);
          return row ? [row] : [];
        }),
        ...this.confirmedModel.todos.filter((todo) => !requestedIds.has(todo.id.toLowerCase())),
      ], this.localDate);
      this.confirm(model);
      this.finishMutation({ model, announcement });
      return true;
    } catch {
      return this.failMutation(mutation.revision, mutation.signal, REORDER_ERROR);
    }
  }

  readonly moveTodo = async (todoId: UUID, direction: MoveDirection): Promise<boolean> => {
    if (!this.active || this.state.pendingMutation) return false;
    const { todos } = this.state.model;
    const todo = todos.find((row) => sameId(row.id, todoId));
    if (!todo) return false;
    const reordered = moveTodayListTodo(todos, todo.id, direction);
    if (reordered === todos) return false;
    return this.persistReorder(reordered, todo, `${todoLabel(todo)} moved ${direction}. Order saved.`);
  };

  readonly placeTodo = async (
    todoId: UUID, targetTodoId: UUID, placement: TodayDropPlacement,
  ): Promise<boolean> => {
    if (!this.active || this.state.pendingMutation) return false;
    const { todos } = this.state.model;
    const todo = todos.find((row) => sameId(row.id, todoId));
    const target = todos.find((row) => sameId(row.id, targetTodoId));
    if (!todo || !target) return false;
    const reordered = placeTodayListTodo(todos, todo.id, target.id, placement);
    if (reordered === todos) return false;
    return this.persistReorder(reordered, todo, `${todoLabel(todo)} moved. Order saved.`);
  };

  readonly completeTodo = async (todoId: UUID): Promise<boolean> => {
    const todo = this.state.model.todos.find((row) => sameId(row.id, todoId));
    if (!todo) return false;
    const mutation = this.beginMutation("complete", todo.id);
    if (!mutation) return false;
    this.replace({ model: removeTodo(this.state.model, todo.id) });
    try {
      const response = await withAbort(this.service.setTodoCompleted(
        todo.id, true, { signal: mutation.signal },
      ), mutation.signal);
      if (!this.isCurrentMutation(mutation.revision)) return false;
      const saved = readTodoResponse(response);
      if (!saved || !sameId(saved.id, todo.id) || !saved.completed) {
        throw new RangeError("Invalid completion response.");
      }
      const model = replaceTodo(this.confirmedModel, saved, this.localDate);
      this.confirm(model);
      this.finishMutation({ model, announcement: `${todoLabel(saved)} completed.` });
      return true;
    } catch {
      return this.failMutation(mutation.revision, mutation.signal, COMPLETE_ERROR);
    }
  };

  private async performUpdate(
    todoId: UUID, input: UpdateTodoDetailsInput,
    kind: "update" | "reschedule", options?: TodoRequestOptions,
  ): Promise<boolean> {
    if (!this.active || this.state.pendingMutation || options?.signal.aborted) return false;
    const todo = this.state.model.todos.find((row) => sameId(row.id, todoId));
    if (!todo) return false;
    const error = kind === "reschedule" ? RESCHEDULE_ERROR : UPDATE_ERROR;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      this.replace({ mutationError: error });
      return false;
    }
    const keys = Object.keys(input);
    const patch = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    if (!keys.length || keys.some((key) => !["text", "projectId", "classId", "assignmentType", "dueDate", "dueTime"].includes(key)) ||
      !Object.keys(patch).length ||
      (patch.dueDate === null && patch.dueTime !== null) ||
      (typeof patch.dueTime === "string" && typeof patch.dueDate !== "string")) {
      this.replace({ mutationError: error });
      return false;
    }
    const request = patch as UpdateTodoDetailsInput;
    const optimistic = readTodoResponse({ ...todo, ...request });
    if (!optimistic) {
      this.replace({ mutationError: error });
      return false;
    }
    const mutation = this.beginMutation(kind, todo.id, options);
    if (!mutation) return false;
    this.replace({ model: replaceTodo(this.state.model, optimistic, this.localDate) });
    try {
      const response = await withAbort(this.service.updateTodoDetails(
        todo.id, request, { signal: mutation.signal },
      ), mutation.signal);
      if (!this.isCurrentMutation(mutation.revision)) return false;
      const saved = readTodoResponse(response);
      if (!saved || !sameId(saved.id, todo.id) || !todoMatchesDetails(saved, request)) {
        throw new RangeError("Invalid details response.");
      }
      const model = replaceTodo(this.confirmedModel, saved, this.localDate);
      this.confirm(model);
      this.finishMutation({
        model,
        announcement: saved.completed
          ? `${todoLabel(saved)} is complete and no longer in Today.`
          : !asTodayTodo(saved, this.localDate)
            ? `${todoLabel(saved)} moved out of Today.`
            : `${todoLabel(saved)} ${kind === "reschedule" ? "rescheduled" : "updated"}.`,
      });
      return true;
    } catch {
      return this.failMutation(mutation.revision, mutation.signal, error);
    }
  }

  readonly updateDetails = (
    todoId: UUID, input: UpdateTodoDetailsInput, options?: TodoRequestOptions,
  ): Promise<boolean> => this.performUpdate(todoId, input, "update", options);

  readonly rescheduleTodo = (todoId: UUID, dueDate: LocalDate): Promise<boolean> =>
    this.performUpdate(todoId, { dueDate }, "reschedule");

  readonly deleteTodo = async (todoId: UUID): Promise<boolean> => {
    if (this.undo) return false;
    const todo = this.state.model.todos.find((row) => sameId(row.id, todoId));
    if (!todo) return false;
    const mutation = this.beginMutation("delete", todo.id);
    if (!mutation) return false;
    this.replace({ model: removeTodo(this.state.model, todo.id) });
    try {
      const token = await withAbort(this.service.softDeleteTodo(
        todo.id, { signal: mutation.signal },
      ), mutation.signal);
      if (!this.isCurrentMutation(mutation.revision)) return false;
      if (!isDeleteUndoToken(token)) throw new RangeError("Invalid Undo token.");
      this.undo = { todo, token, stage: "deleted" };
      const model = removeTodo(this.confirmedModel, todo.id);
      this.confirm(model);
      this.finishMutation({
        model,
        undoNotice: { todoId: todo.id, todoText: todo.text, pending: false, error: null },
        announcement: `${todoLabel(todo)} deleted. Undo is available.`,
      });
      return true;
    } catch {
      return this.failMutation(mutation.revision, mutation.signal, DELETE_ERROR);
    }
  };

  readonly undoDelete = async (): Promise<boolean> => {
    const undo = this.undo;
    const notice = this.state.undoNotice;
    if (!undo || !notice) return false;
    const mutation = this.beginMutation("restore", undo.todo.id);
    if (!mutation) return false;
    this.replace({ undoNotice: { ...notice, pending: true, error: null } });
    try {
      if (undo.stage === "deleted") {
        const restored = await withAbort(this.service.restoreTodo(
          undo.todo.id, undo.token, { signal: mutation.signal },
        ), mutation.signal);
        if (!this.isCurrentMutation(mutation.revision)) return false;
        if (restored !== true) throw new RangeError("Restore was not confirmed.");
        // Persist this stage before reading. A retry must never repeat a
        // successful restore or create a replacement task from a stale snapshot.
        undo.stage = "restored";
      }
      const model = await this.fetchCurrentToday(mutation.signal);
      if (!this.isCurrentMutation(mutation.revision)) return false;
      this.undo = null;
      this.confirm(model);
      this.reloadAfterMutation = false;
      this.finishMutation({
        model, loadStatus: "ready", loadError: null, undoNotice: null,
        announcement: `${todoLabel(undo.todo)} restored. Today refreshed.`,
      });
      return true;
    } catch {
      if (!this.isCurrentMutation(mutation.revision)) return false;
      const restored = undo.stage === "restored";
      const error = restored ? RESTORED_REFRESH_ERROR : RESTORE_ERROR;
      // Keep a successful restore visible even if its row is not yet readable.
      // A failed restore must still release a queued midnight refresh. A
      // successful restore/read failure instead leaves its explicit retry UI.
      if (restored) this.reloadAfterMutation = false;
      this.finishMutation({
        model: this.confirmedModel,
        undoNotice: { ...notice, pending: false, error },
        ...(restored ? { loadStatus: "error", loadError: error } : {}),
        announcement: "",
      });
      return false;
    }
  };

  readonly dismissUndo = (): void => {
    if (!this.active || !this.undo || this.state.undoNotice?.pending) return;
    const restored = this.undo.stage === "restored";
    this.undo = null;
    this.replace({
      undoNotice: null,
      // Dismissing a failed refresh cannot silently turn the missing row into
      // an apparently complete list. The normal Retry remains a read only.
      ...(restored ? { loadStatus: "error", loadError: RESTORED_REFRESH_ERROR } : {}),
    });
  };

  /** Incorporate a validated result from the shared Add flow without reloading. */
  readonly acceptCreatedTodo = (response: Todo): boolean => {
    if (!this.active) return false;
    const todo = readTodoResponse(response);
    if (!todo || this.seenIds.has(todo.id.toLowerCase())) return false;
    this.seenIds.add(todo.id.toLowerCase());
    this.recentCreates.set(todo.id.toLowerCase(), { sequence: ++this.creationSequence, todo });
    this.confirm(replaceTodo(this.confirmedModel, todo, this.localDate));
    this.replace({ model: replaceTodo(this.state.model, todo, this.localDate) });
    return true;
  };
}

export interface TodayListControllerBinding {
  readonly state: TodayListControllerState;
  readonly controller: TodayListController;
}

/** Account changes replace the controller; local midnight preserves its Undo. */
export function useTodayListController(
  service: TodoService, localDate: LocalDate, accountScopeKey: string,
): TodayListControllerBinding {
  if (!accountScopeKey || accountScopeKey !== accountScopeKey.trim()) {
    throw new RangeError("Today requires an authenticated account scope.");
  }
  const controller = useMemo(
    () => new TodayListController(service, localDate),
    // Lifecycle key only: never passed to a provider as a user ID.
    [accountScopeKey, service],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // Abort an old account before the new commit can expose retained callbacks.
  useLayoutEffect(() => controller.stop, [controller]);
  // Start reads in the passive phase: concurrent StrictMode can otherwise let
  // a layout-started provider microtask consume a one-time error before its
  // discarded mount is cleaned up. Both cleanup paths are idempotent.
  useEffect(() => {
    void controller.start();
    return controller.stop;
  }, [controller]);
  useLayoutEffect(() => {
    void controller.setLocalDate(localDate);
  }, [controller, localDate]);
  // The prop can change before layout effects run. Never expose the prior
  // timezone/day's eligibility in that render.
  const visibleState = state.model.localDate === localDate ? state : {
    ...state,
    model: rebaseModel(state.model, asSqlDate(localDate)),
    loadStatus: "loading" as const,
  };
  return { state: visibleState, controller };
}
