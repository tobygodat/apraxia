import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type {
  DeleteUndoToken,
  LocalDate,
  Profile,
  ProjectSummary,
  TodayTodo,
  Todo,
  UUID,
} from "../../types/domain";
import { useWorkspaceRevision } from "../../apps/workspaceStore";
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
import { TODO_UNDO_COPY, type TodoLoadStatus, type TodoMutationErrorKind } from "./todoUiState";
import {
  isDeleteUndoToken,
  readTodoResponse,
  readTodoWorkspaceSnapshot,
  todoMatchesDetails,
} from "./todoWorkspaceValidation";
import { ServiceError } from "../../lib/serviceError";

export type TodoMutationKind =
  "complete" | "update" | "reschedule" | "delete" | "restore" | "reorder";

export interface TodoPendingMutation {
  readonly kind: TodoMutationKind;
  readonly todoId: UUID;
}

/** One settled complete/delete write; the board uses it to recover focus. */
export interface TodoMutationResult {
  /** Monotonic for the lifetime of this controller instance. */
  readonly sequence: number;
  readonly todoId: UUID;
  readonly action: "complete" | "delete";
  readonly status: "succeeded" | "failed" | "cancelled";
}

export interface TodoUndoNotice {
  readonly todoId: UUID;
  readonly todoText: string;
  readonly pending: boolean;
  readonly error: string | null;
}

export interface TodoAnnouncement {
  readonly sequence: number;
  readonly message: string;
}

export interface TodoControllerState {
  readonly workspaceStatus: TodoLoadStatus;
  readonly todayStatus: TodoLoadStatus;
  readonly profile: Profile | null;
  readonly projects: readonly ProjectSummary[];
  /** Every active row of the account, as the board shows it. */
  readonly todos: readonly Todo[];
  /** The Today RPC slice for the current local date, ranked as Postgres orders it. */
  readonly today: TodayListModel;
  readonly pending: readonly TodoPendingMutation[];
  readonly pendingTodoIds: ReadonlySet<UUID>;
  readonly mutationResult: TodoMutationResult | null;
  readonly mutationError: TodoMutationErrorKind | null;
  readonly undoNotice: TodoUndoNotice | null;
  readonly announcement: TodoAnnouncement;
}

const TODO_MUTATION_CODES = {
  not_started: "not_found",
  failed: "unavailable",
  cancelled: "aborted",
} as const;

export class TodoMutationError extends ServiceError {
  constructor(readonly kind: "not_started" | "failed" | "cancelled") {
    super(
      TODO_MUTATION_CODES[kind],
      kind === "failed"
        ? "The task changes were not saved. Try again."
        : "This task is no longer available for editing.",
    );
    this.name = "TodoMutationError";
  }
}

type StatePatch = Partial<Omit<TodoControllerState, "announcement" | "pendingTodoIds">> & {
  readonly announcement?: string;
};

interface Slices {
  readonly todos: readonly Todo[];
  readonly todayRows: readonly TodayTodo[];
}

