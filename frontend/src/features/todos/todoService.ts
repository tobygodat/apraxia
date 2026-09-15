import type {
  DeleteUndoToken,
  LocalDate,
  LocalTime,
  NewTodoInput,
  Profile,
  ProjectSummary,
  TodayTodo,
  Todo,
  UUID,
} from "../../types/domain";

export interface TodoRequestOptions {
  readonly signal: AbortSignal;
}

export interface TodoWorkspaceSnapshot {
  readonly profile: Profile;
  readonly projects: readonly ProjectSummary[];
  /** Active rows only. Soft-deleted records stay behind the restore RPC. */
  readonly todos: readonly Todo[];
}

type TodoTextOrProjectUpdate =
  | {
      readonly text: string;
      readonly projectId?: UUID | null;
      readonly dueDate?: never;
      readonly dueTime?: never;
    }
  | {
      readonly projectId: UUID | null;
      readonly text?: string;
      readonly dueDate?: never;
      readonly dueTime?: never;
    };

type TodoScheduleUpdate =
  | {
      readonly dueDate: LocalDate;
      readonly dueTime?: LocalTime | null;
      readonly text?: string;
      readonly projectId?: UUID | null;
    }
  | {
      /** Clearing a date must clear any persisted time atomically. */
      readonly dueDate: null;
      readonly dueTime: null;
      readonly text?: string;
      readonly projectId?: UUID | null;
    }
  | {
      /** Clearing only the time is valid regardless of the current date. */
      readonly dueTime: null;
      readonly dueDate?: never;
      readonly text?: string;
      readonly projectId?: UUID | null;
    };

/**
 * A details update must name a field and cannot create a time-without-date
 * state at the provider boundary.
 */
export type UpdateTodoDetailsInput = TodoTextOrProjectUpdate | TodoScheduleUpdate;

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

  setTodoCompleted(todoId: UUID, completed: boolean, options: TodoRequestOptions): Promise<Todo>;

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
