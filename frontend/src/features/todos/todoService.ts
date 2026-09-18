import type {
  ClassSummary,
  DeleteUndoToken,
  LocalDate,
  LocalTime,
  NewTodoInput,
  Profile,
  ProjectSummary,
  TodayTodo,
  Todo,
  TodoRecurrence,
  UUID,
} from "../../types/domain";

export interface TodoRequestOptions {
  readonly signal: AbortSignal;
  /** Scope Classes requests to one class without changing ordinary task behavior. */
  readonly classId?: string;
}

export interface TodoWorkspaceSnapshot {
  readonly profile: Profile;
  readonly projects: readonly ProjectSummary[];
  readonly classes: readonly ClassSummary[];
  /** Active rows only. Soft-deleted records stay behind the restore RPC. */
  readonly todos: readonly Todo[];
}

type TodoTextOrProjectUpdate =
  | {
      readonly text: string;
      readonly projectId?: UUID | null;
      readonly dueDate?: never;
      readonly dueTime?: never;
      readonly recurrence?: never;
    }
  | {
      readonly projectId: UUID | null;
      readonly text?: string;
      readonly dueDate?: never;
      readonly dueTime?: never;
      readonly recurrence?: never;
    };

type TodoScheduleUpdate =
  | {
      readonly dueDate: LocalDate;
      readonly dueTime?: LocalTime | null;
      readonly recurrence?: TodoRecurrence | null;
      readonly text?: string;
      readonly projectId?: UUID | null;
    }
  | {
      /** Clearing a date must clear any persisted time and repeat rule atomically. */
      readonly dueDate: null;
      readonly dueTime: null;
      readonly recurrence?: null;
      readonly text?: string;
      readonly projectId?: UUID | null;
    }
  | {
      /** Clearing only the time is valid regardless of the current date. */
      readonly dueTime: null;
      readonly dueDate?: never;
      readonly recurrence?: never;
      readonly text?: string;
      readonly projectId?: UUID | null;
    };

type TodoAssignmentUpdate = {
  readonly assignmentType: string;
  readonly text?: string;
  readonly projectId?: never;
  readonly dueDate?: never;
  readonly dueTime?: never;
  readonly recurrence?: never;
};

/** A task belongs to at most one project or class; the type is class-only. */
interface TodoParentFields {
  readonly classId?: string | null;
  readonly assignmentType?: string;
}

/**
 * A details update must name a field and cannot create a time-without-date
 * state at the provider boundary.
 */
export type UpdateTodoDetailsInput = (
  TodoTextOrProjectUpdate | TodoScheduleUpdate | TodoAssignmentUpdate
) &
  TodoParentFields;

/**
 * Completing a repeating task materializes its successor, and undoing that
 * completion withdraws the successor again, both inside the same write. The
 * answer therefore has to name the occurrence that appeared or disappeared
 * alongside the row the caller asked about.
 */
export interface TodoCompletionResult {
  readonly todo: Todo;
  readonly spawned: Todo | null;
  readonly withdrawn: UUID | null;
}

export interface TodayRankUpdate {
  readonly todoId: UUID;
  readonly todayRank: number;
}

/**
 * Browser-facing Todo operations. Ownership is always derived from the active
 * Supabase session and is deliberately absent from every method signature.
 * The concrete Supabase adapter uses the generated database.ts contract.
 */
export interface TodoService {
  loadWorkspace(options: TodoRequestOptions): Promise<TodoWorkspaceSnapshot>;

  createTodo(input: NewTodoInput, options: TodoRequestOptions): Promise<Todo>;

  updateTodoDetails(
    todoId: UUID,
    input: UpdateTodoDetailsInput,
    options: TodoRequestOptions,
  ): Promise<Todo>;

  setTodoCompleted(
    todoId: UUID,
    completed: boolean,
    options: TodoRequestOptions,
  ): Promise<TodoCompletionResult>;

  softDeleteTodo(todoId: UUID, options: TodoRequestOptions): Promise<DeleteUndoToken>;

  restoreTodo(
    todoId: UUID,
    undoToken: DeleteUndoToken,
    options: TodoRequestOptions,
  ): Promise<boolean>;

  loadToday(localDate: LocalDate, options: TodoRequestOptions): Promise<readonly TodayTodo[]>;

  /** The complete eligible ID list is required for the atomic reorder RPC. */
  reorderToday(
    localDate: LocalDate,
    orderedTodoIds: readonly UUID[],
    options: TodoRequestOptions,
  ): Promise<readonly TodayRankUpdate[]>;
}
