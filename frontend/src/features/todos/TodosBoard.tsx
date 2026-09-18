import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import { useColdLoad } from "../../apps/coldLoad";
import type { ProjectSummary, Todo } from "../../types/domain";
import { ArrowIcon, CloseIcon, PlusIcon } from "../../components/icons";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import {
  useWorkspacePreferences,
  type WorkspaceThemePreset,
} from "../../apps/workspacePreferences";
import { addSqlDateDays } from "./dateDomain";
import { formatTaskDate, formatTaskTime } from "./taskFormatting";
import type { TodoBoardColumn, TodoBoardModel } from "./todoBoardModel";
import type { TodoAnnouncement, TodoMutationResult, TodoUndoNotice } from "./todoController";
import { TodoRepeatMark } from "./TodoRepeatMark";
import { TodoSourceChip } from "./TodoSourceChip";
import {
  todoLoadErrorCopy,
  todoMutationErrorCopy,
  type TodoLoadStatus,
  type TodoMutationErrorKind,
} from "./todoUiState";
import "./TodosBoard.css";
import "./TodosBoardClassic.css";
import "./TodosBoardLedger.css";

export interface TodosBoardProps {
  readonly model: TodoBoardModel;
  readonly loadStatus?: TodoLoadStatus;
  /** True once the board has ever received a workspace snapshot. */
  readonly loaded?: boolean;
  readonly pendingTodoIds?: ReadonlySet<string>;
  readonly projects?: readonly ProjectSummary[];
  readonly mutationResult?: TodoMutationResult | null;
  readonly mutationError?: TodoMutationErrorKind | null;
  readonly undoNotice?: TodoUndoNotice | null;
  /** Controller-issued live-region text for settled writes and Undo. */
  readonly announcement?: TodoAnnouncement;
  readonly onUndoDelete?: () => void;
  readonly onDismissUndo?: () => void;
  readonly onPreviousWeek: () => void;
  readonly onNextWeek: () => void;
  readonly onToday: () => void;
  readonly onRetry: () => void;
  readonly onAddTodo: (dueDate: string | null) => void;
  /** Return true only when a mutation was actually started. */
  readonly onToggleComplete: (todo: Todo) => boolean;
  readonly onEditTodo: (todo: Todo) => void;
  /** Return true only when the soft-delete mutation was actually started. */
  readonly onDeleteTodo: (todo: Todo) => boolean;
  /** Reschedules a todo to a new due date; null moves it to the Inbox. */
  readonly onRescheduleTodo?: (todo: Todo, dueDate: string | null) => void;
  /** Overrides the workspace theme preference; used by tests. */
  readonly theme?: WorkspaceThemePreset;
}

/** Private marker identifying a board-row drag; mirrors TodayList's own marker. */
const TODO_DRAG_TYPE = "application/x-apraxia-todo";

function isTodoDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes(TODO_DRAG_TYPE));
}

interface FocusOwnership {
  /** Cleared as soon as the user focuses a newer interaction. */
  focusOwner: HTMLElement | null;
}

const HEADING_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  weekday: "long",
};
const RANGE_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

function formatDateHeading(value: string, today: string): string {
  const formatted = formatTaskDate(value, HEADING_FORMAT);
  if (value === today) return `${formatted} · Today`;
  if (value === addSqlDateDays(today, 1)) return `${formatted} · Tomorrow`;
  return formatted;
}

function columnLabel(column: TodoBoardColumn, today: string): string {
  if (column.kind === "inbox") return "Inbox";
  return formatDateHeading(column.date!, today);
}

function columnQualifier(value: string, today: string): string {
  if (value === today) return " · Today";
  if (value === addSqlDateDays(today, 1)) return " · Tomorrow";
  return "";
}

function columnDateParts(value: string): { day: string; month: string } {
  return {
    day: formatTaskDate(value, { day: "numeric" }),
    month: formatTaskDate(value, { month: "short" }),
  };
}

function columnWeekday(value: string): string {
  return formatTaskDate(value, { weekday: "short" });
}

/**
 * Groups date columns into layout tracks. A 7-column week pairs its last two
 * columns into one stacked track: on the current week those are the two days
 * furthest behind Today, which hold completed work only, so the half-height
 * track falls on the week's lightest days.
 */