const PLACEHOLDER_DATE = "1970-01-01" as SqlDate;

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function todoLabel(todo: Pick<Todo, "text">): string {
  return todo.text.trim() || "Task";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Project a workspace row onto Today, or null when it is not eligible for `localDate`. */
function asTodayTodo(
  todo: Todo,
  localDate: SqlDate,
  previous?: Pick<TodayTodo, "projectId" | "projectTitle">,
): TodayTodo | null {
  if (todo.completed || todo.dueDate === null || compareSqlDates(todo.dueDate, localDate) > 0)
    return null;
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

function rebaseRows(rows: readonly TodayTodo[], localDate: SqlDate): readonly TodayTodo[] {
  return rows.flatMap((row) => {
    const next = asTodayTodo(row, localDate, row);
    return next ? [next] : [];
  });
}

/** Validate the complete provider shape before displaying any of its fields. */
function readTodayRows(value: unknown, localDate: SqlDate): readonly TodayTodo[] {
  if (!Array.isArray(value)) throw new RangeError("Invalid Today response.");
  const ids = new Set<string>();
  return Array.from(value, (candidate: unknown) => {
    const todo = readTodoResponse(candidate);
    const row = todo && asTodayTodo(todo, localDate);
    const source = candidate as Partial<TodayTodo> | null;
    if (
      !row ||
      !source ||
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
 * Provider-neutral task state for one authenticated session. The board and the
 * Today panel are views over the same load, optimistic mutate, delete/Undo, and
 * abort logic. Ownership stays in the service, never in a browser-supplied ID.
 */
export class TodoController {
  private readonly listeners = new Set<() => void>();
  private state: TodoControllerState;
  private active = true;
  private localDate: SqlDate | null = null;
  private confirmed: Slices = { todos: [], todayRows: [] };
  private readonly loads: Record<
    "workspace" | "today",
    { abort: AbortController | null; revision: number }
  > = {
    workspace: { abort: null, revision: 0 },
    today: { abort: null, revision: 0 },
  };
  private readonly mutationAborts = new Set<AbortController>();
  private mutationRevision = 0;
  private resultSequence = 0;
  private announcementSequence = 0;
  private reloadAfterMutation = { workspace: false, today: false };
  private undo: {
    readonly todo: Todo;
    readonly originalIndex: number;
    readonly token: DeleteUndoToken;
  } | null = null;
  private creationSequence = 0;
  private readonly recentCreates = new Map<
    string,
    { readonly sequence: number; readonly todo: Todo }
  >();

  constructor(private readonly service: TodoService) {
    this.state = TodoController.initialState();
  }

  private static initialState(): TodoControllerState {
    return {
      workspaceStatus: "idle",
      todayStatus: "idle",
      profile: null,
      projects: [],
      todos: [],
      today: buildTodayListModel([], PLACEHOLDER_DATE),
      pending: [],
      pendingTodoIds: new Set(),
      mutationResult: null,
      mutationError: null,
      undoNotice: null,
      announcement: { sequence: 0, message: "" },
    };
  }

  readonly getSnapshot = (): TodoControllerState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private replace(patch: StatePatch): void {
    const announcement =
      typeof patch.announcement === "string"
        ? { sequence: ++this.announcementSequence, message: patch.announcement }
        : this.state.announcement;
    const pending = patch.pending ?? this.state.pending;
    const pendingTodoIds = patch.pending
      ? new Set(pending.map((entry) => entry.todoId))
      : this.state.pendingTodoIds;
    this.state = { ...this.state, ...patch, pending, pendingTodoIds, announcement };
    for (const listener of this.listeners) listener();
  }

  /** Explicit lifecycle restart supports React Strict Mode effect replay. */
  readonly start = (): void => {
    this.active = true;
  };

  /** Disable retained callbacks and clear account-specific transient data. */
  readonly stop = (): void => {
    if (!this.active) return;
    this.active = false;
    ++this.mutationRevision;
    for (const load of Object.values(this.loads)) {
      load.abort?.abort();
      load.abort = null;
      ++load.revision;
    }
    for (const abort of this.mutationAborts) abort.abort();
    this.mutationAborts.clear();
    this.reloadAfterMutation = { workspace: false, today: false };
    this.undo = null;
    this.recentCreates.clear();
    this.confirmed = { todos: [], todayRows: [] };
    this.replace({
      ...TodoController.initialState(),
      today: buildTodayListModel([], this.localDate ?? PLACEHOLDER_DATE),
      announcement: "",
    });
  };

  // ---- slices -------------------------------------------------------------

  private get todayDate(): SqlDate {
    return this.localDate ?? PLACEHOLDER_DATE;
  }

  private publish(slices: Slices, patch: StatePatch = {}): void {
    this.replace({
      ...patch,
      todos: slices.todos,
      today: buildTodayListModel(slices.todayRows, this.todayDate),
    });
  }

  private current(): Slices {
    return { todos: this.state.todos, todayRows: this.state.today.todos };
  }

  private withTodo(slices: Slices, todo: Todo, insertAt?: number): Slices {
    const index = slices.todos.findIndex((candidate) => sameId(candidate.id, todo.id));
    const todos = [...slices.todos];
    if (index >= 0) todos[index] = todo;
    else if (this.state.workspaceStatus !== "idle")
      todos.splice(Math.min(insertAt ?? todos.length, todos.length), 0, todo);
    const previous = slices.todayRows.find((row) => sameId(row.id, todo.id));
    const row = this.localDate ? asTodayTodo(todo, this.localDate, previous) : null;
    const others = slices.todayRows.filter((candidate) => !sameId(candidate.id, todo.id));
    return { todos, todayRows: row ? [...others, row] : others };
  }

  private withoutTodo(slices: Slices, todoId: UUID): Slices {
    return {
      todos: slices.todos.filter((todo) => !sameId(todo.id, todoId)),
      todayRows: slices.todayRows.filter((row) => !sameId(row.id, todoId)),
    };
  }

  /** Roll one row back to its last confirmed value in both slices. */
  private revertTodo(todoId: UUID): void {
    const confirmed = this.confirmed.todos.find((todo) => sameId(todo.id, todoId));
    const confirmedRow = this.confirmed.todayRows.find((row) => sameId(row.id, todoId));
    let slices = this.withoutTodo(this.current(), todoId);
    if (confirmed) {
      const index = this.confirmed.todos.findIndex((todo) => sameId(todo.id, todoId));
      slices = this.withTodo(slices, confirmed, index);
    }
    if (confirmedRow)
      slices = {
        ...slices,
        todayRows: [...slices.todayRows.filter((row) => !sameId(row.id, todoId)), confirmedRow],
      };
    this.publish(slices);
  }

  private findTodo(todoId: UUID): Todo | null {
    return (
      this.state.todos.find((todo) => sameId(todo.id, todoId)) ??
      this.state.today.todos.find((row) => sameId(row.id, todoId)) ??
      null
    );
  }

  // ---- loads --------------------------------------------------------------

  private beginLoad(slice: "workspace" | "today"): AbortController | null {
    if (!this.active) return null;
    if (this.state.pending.length > 0) {
      this.reloadAfterMutation[slice] = true;
      return null;
    }
    const load = this.loads[slice];
    load.abort?.abort();
    ++load.revision;
    load.abort = new AbortController();
    return load.abort;
  }

  private isCurrentLoad(slice: "workspace" | "today", abort: AbortController): boolean {
    return this.active && this.loads[slice].abort === abort;
  }

  private mergeRecentCreates(slices: Slices, startedAt: number): Slices {
    let next = slices;
    for (const [key, { sequence, todo }] of this.recentCreates) {
      if (sequence > startedAt) next = this.withTodo(next, todo);
      else this.recentCreates.delete(key);
    }
    return next;
  }

  readonly loadWorkspace = async (): Promise<boolean> => {
    const abort = this.beginLoad("workspace");
    if (!abort) return false;
    const startedAt = this.creationSequence;
    this.replace({ workspaceStatus: "loading" });
    try {
      const response = await withAbort(
        this.service.loadWorkspace({ signal: abort.signal }),
        abort.signal,
      );
      if (!this.isCurrentLoad("workspace", abort)) return false;
      const snapshot = readTodoWorkspaceSnapshot(response);
      if (!snapshot) throw new RangeError("Invalid workspace response.");
      this.loads.workspace.abort = null;
      this.replace({ workspaceStatus: "ready" });
      const slices = this.mergeRecentCreates(
        { todos: snapshot.todos, todayRows: this.state.today.todos },
        startedAt,
      );
      this.confirmed = { ...this.confirmed, todos: slices.todos };
      this.publish(slices, { profile: snapshot.profile, projects: snapshot.projects });
      return true;
    } catch {
      if (!this.isCurrentLoad("workspace", abort)) return false;
      this.loads.workspace.abort = null;
      this.replace({ workspaceStatus: "error" });
      return false;
    }
  };

  private async fetchToday(signal: AbortSignal): Promise<readonly TodayTodo[]> {
    for (;;) {
      const requestDate = this.todayDate;
      const startedAt = this.creationSequence;
      const rows = await withAbort(this.service.loadToday(requestDate, { signal }), signal);
      // Midnight passed while reading: the answer is for a date no longer shown.
      if (requestDate !== this.localDate) continue;
      return this.mergeRecentCreates(
        { todos: this.state.todos, todayRows: readTodayRows(rows, requestDate) },
        startedAt,
      ).todayRows;
    }
  }

  readonly loadToday = async (): Promise<boolean> => {
    if (this.localDate === null) return false;
    const abort = this.beginLoad("today");
    if (!abort) return false;
    this.replace({ todayStatus: "loading" });
    try {
      const rows = await this.fetchToday(abort.signal);
      if (!this.isCurrentLoad("today", abort)) return false;
      this.loads.today.abort = null;
      this.confirmed = { ...this.confirmed, todayRows: rows };
      this.publish({ todos: this.state.todos, todayRows: rows }, { todayStatus: "ready" });
      return true;
    } catch {
      if (!this.isCurrentLoad("today", abort)) return false;
      this.loads.today.abort = null;
      this.replace({ todayStatus: "error" });
      return false;
    }
  };

  /**
   * Keep the same controller (and exact Undo token) across midnight. Known rows
   * reclassify immediately; newly eligible rows load after an active write
   * settles rather than aborting a token-bearing Delete response.
   */
  readonly setLocalDate = async (localDate: LocalDate): Promise<boolean> => {
    if (!this.active) return false;
    const next = asSqlDate(localDate);
    if (next === this.localDate) return this.state.todayStatus === "idle" ? this.loadToday() : true;
    this.localDate = next;
    this.loads.today.abort?.abort();
    this.loads.today.abort = null;
    this.confirmed = { ...this.confirmed, todayRows: rebaseRows(this.confirmed.todayRows, next) };
    this.publish({ todos: this.state.todos, todayRows: rebaseRows(this.state.today.todos, next) });
    return this.loadToday();
  };

  /** Reload every loaded slice after an external write; deferred behind a pending write. */
  readonly refresh = async (): Promise<void> => {
    const tasks: Promise<boolean>[] = [];
    if (this.state.workspaceStatus !== "idle") tasks.push(this.loadWorkspace());
    if (this.state.todayStatus !== "idle") tasks.push(this.loadToday());
    await Promise.all(tasks);
  };

  // ---- mutations ----------------------------------------------------------

  private beginMutation(
    kind: TodoMutationKind,
    todoId: UUID,
    options?: TodoRequestOptions,
  ): {
    readonly revision: number;
    readonly signal: AbortSignal;
    readonly finish: (patch?: StatePatch) => void;
  } | null {
    const { pending } = this.state;
    if (
      !this.active ||
      options?.signal.aborted ||
      pending.some((entry) => entry.todoId === todoId || entry.kind === "reorder") ||
      (kind === "reorder" && pending.length > 0)
    ) {
      return null;
    }
    const revision = this.mutationRevision;
    const abort = new AbortController();
    this.mutationAborts.add(abort);
    const cancelFromCaller = () => abort.abort();
    options?.signal.addEventListener("abort", cancelFromCaller, { once: true });
    const entry: TodoPendingMutation = { kind, todoId };
    this.replace({ mutationError: null, pending: [...pending, entry] });
    return {
      revision,
      signal: abort.signal,
      finish: (patch = {}) => {
        options?.signal.removeEventListener("abort", cancelFromCaller);
        this.mutationAborts.delete(abort);
        if (!this.isCurrentMutation(revision)) return;
        this.replace({
          ...patch,
          pending: this.state.pending.filter((candidate) => candidate !== entry),
        });
        if (this.state.pending.length === 0) {
          const { workspace, today } = this.reloadAfterMutation;
          this.reloadAfterMutation = { workspace: false, today: false };
          if (workspace) void this.loadWorkspace();
          if (today) void this.loadToday();
        }
      },
    };
  }

  private isCurrentMutation(revision: number): boolean {
    return this.active && revision === this.mutationRevision;
  }

  private settle(
    todoId: UUID,
    action: TodoMutationResult["action"],
    status: TodoMutationResult["status"],
  ): StatePatch {
    return { mutationResult: { sequence: ++this.resultSequence, todoId, action, status } };
  }

  private confirmTodo(todo: Todo): Slices {
    this.confirmed = this.withTodo(this.confirmed, todo);
    return this.withTodo(this.current(), todo);
  }

  /** Returns false when the row is absent or already has a write in flight. */
  readonly setCompleted = (todoId: UUID, completed: boolean): boolean => {
    const todo = this.findTodo(todoId);
    if (!todo || todo.completed === completed) return false;
    const mutation = this.beginMutation("complete", todo.id);
    if (!mutation) return false;
    const optimistic: Todo = {
      ...todo,
      completed,
      completedAt: completed ? new Date().toISOString() : null,
    };
    this.publish(this.withTodo(this.current(), optimistic));
    void (async () => {
      try {
        const response = await withAbort(
          this.service.setTodoCompleted(todo.id, completed, { signal: mutation.signal }),
          mutation.signal,
        );
        if (!this.isCurrentMutation(mutation.revision)) return;
        const saved = readTodoResponse(response);
        if (!saved || !sameId(saved.id, todo.id) || saved.completed !== completed)
          throw new RangeError("Invalid completion response.");
        const slices = this.confirmTodo(saved);
        this.publish(slices, {
          ...this.settle(todo.id, "complete", "succeeded"),
          announcement: completed
            ? `${todoLabel(saved)} completed.`
            : `${todoLabel(saved)} marked incomplete.`,
        });
        mutation.finish();
      } catch (error) {
        if (!this.isCurrentMutation(mutation.revision)) return;
        this.revertTodo(todo.id);
        const cancelled = mutation.signal.aborted || isAbortError(error);
        mutation.finish({
          ...this.settle(todo.id, "complete", cancelled ? "cancelled" : "failed"),
          mutationError: cancelled ? "cancelled" : "completion_failed",
          announcement: "",
        });
      }
    })();
    return true;
  };

  readonly completeTodo = (todoId: UUID): boolean => this.setCompleted(todoId, true);

  /** Rejects with TodoMutationError so an edit form keeps its entered values for retry. */
  readonly updateDetails = async (
    todoId: UUID,
    input: UpdateTodoDetailsInput,
    options?: TodoRequestOptions,
    kind: "update" | "reschedule" = "update",
  ): Promise<Todo> => {
    const todo = this.findTodo(todoId);
    const patch =
      input && typeof input === "object" && !Array.isArray(input)
        ? Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
        : {};
    const keys = Object.keys(patch);
    const request = patch as UpdateTodoDetailsInput;
    const optimistic =
      todo &&
      keys.length &&
      keys.every((key) => ["text", "projectId", "dueDate", "dueTime"].includes(key)) &&
      !(request.dueDate === null && request.dueTime !== null) &&
      !(
        typeof request.dueTime === "string" &&
        typeof request.dueDate !== "string" &&
        todo.dueDate === null
      )
        ? readTodoResponse({ ...todo, ...request })
        : null;
    if (!todo || !optimistic) {
      if (todo) this.replace({ mutationError: "update_failed" });
      throw new TodoMutationError(todo ? "failed" : "not_started");
    }
    const mutation = this.beginMutation(kind, todo.id, options);
    if (!mutation) throw new TodoMutationError("not_started");
    this.publish(this.withTodo(this.current(), optimistic));
    try {
      const response = await withAbort(
        this.service.updateTodoDetails(todo.id, request, { signal: mutation.signal }),
        mutation.signal,
      );
      if (!this.isCurrentMutation(mutation.revision)) throw new TodoMutationError("cancelled");
      const saved = readTodoResponse(response);
      if (!saved || !sameId(saved.id, todo.id) || !todoMatchesDetails(saved, request))
        throw new RangeError("Invalid details response.");
      const slices = this.confirmTodo(saved);
      const stillToday = this.localDate !== null && asTodayTodo(saved, this.localDate) !== null;
      this.publish(slices, {
        announcement: saved.completed
          ? `${todoLabel(saved)} is complete and no longer in Today.`
          : this.state.todayStatus !== "idle" && !stillToday
            ? `${todoLabel(saved)} moved out of Today.`
            : `${todoLabel(saved)} ${kind === "reschedule" ? "rescheduled" : "updated"}.`,
      });
      mutation.finish();
      return saved;
    } catch (error) {
      if (!this.isCurrentMutation(mutation.revision)) throw new TodoMutationError("cancelled");
      this.revertTodo(todo.id);
      const cancelled = mutation.signal.aborted || isAbortError(error);
      mutation.finish({ mutationError: cancelled ? null : "update_failed", announcement: "" });
      throw new TodoMutationError(cancelled ? "cancelled" : "failed");
    }
  };

  readonly rescheduleTodo = (todoId: UUID, dueDate: LocalDate): Promise<Todo> =>
    this.updateDetails(todoId, { dueDate }, undefined, "reschedule");

  /**
   * A single visible Undo token is deliberate: a delete cannot start until the
   * previous notice is undone or dismissed, so tokens never cross.
   */
  readonly deleteTodo = (todoId: UUID): boolean => {
    if (this.undo || this.state.pending.some((entry) => entry.kind === "delete")) return false;
    const todo = this.findTodo(todoId);
    if (!todo) return false;
    const mutation = this.beginMutation("delete", todo.id);
    if (!mutation) return false;
    const originalIndex = this.state.todos.findIndex((candidate) => sameId(candidate.id, todo.id));
    this.publish(this.withoutTodo(this.current(), todo.id));
    void (async () => {
      try {
        const token = await withAbort(
          this.service.softDeleteTodo(todo.id, { signal: mutation.signal }),
          mutation.signal,
        );
        if (!this.isCurrentMutation(mutation.revision)) return;
        if (!isDeleteUndoToken(token)) throw new RangeError("Invalid Undo token.");
        this.undo = { todo, originalIndex, token };
        this.confirmed = this.withoutTodo(this.confirmed, todo.id);
        mutation.finish({
          ...this.settle(todo.id, "delete", "succeeded"),
          undoNotice: { todoId: todo.id, todoText: todo.text, pending: false, error: null },
          announcement: `${todoLabel(todo)} deleted. Undo is available.`,
        });
      } catch (error) {
        if (!this.isCurrentMutation(mutation.revision)) return;
        this.revertTodo(todo.id);
        const cancelled = mutation.signal.aborted || isAbortError(error);
        mutation.finish({
          ...this.settle(todo.id, "delete", cancelled ? "cancelled" : "failed"),
          mutationError: cancelled ? "cancelled" : "delete_failed",
          announcement: "",
        });
      }
    })();
    return true;
  };

  readonly undoDelete = (): boolean => {
    const undo = this.undo;
    const notice = this.state.undoNotice;
    if (!undo || !notice || notice.pending) return false;
    const mutation = this.beginMutation("restore", undo.todo.id);
    if (!mutation) return false;
    this.replace({ undoNotice: { ...notice, pending: true, error: null } });
    void (async () => {
      try {
        const restored = await withAbort(
          this.service.restoreTodo(undo.todo.id, undo.token, { signal: mutation.signal }),
          mutation.signal,
        );
        if (!this.isCurrentMutation(mutation.revision)) return;
        if (typeof restored !== "boolean") throw new RangeError("Invalid restore response.");
        if (!restored) {
          mutation.finish({
            undoNotice: { ...notice, pending: false, error: TODO_UNDO_COPY.unavailable },
            announcement: "",
          });
          return;
        }
        this.undo = null;
        this.confirmed = this.withTodo(this.confirmed, undo.todo, undo.originalIndex);
        this.publish(this.withTodo(this.current(), undo.todo, undo.originalIndex));
        mutation.finish({ undoNotice: null, announcement: `${todoLabel(undo.todo)} restored.` });
      } catch (error) {
        if (!this.isCurrentMutation(mutation.revision)) return;
        const interrupted = mutation.signal.aborted || isAbortError(error);
        mutation.finish({
          undoNotice: {
            ...notice,
            pending: false,
            error: interrupted ? TODO_UNDO_COPY.interrupted : TODO_UNDO_COPY.failed,
          },
          announcement: "",
        });
      }
    })();
    return true;
  };

  readonly dismissUndo = (): void => {
    if (!this.active || !this.undo || this.state.undoNotice?.pending) return;
    this.undo = null;
    this.replace({ undoNotice: null, announcement: "Undo dismissed." });
  };

  private async persistReorder(
    reordered: readonly TodayTodo[],
    moved: TodayTodo,
    announcement: string,
  ): Promise<boolean> {
    let optimistic: readonly TodayTodo[];
    try {
      optimistic = applyOptimisticTodayRanks(reordered);
    } catch {
      this.replace({ mutationError: "reorder_too_large", announcement: "" });
      return false;
    }
    const mutation = this.beginMutation("reorder", moved.id);
    if (!mutation) return false;
    const requestDate = this.todayDate;
    this.publish({ todos: this.state.todos, todayRows: optimistic });
    try {
      const updates = await withAbort(
        this.service.reorderToday(
          requestDate,
          optimistic.map((todo) => todo.id),
          { signal: mutation.signal },
        ),
        mutation.signal,
      );
      if (!this.isCurrentMutation(mutation.revision)) return false;
      const persisted = applyPersistedTodayRanks(optimistic, updates);
      const ranks = new Map(persisted.map((row) => [row.id.toLowerCase(), row.todayRank] as const));
      const withRanks = (todos: readonly Todo[]) =>
        todos.map((todo) => {
          const rank = ranks.get(todo.id.toLowerCase());
          return rank === undefined ? todo : { ...todo, todayRank: rank };
        });
      const requested = new Set(ranks.keys());
      const todayRows = [
        ...rebaseRows(persisted, this.todayDate),
        ...this.confirmed.todayRows.filter((row) => !requested.has(row.id.toLowerCase())),
      ];
      this.confirmed = { todos: withRanks(this.confirmed.todos), todayRows };
      this.publish({ todos: withRanks(this.state.todos), todayRows }, { announcement });
      mutation.finish();
      return true;
    } catch (error) {
      if (!this.isCurrentMutation(mutation.revision)) return false;
      const cancelled = mutation.signal.aborted || isAbortError(error);
      this.publish(this.confirmed, {});
      mutation.finish({
        mutationError: cancelled ? "cancelled" : "reorder_failed",
        announcement: "",
      });
      return false;
    }
  }

  readonly moveTodo = (todoId: UUID, direction: MoveDirection): Promise<boolean> => {
    const { todos } = this.state.today;
    const todo = todos.find((row) => sameId(row.id, todoId));
    if (!this.active || !todo) return Promise.resolve(false);
    const reordered = moveTodayListTodo(todos, todo.id, direction);
    if (reordered === todos) return Promise.resolve(false);
    return this.persistReorder(
      reordered,
      todo,
      `${todoLabel(todo)} moved ${direction}. Order saved.`,
    );
  };

  readonly placeTodo = (
    todoId: UUID,
    targetTodoId: UUID,
    placement: TodayDropPlacement,
  ): Promise<boolean> => {
    const { todos } = this.state.today;
    const todo = todos.find((row) => sameId(row.id, todoId));
    const target = todos.find((row) => sameId(row.id, targetTodoId));
    if (!this.active || !todo || !target) return Promise.resolve(false);
    const reordered = placeTodayListTodo(todos, todo.id, target.id, placement);
    if (reordered === todos) return Promise.resolve(false);
    return this.persistReorder(reordered, todo, `${todoLabel(todo)} moved. Order saved.`);
  };

  /** Reconcile one persisted create from the shared Add flow without reloading. */
  readonly acceptCreatedTodo = (response: Todo): boolean => {
    if (!this.active) return false;
    const todo = readTodoResponse(response);
    if (!todo || this.state.pendingTodoIds.has(todo.id)) return false;
    this.recentCreates.set(todo.id.toLowerCase(), { sequence: ++this.creationSequence, todo });
    this.publish(this.confirmTodo(todo));
    return true;
  };
}

export interface TodoControllerBinding {
  readonly state: TodoControllerState;
  readonly controller: TodoController;
}

export interface TodoControllerView {
  /** Load the full account workspace (board columns, Tomorrow, projects). */
  readonly workspace?: boolean;
  /** Load and follow the Today RPC slice for this local date. */
  readonly localDate?: SqlDate | null;
}

/**
 * Account changes replace the controller; a service swap under the same key
 * also replaces it so retained callbacks cannot write through an old provider.
 * Local midnight keeps the instance and therefore its Undo token.
 */
export function useTodoController(
  service: TodoService,
  sessionKey: string,
  { workspace = false, localDate = null }: TodoControllerView = {},
): TodoControllerBinding {
  if (!sessionKey || sessionKey !== sessionKey.trim()) {
    throw new RangeError("Tasks require an authenticated session scope.");
  }
  // Lifecycle key only: never passed to a provider as a user ID.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionKey is a reset key: an account swap must replace the controller.
  const controller = useMemo(() => new TodoController(service), [service, sessionKey]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const revision = useWorkspaceRevision();
  const appliedRevision = useRef({ controller, revision });
  // Abort an old account before the new commit can expose retained callbacks.
  useLayoutEffect(() => controller.stop, [controller]);
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  useEffect(() => {
    if (workspace) void controller.loadWorkspace();
  }, [controller, workspace]);
  useEffect(() => {
    if (localDate) void controller.setLocalDate(localDate);
  }, [controller, localDate]);
  useEffect(() => {
    const previous = appliedRevision.current;
    appliedRevision.current = { controller, revision };
    // A new controller loads on its own; an external write refreshes this one.
    if (previous.controller === controller && previous.revision !== revision)
      void controller.refresh();
  }, [controller, revision]);
  // The date prop can change before layout effects run. Never expose the prior
  // timezone/day's eligibility in that render.
  const visible =
    localDate && state.today.localDate !== localDate && state.todayStatus !== "idle"
      ? {
          ...state,
          todayStatus: "loading" as const,
          today: buildTodayListModel(rebaseRows(state.today.todos, localDate), localDate),
        }
      : state;
  return { state: visible, controller };
}