function buildTracks(dateColumns: readonly TodoBoardColumn[]): (readonly TodoBoardColumn[])[] {
  if (dateColumns.length === 7) {
    return [...dateColumns.slice(0, 5).map((column) => [column] as const), dateColumns.slice(5, 7)];
  }
  return dateColumns.map((column) => [column] as const);
}

const SOURCE_FILTERS = ["All", "Projects", "Classes", "Unassigned"] as const;
type SourceFilter = (typeof SOURCE_FILTERS)[number];

function matchesSource(todo: Todo, filter: SourceFilter): boolean {
  if (filter === "Projects") return Boolean(todo.projectId);
  if (filter === "Classes") return Boolean(todo.classId);
  if (filter === "Unassigned") return !todo.projectId && !todo.classId;
  return true;
}

function weekRangeLabel(monday: string): string {
  return `${formatTaskDate(monday, RANGE_FORMAT)} – ${formatTaskDate(addSqlDateDays(monday, 6), RANGE_FORMAT)}`;
}

function TodoCard({
  todo,
  pending,
  deleteLocked,
  undoSummaryId,
  titleId,
  primaryControlId,
  projectTitle,
  showDueDate,
  dragging,
  onToggleComplete,
  onEditTodo,
  onDeleteTodo,
  onDragStart,
  onDragEnd,
}: {
  readonly todo: Todo;
  readonly pending: boolean;
  readonly deleteLocked: boolean;
  readonly undoSummaryId: string;
  readonly titleId: string;
  readonly primaryControlId: string;
  readonly projectTitle: string | null;
  readonly showDueDate: boolean;
  readonly dragging: boolean;
  readonly onToggleComplete: (todo: Todo) => void;
  readonly onEditTodo: (todo: Todo) => void;
  readonly onDeleteTodo: (todo: Todo) => void;
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd: () => void;
}) {
  return (
    <article
      className={`todos-board-card${todo.completed ? " todos-board-card--completed" : ""}${
        dragging ? " todos-board-card--dragging" : ""
      }`}
      aria-labelledby={titleId}
      aria-busy={pending || undefined}
      draggable={!pending}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <label className="todos-board-card__check">
        <input
          id={primaryControlId}
          type="checkbox"
          checked={todo.completed}
          disabled={pending}
          onChange={() => onToggleComplete(todo)}
        />
        <span aria-hidden="true" />
        <span className="todos-board-sr-only">
          {todo.completed ? "Mark as incomplete" : "Mark as complete"} {todo.text}
        </span>
      </label>

      <div className="todos-board-card__body">
        <p id={titleId}>{todo.text}</p>
        {showDueDate || todo.dueTime || todo.recurrence || projectTitle || todo.classId ? (
          <div className="todos-board-card__metadata">
            {showDueDate && todo.dueDate ? (
              // Past-due tasks sit under Today; the original date stays visible in red.
              <time className="todos-board-card__due--past" dateTime={todo.dueDate}>
                <span className="todos-board-sr-only">Past due. </span>
                Due {formatTaskDate(todo.dueDate, RANGE_FORMAT)}
              </time>
            ) : null}
            {todo.dueTime ? (
              <time dateTime={todo.dueTime}>{formatTaskTime(todo.dueTime)}</time>
            ) : null}
            <TodoRepeatMark recurrence={todo.recurrence} />
            <TodoSourceChip todo={todo} projectTitle={projectTitle} />
          </div>
        ) : null}
      </div>

      <div className="todos-board-card__actions">
        <button
          type="button"
          disabled={pending}
          onClick={() => onEditTodo(todo)}
          aria-label={`Edit ${todo.text}`}
          title="Edit task"
        >
          <WorkspaceIcon name="edit" />
        </button>
        <button
          type="button"
          disabled={pending}
          aria-disabled={deleteLocked || undefined}
          aria-describedby={deleteLocked ? undoSummaryId : undefined}
          onClick={() => {
            if (!deleteLocked) onDeleteTodo(todo);
          }}
          aria-label={`Delete ${todo.text}`}
          title="Delete task"
        >
          <WorkspaceIcon name="trash" />
        </button>
      </div>
    </article>
  );
}

export function TodosBoard({
  model: fullModel,
  loadStatus = "ready",
  loaded = false,
  pendingTodoIds = new Set<string>(),
  projects = [],
  mutationResult = null,
  mutationError = null,
  undoNotice = null,
  announcement = { sequence: 0, message: "" },
  onUndoDelete,
  onDismissUndo,
  onPreviousWeek,
  onNextWeek,
  onToday,
  onRetry,
  onAddTodo,
  onToggleComplete,
  onEditTodo,
  onDeleteTodo,
  onRescheduleTodo,
  theme: themeOverride,
}: TodosBoardProps) {
  const { preferences } = useWorkspacePreferences();
  const theme = themeOverride ?? preferences.theme;
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("All");
  const [draggingTodoId, setDraggingTodoId] = useState<string | null>(null);
  const [dropColumnKey, setDropColumnKey] = useState<string | null>(null);
  const boardRegionRef = useRef<HTMLDivElement | null>(null);
  const draggedTodoRef = useRef<Todo | null>(null);
  const draggedFromColumnKeyRef = useRef<string | null>(null);
  // Filtering keeps column order and each column's saved order intact.
  const model = useMemo(
    () =>
      sourceFilter === "All"
        ? fullModel
        : {
            ...fullModel,
            columns: fullModel.columns.map((column) => ({
              ...column,
              todos: column.todos.filter((todo) => matchesSource(todo, sourceFilter)),
            })),
          },
    [fullModel, sourceFilter],
  );
  const idBase = useId();
  const focusRecoveryRef = useRef<
    | ({
        readonly sourceTodoId: string;
        readonly action: "complete" | "delete";
        readonly sourceControlId: string;
        readonly targetIds: readonly string[];
        readonly resultSequenceAtStart: number;
        sawPending: boolean;
        fallbackFocused: boolean;
        awaitingRollback: boolean;
      } & FocusOwnership)
    | null
  >(null);
  const undoActionRef = useRef<
    | ({
        readonly kind: "restore" | "dismiss";
        readonly todoId: string;
      } & FocusOwnership)
    | null
  >(null);
  const boardRegionId = `${idBase}-task-region`;
  const undoSummaryId = `${idBase}-undo-summary`;
  // A second delete while the Undo notice is open is refused by the
  // controller, so the board has to say so instead of doing nothing.
  const deleteLocked = undoNotice !== null;
  const projectTitles = new Map(projects.map((project) => [project.id, project.title] as const));

  const todoControlId = useCallback(
    (todoId: string) => `${idBase}-todo-${encodeURIComponent(todoId)}`,
    [idBase],
  );
  const columnHeadingId = (columnKey: string) =>
    `${idBase}-column-${encodeURIComponent(columnKey)}`;
  const columnAddId = (columnKey: string) => `${idBase}-add-${encodeURIComponent(columnKey)}`;

  useLayoutEffect(() => {
    const preserveNewerFocus = (event: FocusEvent) => {
      for (const ownership of [focusRecoveryRef.current, undoActionRef.current]) {
        if (
          ownership?.focusOwner &&
          event.target !== ownership.focusOwner &&
          event.target !== document.body &&
          event.target !== document.documentElement
        ) {
          ownership.focusOwner = null;
        }
      }
    };

    document.addEventListener("focusin", preserveNewerFocus);
    return () => document.removeEventListener("focusin", preserveNewerFocus);
  }, []);

  function focusedElementWithin(element: Element | null): HTMLElement | null {
    const activeElement = document.activeElement;
    return activeElement instanceof HTMLElement && element?.contains(activeElement)
      ? activeElement
      : null;
  }

  function prepareFocusRecovery(
    column: TodoBoardColumn,
    todoIndex: number,
    todo: Todo,
    action: "complete" | "delete",
  ) {
    const adjacentTodo = [column.todos[todoIndex + 1], column.todos[todoIndex - 1]].find(
      (candidate) => candidate !== undefined && !pendingTodoIds.has(candidate.id),
    );
    const targetIds = [
      adjacentTodo ? todoControlId(adjacentTodo.id) : null,
      column.canAdd ? columnAddId(column.key) : null,
      columnHeadingId(column.key),
      boardRegionId,
    ].filter((targetId): targetId is string => targetId !== null);

    focusRecoveryRef.current = {
      sourceTodoId: todo.id,
      action,
      sourceControlId: todoControlId(todo.id),
      targetIds,
      resultSequenceAtStart: mutationResult?.sequence ?? -1,
      sawPending: false,
      fallbackFocused: false,
      awaitingRollback: false,
      focusOwner: focusedElementWithin(
        document.getElementById(todoControlId(todo.id))?.closest("article") ?? null,
      ),
    };
  }

  function focusFirstAvailable(ownership: FocusOwnership, targetIds: readonly string[]) {
    const activeElement = document.activeElement;
    if (
      ownership.focusOwner === null ||
      (activeElement !== ownership.focusOwner &&
        activeElement !== document.body &&
        activeElement !== document.documentElement &&
        activeElement !== null)
    ) {
      return;
    }

    for (const targetId of targetIds) {
      const target = document.getElementById(targetId);
      if (!target) continue;
      if (
        (target instanceof HTMLButtonElement ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement) &&
        target.disabled
      ) {
        continue;
      }

      // Retain ownership of our fallback so a later rollback may restore it,
      // but release it permanently if a newer control or modal gains focus.
      const previousOwner: HTMLElement | null = ownership.focusOwner;
      ownership.focusOwner = target;
      target.focus();
      if (document.activeElement === target) return;
      ownership.focusOwner = previousOwner;
    }
  }

  useLayoutEffect(() => {
    const recovery = focusRecoveryRef.current;
    if (!recovery) return;

    const sourceExists = model.columns.some((column) =>
      column.todos.some((todo) => todo.id === recovery.sourceTodoId),
    );

    const hasNewMatchingSettlement =
      mutationResult !== null &&
      mutationResult.sequence > recovery.resultSequenceAtStart &&
      mutationResult.todoId === recovery.sourceTodoId &&
      mutationResult.action === recovery.action;

    if (recovery.awaitingRollback) {
      if (sourceExists) {
        focusFirstAvailable(recovery, [recovery.sourceControlId]);
        focusRecoveryRef.current = null;
      }
      return;
    }

    if (
      hasNewMatchingSettlement &&
      (mutationResult.status === "failed" || mutationResult.status === "cancelled")
    ) {
      if (sourceExists) {
        focusFirstAvailable(recovery, [recovery.sourceControlId]);
        focusRecoveryRef.current = null;
      } else {
        if (!recovery.fallbackFocused) {
          focusFirstAvailable(recovery, recovery.targetIds);
          recovery.fallbackFocused = true;
        }
        recovery.awaitingRollback = true;
      }
      return;
    }

    const sourceTodo = model.columns
      .flatMap((column) => column.todos)
      .find((todo) => todo.id === recovery.sourceTodoId);
    const successfulModelState =
      !sourceExists || (recovery.action === "complete" && sourceTodo?.completed === true);

    if (hasNewMatchingSettlement && mutationResult.status === "succeeded" && successfulModelState) {
      if (!sourceExists && !recovery.fallbackFocused) {
        focusFirstAvailable(recovery, recovery.targetIds);
      }
      focusRecoveryRef.current = null;
      return;
    }

    if (!sourceExists) {
      // Optimistic removal may be useful for responsiveness, but it is not a
      // successful mutation yet. Recover focus without announcing or exposing
      // Undo until the parent supplies a fresh matching settlement.
      if (!recovery.fallbackFocused) {
        focusFirstAvailable(recovery, recovery.targetIds);
        recovery.fallbackFocused = true;
      }
      return;
    }

    if (pendingTodoIds.has(recovery.sourceTodoId)) {
      recovery.sawPending = true;
    } else if (recovery.sawPending) {
      // The mutation settled without removing the row (for example a rollback
      // or a completed task that remains visible in a historical column).
      focusRecoveryRef.current = null;
    }
  }, [model, mutationResult, pendingTodoIds]);

  useLayoutEffect(() => {
    const undoAction = undoActionRef.current;
    if (!undoAction || undoNotice !== null) return;

    focusFirstAvailable(undoAction, [
      ...(undoAction.kind === "restore" ? [todoControlId(undoAction.todoId)] : []),
      boardRegionId,
    ]);
    undoActionRef.current = null;
  }, [boardRegionId, model, todoControlId, undoNotice]);

  const navigationPending = loadStatus === "loading";
  useColdLoad(loadStatus === "loading" && !loaded);

  // The classic board scrolls sideways. Whenever a different column takes the
  // lead the board returns to it, so neither a week change nor a local-midnight
  // rollover leaves the leading day scrolled out of view. Keying on the leading
  // column rather than the visible week covers the rollover, which rotates a new
  // date into first place while the week's Monday stays put. Source filtering
  // preserves column keys, so it never scrolls the board on its own.
  const leadingColumnKey = model.columns[0]?.key;
  useLayoutEffect(() => {
    if (boardRegionRef.current) boardRegionRef.current.scrollLeft = 0;
  }, [leadingColumnKey]);

  function clearDrag() {
    draggedTodoRef.current = null;
    draggedFromColumnKeyRef.current = null;
    setDraggingTodoId(null);
    setDropColumnKey(null);
  }

  function handleColumnDragOver(event: DragEvent<HTMLElement>, column: TodoBoardColumn) {
    if (!isTodoDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const fromColumnKey = draggedFromColumnKeyRef.current;
    const isCurrentColumn = fromColumnKey !== null && fromColumnKey === column.key;
    setDropColumnKey(isCurrentColumn ? null : column.key);
  }

  function handleColumnDragLeave(event: DragEvent<HTMLElement>, column: TodoBoardColumn) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDropColumnKey((current) => (current === column.key ? null : current));
  }

  function handleColumnDrop(event: DragEvent<HTMLElement>, column: TodoBoardColumn) {
    if (!isTodoDrag(event.dataTransfer)) return;
    event.preventDefault();
    const todoId = event.dataTransfer?.getData("text/plain");
    const dragged = draggedTodoRef.current;
    const fromColumnKey = draggedFromColumnKeyRef.current;
    clearDrag();
    if (!todoId || !dragged || dragged.id !== todoId) return;
    if (fromColumnKey !== null && fromColumnKey === column.key) return;
    const targetDate = column.kind === "inbox" ? null : (column.date ?? null);
    onRescheduleTodo?.(dragged, targetDate);
  }

  const renderCards = (column: TodoBoardColumn) =>
    column.todos.map((todo, todoIndex) => (
      <TodoCard
        key={todo.id}
        todo={todo}
        pending={pendingTodoIds.has(todo.id)}
        deleteLocked={deleteLocked}
        undoSummaryId={undoSummaryId}
        primaryControlId={todoControlId(todo.id)}
        projectTitle={todo.projectId ? (projectTitles.get(todo.projectId) ?? null) : null}
        showDueDate={!todo.completed && todo.dueDate !== null && todo.dueDate < model.today}
        titleId={`${todoControlId(todo.id)}-title`}
        dragging={draggingTodoId === todo.id}
        onToggleComplete={(selectedTodo) => {
          const started = onToggleComplete(selectedTodo);
          if (started && !selectedTodo.completed) {
            prepareFocusRecovery(column, todoIndex, selectedTodo, "complete");
          }
        }}
        onEditTodo={onEditTodo}
        onDeleteTodo={(selectedTodo) => {
          if (onDeleteTodo(selectedTodo)) {
            prepareFocusRecovery(column, todoIndex, selectedTodo, "delete");
          }
        }}
        onDragStart={(event) => {
          if (pendingTodoIds.has(todo.id)) {
            event.preventDefault();
            return;
          }
          draggedTodoRef.current = todo;
          draggedFromColumnKeyRef.current = column.key;
          setDraggingTodoId(todo.id);
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", todo.id);
            event.dataTransfer.setData(TODO_DRAG_TYPE, todo.id);
          }
        }}
        onDragEnd={clearDrag}
      />
    ));

  const renderAddSlot = (column: TodoBoardColumn, label: string) =>
    column.canAdd ? (
      <button
        className="todos-board-add"
        id={columnAddId(column.key)}
        type="button"
        onClick={() => onAddTodo(column.date)}
        aria-label={`Add task to ${label}`}
      >
        <PlusIcon />
        Add task
      </button>
    ) : null;

  const renderDateColumn = (column: TodoBoardColumn, stacked: boolean) => {
    const label = columnLabel(column, model.today);
    const headingId = columnHeadingId(column.key);
    const { day, month } = columnDateParts(column.date!);
    const weekday = columnWeekday(column.date!);
    const qualifier = columnQualifier(column.date!, model.today);
    const isToday = column.date === model.today;
    const minSlots = stacked ? 4 : 9;
    const fillers = Math.max(0, minSlots - column.todos.length - 1);

    return (
      <section
        className={`todos-board-column todos-board-column--${column.kind}${
          stacked ? " todos-board-column--stacked" : ""
        }${isToday ? " todos-board-column--today" : ""}${
          dropColumnKey === column.key ? " todos-board-column--drop" : ""
        }`}
        key={column.key}
        aria-labelledby={headingId}
        onDragOver={(event) => handleColumnDragOver(event, column)}
        onDragLeave={(event) => handleColumnDragLeave(event, column)}
        onDrop={(event) => handleColumnDrop(event, column)}
      >
        <header className="todos-board-column__header">
          <h2 id={headingId} tabIndex={-1}>
            <span className="todos-board-column__date">
              {day} {month}
            </span>
            <span className="todos-board-column__weekday">{weekday}</span>
            <span className="todos-board-sr-only">{qualifier}</span>
          </h2>
          <span className="todos-board-sr-only">
            {column.todos.length} {column.todos.length === 1 ? "task" : "tasks"}
          </span>
        </header>

        <div className="todos-board-column__tasks">
          {renderCards(column)}
          {renderAddSlot(column, label)}
          {Array.from({ length: fillers }).map((_, index) => (
            <div className="todos-board-slot" aria-hidden="true" key={index} />
          ))}
        </div>
      </section>
    );
  };

  const renderLedgerInbox = (column: TodoBoardColumn) => {
    const label = columnLabel(column, model.today);
    const headingId = columnHeadingId(column.key);

    return (
      <section
        className={`todos-board-inbox${dropColumnKey === column.key ? " todos-board-inbox--drop" : ""}`}
        key={column.key}
        aria-labelledby={headingId}
        onDragOver={(event) => handleColumnDragOver(event, column)}
        onDragLeave={(event) => handleColumnDragLeave(event, column)}
        onDrop={(event) => handleColumnDrop(event, column)}
      >
        <h2 id={headingId} tabIndex={-1}>
          {label}
        </h2>
        <span className="todos-board-sr-only">
          {column.todos.length} {column.todos.length === 1 ? "task" : "tasks"}
        </span>
        <div className="todos-board-inbox__tasks">
          {renderCards(column)}
          {renderAddSlot(column, label)}
        </div>
      </section>
    );
  };

  const renderClassicColumn = (column: TodoBoardColumn) => {
    const label = columnLabel(column, model.today);
    const headingId = columnHeadingId(column.key);

    return (
      <section
        className={`todos-board-column todos-board-column--${column.kind}${
          column.date === model.today ? " todos-board-column--today" : ""
        }${dropColumnKey === column.key ? " todos-board-column--drop" : ""}`}
        key={column.key}
        aria-labelledby={headingId}
        onDragOver={(event) => handleColumnDragOver(event, column)}
        onDragLeave={(event) => handleColumnDragLeave(event, column)}
        onDrop={(event) => handleColumnDrop(event, column)}
      >
        <header className="todos-board-column__header">
          <h2 id={headingId} tabIndex={-1}>
            {label}
          </h2>
          <span aria-hidden="true">{column.todos.length}</span>
          <span className="todos-board-sr-only">
            {column.todos.length} {column.todos.length === 1 ? "task" : "tasks"}
          </span>
        </header>

        <div className="todos-board-column__tasks">
          {renderCards(column)}
          {renderAddSlot(column, label)}
        </div>
      </section>
    );
  };

  const dateColumns = model.columns.filter((column) => column.kind === "date");
  const inboxColumn = model.columns.find((column) => column.kind === "inbox") ?? null;
  const tracks = buildTracks(dateColumns);

  return (
    <section
      className={`todos-board-page todos-board-page--${theme}`}
      aria-labelledby="todos-board-heading"
    >
      <header className="todos-board-toolbar">
        <div>
          <h1 id="todos-board-heading">Tasks</h1>
          <p
            className={theme === "classic" ? "todos-board-week" : "todos-board-range"}
            aria-live="polite"
          >
            {weekRangeLabel(model.visibleWeekMonday)}
          </p>
        </div>

        <div className="todos-board-controls">
          <label className="todos-board-filter">
            Source
            <select
              aria-label="Task source"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as SourceFilter)}
            >
              {SOURCE_FILTERS.map((source) => (
                <option key={source}>{source}</option>
              ))}
            </select>
          </label>
          <nav className="todos-board-nav" aria-label="Task week navigation">
            <button
              type="button"
              onClick={onPreviousWeek}
              aria-label="Previous week"
              disabled={navigationPending}
            >
              <ArrowIcon direction="left" />
            </button>
            <button
              type="button"
              onClick={onToday}
              disabled={model.isCurrentWeek || navigationPending}
            >
              Today
            </button>
            <button
              type="button"
              onClick={onNextWeek}
              aria-label="Next week"
              disabled={navigationPending}
            >
              <ArrowIcon direction="right" />
            </button>
          </nav>
        </div>
      </header>

      {loadStatus === "error" ? (
        <div className="todos-board-error" role="alert">
          <p>{todoLoadErrorCopy("Tasks")}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}

      {loadStatus === "loading" && !loaded ? (
        <p className="cloud-shell__sr-only" role="status">
          Loading tasks…
        </p>
      ) : null}

      {mutationError ? (
        <p className="todos-board-error todos-board-error--mutation" role="alert">
          {todoMutationErrorCopy(mutationError)}
        </p>
      ) : null}

      {theme === "classic" ? (
        <div
          className="todos-board-scroll"
          ref={boardRegionRef}
          id={boardRegionId}
          role="region"
          aria-label="Tasks by date"
          tabIndex={0}
        >
          <div className="todos-board-columns">{model.columns.map(renderClassicColumn)}</div>
        </div>
      ) : (
        <div
          className="todos-board-scroll"
          ref={boardRegionRef}
          id={boardRegionId}
          role="region"
          aria-label="Tasks by date"
          tabIndex={0}
        >
          <div
            className="todos-board-week"
            key={model.visibleWeekMonday}
            style={{ "--todos-board-tracks": tracks.length } as CSSProperties}
          >
            {tracks.map((track) => (
              <div className="todos-board-track" key={track.map((column) => column.key).join("-")}>
                {track.map((column) => renderDateColumn(column, track.length > 1))}
              </div>
            ))}
          </div>

          {inboxColumn ? renderLedgerInbox(inboxColumn) : null}
        </div>
      )}

      <p className="todos-board-sr-only" aria-live="polite" aria-atomic="true">
        <span key={announcement.sequence}>
          {mutationError || undoNotice?.error ? "" : announcement.message}
        </span>
      </p>

      {undoNotice ? (
        <aside
          className="todos-board-undo"
          aria-label="Task deletion"
          aria-busy={undoNotice.pending || undefined}
        >
          <div>
            <p id={undoSummaryId} role="status" aria-live="polite">
              {undoNotice.pending
                ? `Restoring ${undoNotice.todoText}…`
                : `${undoNotice.todoText} deleted. Undo or dismiss before deleting another task.`}
            </p>
            {undoNotice.error ? <p role="alert">{undoNotice.error}</p> : null}
          </div>
          <button
            type="button"
            aria-disabled={undoNotice.pending || undefined}
            onClick={(event) => {
              if (undoNotice.pending) return;
              undoActionRef.current = {
                kind: "restore",
                todoId: undoNotice.todoId,
                focusOwner: focusedElementWithin(event.currentTarget),
              };
              onUndoDelete?.();
            }}
          >
            {undoNotice.pending ? "Restoring…" : "Undo"}
          </button>
          <button
            className="todos-board-undo__dismiss"
            type="button"
            aria-disabled={undoNotice.pending || undefined}
            onClick={(event) => {
              if (undoNotice.pending) return;
              undoActionRef.current = {
                kind: "dismiss",
                todoId: undoNotice.todoId,
                focusOwner: focusedElementWithin(event.currentTarget),
              };
              onDismissUndo?.();
            }}
            aria-label="Dismiss undo"
          >
            <CloseIcon />
          </button>
        </aside>
      ) : null}
    </section>
  );
}
