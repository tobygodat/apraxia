import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ProjectSummary, Todo } from "../../types/domain";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { addSqlDateDays, parseSqlDate } from "./dateDomain";
import type { TodoBoardColumn, TodoBoardModel } from "./todoBoardModel";
import {
  todoLoadErrorCopy,
  todoMutationErrorCopy,
  type TodoLoadState,
  type TodoMutationErrorKind,
} from "./todoUiState";
import "./TodosBoard.css";

export type TodosBoardLoadState = TodoLoadState;

export interface TodoUndoNotice {
  readonly todoId: string;
  readonly todoText: string;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}

export interface TodoMutationResult {
  /** Monotonically increasing for each settled mutation in the parent. */
  readonly sequence: number;
  readonly todoId: string;
  readonly action: "complete" | "delete";
  readonly status: "succeeded" | "failed" | "cancelled";
}

export interface TodosBoardProps {
  readonly model: TodoBoardModel;
  readonly loadState?: TodosBoardLoadState;
  readonly pendingTodoIds?: ReadonlySet<string>;
  readonly projects?: readonly ProjectSummary[];
  readonly mutationResult?: TodoMutationResult | null;
  readonly mutationError?: TodoMutationErrorKind | null;
  readonly undoNotice?: TodoUndoNotice | null;
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
}

interface FocusOwnership {
  /** Cleared as soon as the user focuses a newer interaction. */
  focusOwner: HTMLElement | null;
}

function ArrowIcon({ direction }: { readonly direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path
        d={direction === "left" ? "m12.5 5-5 5 5 5" : "m7.5 5 5 5-5 5"}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path
        d="M10 4v12M4 10h12"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path
        d="m5 5 10 10M15 5 5 15"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

const dateHeadingFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  weekday: "long",
  timeZone: "UTC",
});

const weekRangeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function dateAtUtcNoon(value: string): Date {
  const { year, month, day } = parseSqlDate(value);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function formatDateHeading(value: string, today: string): string {
  const formatted = dateHeadingFormatter.format(dateAtUtcNoon(value));
  if (value === today) return `${formatted} · Today`;
  if (value === addSqlDateDays(today, 1)) return `${formatted} · Tomorrow`;
  return formatted;
}

function columnLabel(column: TodoBoardColumn, today: string): string {
  if (column.kind === "inbox") return "Inbox";
  if (column.kind === "overdue") return "Overdue";
  return formatDateHeading(column.date!, today);
}

function weekRangeLabel(monday: string): string {
  const sunday = addSqlDateDays(monday, 6);
  return `${weekRangeFormatter.format(dateAtUtcNoon(monday))} – ${weekRangeFormatter.format(dateAtUtcNoon(sunday))}`;
}

function dueTimeLabel(value: string): string {
  const [hour = "00", minute = "00"] = value.split(":");
  const numericHour = Number(hour);
  const suffix = numericHour >= 12 ? "PM" : "AM";
  const displayHour = numericHour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

function TodoCard({
  todo,
  pending,
  titleId,
  primaryControlId,
  projectTitle,
  showDueDate,
  onToggleComplete,
  onEditTodo,
  onDeleteTodo,
}: {
  readonly todo: Todo;
  readonly pending: boolean;
  readonly titleId: string;
  readonly primaryControlId: string;
  readonly projectTitle: string | null;
  readonly showDueDate: boolean;
  readonly onToggleComplete: (todo: Todo) => void;
  readonly onEditTodo: (todo: Todo) => void;
  readonly onDeleteTodo: (todo: Todo) => void;
}) {
  return (
    <article
      className={`todos-board-card${todo.completed ? " todos-board-card--completed" : ""}`}
      aria-labelledby={titleId}
      aria-busy={pending || undefined}
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
        {showDueDate || todo.dueTime || projectTitle ? (
          <div className="todos-board-card__metadata">
            {showDueDate && todo.dueDate ? (
              <time dateTime={todo.dueDate}>
                Due {weekRangeFormatter.format(dateAtUtcNoon(todo.dueDate))}
              </time>
            ) : null}
            {todo.dueTime ? (
              <time dateTime={todo.dueTime}>{dueTimeLabel(todo.dueTime)}</time>
            ) : null}
            {projectTitle ? <span>{projectTitle}</span> : null}
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
          onClick={() => onDeleteTodo(todo)}
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
  model,
  loadState = { status: "idle" },
  pendingTodoIds = new Set<string>(),
  projects = [],
  mutationResult = null,
  mutationError = null,
  undoNotice = null,
  onPreviousWeek,
  onNextWeek,
  onToday,
  onRetry,
  onAddTodo,
  onToggleComplete,
  onEditTodo,
  onDeleteTodo,
}: TodosBoardProps) {
  const idBase = useId();
  const focusRecoveryRef = useRef<{
    readonly sourceTodoId: string;
    readonly action: "complete" | "delete";
    readonly sourceControlId: string;
    readonly targetIds: readonly string[];
    readonly announcement: string;
    readonly resultSequenceAtStart: number;
    sawPending: boolean;
    fallbackFocused: boolean;
    awaitingRollback: boolean;
  } & FocusOwnership | null>(null);
  const [mutationAnnouncement, setMutationAnnouncement] = useState({
    sequence: 0,
    message: "",
  });
  const undoActionRef = useRef<{
    readonly kind: "restore" | "dismiss";
    readonly todoId: string;
    readonly todoText: string;
  } & FocusOwnership | null>(null);
  const boardRegionId = `${idBase}-task-region`;
  const projectTitles = new Map(
    projects.map((project) => [project.id, project.title] as const),
  );

  const todoControlId = (todoId: string) =>
    `${idBase}-todo-${encodeURIComponent(todoId)}`;
  const columnHeadingId = (columnKey: string) =>
    `${idBase}-column-${encodeURIComponent(columnKey)}`;
  const columnAddId = (columnKey: string) =>
    `${idBase}-add-${encodeURIComponent(columnKey)}`;

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
    const adjacentTodo = [
      column.todos[todoIndex + 1],
      column.todos[todoIndex - 1],
    ].find(
      (candidate) =>
        candidate !== undefined && !pendingTodoIds.has(candidate.id),
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
      announcement:
        action === "delete"
          ? `${todo.text} deleted. Undo is available.`
          : `${todo.text} completed.`,
      resultSequenceAtStart: mutationResult?.sequence ?? -1,
      sawPending: false,
      fallbackFocused: false,
      awaitingRollback: false,
      focusOwner: focusedElementWithin(
        document.getElementById(todoControlId(todo.id))?.closest("article") ?? null,
      ),
    };
  }

  function focusFirstAvailable(
    ownership: FocusOwnership,
    targetIds: readonly string[],
  ) {
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
      (mutationResult.status === "failed" ||
        mutationResult.status === "cancelled")
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
      !sourceExists ||
      (recovery.action === "complete" && sourceTodo?.completed === true);

    if (
      hasNewMatchingSettlement &&
      mutationResult.status === "succeeded" &&
      successfulModelState
    ) {
      if (!sourceExists && !recovery.fallbackFocused) {
        focusFirstAvailable(recovery, recovery.targetIds);
      }
      setMutationAnnouncement((current) => ({
        sequence: current.sequence + 1,
        message: recovery.announcement,
      }));
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
    setMutationAnnouncement((current) => ({
      sequence: current.sequence + 1,
      message:
        undoAction.kind === "restore"
          ? `${undoAction.todoText} restored.`
          : "Undo dismissed.",
    }));
    undoActionRef.current = null;
  }, [model, undoNotice]);

  const navigationPending = loadState.status === "loading";

  return (
    <section className="todos-board-page" aria-labelledby="todos-board-heading">
      <header className="todos-board-toolbar">
        <div>
          <h1 id="todos-board-heading">Tasks</h1>
          <p className="todos-board-week" aria-live="polite">
            {weekRangeLabel(model.visibleWeekMonday)}
          </p>
        </div>

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
      </header>

      {loadState.status === "error" ? (
        <div className="todos-board-error" role="alert">
          <p>{todoLoadErrorCopy(loadState.kind)}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}

      {loadState.status === "loading" ? (
        <p className="todos-board-status" role="status">
          Loading tasks…
        </p>
      ) : null}

      {mutationError ? (
        <p className="todos-board-error todos-board-error--mutation" role="alert">
          {todoMutationErrorCopy(mutationError)}
        </p>
      ) : null}

      <div
        className="todos-board-scroll"
        id={boardRegionId}
        role="region"
        aria-label="Tasks by date"
        tabIndex={0}
      >
        <div className="todos-board-columns">
          {model.columns.map((column) => {
            const label = columnLabel(column, model.today);
            const headingId = columnHeadingId(column.key);

            return (
              <section
                className={`todos-board-column todos-board-column--${column.kind}`}
                key={column.key}
                aria-labelledby={headingId}
              >
                <header className="todos-board-column__header">
                  <h2 id={headingId} tabIndex={-1}>
                    {label}
                  </h2>
                  <span aria-hidden="true">
                    {column.todos.length}
                  </span>
                  <span className="todos-board-sr-only">
                    {column.todos.length} {column.todos.length === 1 ? "task" : "tasks"}
                  </span>
                </header>

                <div className="todos-board-column__tasks">
                  {column.todos.map((todo, todoIndex) => (
                    <TodoCard
                      key={todo.id}
                      todo={todo}
                      pending={pendingTodoIds.has(todo.id)}
                      primaryControlId={todoControlId(todo.id)}
                      projectTitle={
                        todo.projectId
                          ? (projectTitles.get(todo.projectId) ?? null)
                          : null
                      }
                      showDueDate={column.kind === "overdue"}
                      titleId={`${todoControlId(todo.id)}-title`}
                      onToggleComplete={(selectedTodo) => {
                        const started = onToggleComplete(selectedTodo);
                        if (started && !selectedTodo.completed) {
                          prepareFocusRecovery(
                            column,
                            todoIndex,
                            selectedTodo,
                            "complete",
                          );
                        }
                      }}
                      onEditTodo={onEditTodo}
                      onDeleteTodo={(selectedTodo) => {
                        if (onDeleteTodo(selectedTodo)) {
                          prepareFocusRecovery(
                            column,
                            todoIndex,
                            selectedTodo,
                            "delete",
                          );
                        }
                      }}
                    />
                  ))}

                  {column.canAdd ? (
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
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <p className="todos-board-sr-only" aria-live="polite" aria-atomic="true">
        <span key={mutationAnnouncement.sequence}>
          {mutationAnnouncement.message}
        </span>
      </p>

      {undoNotice ? (
        <aside
          className="todos-board-undo"
          aria-label="Task deletion"
          aria-busy={undoNotice.pending || undefined}
        >
          <div>
            <p role="status" aria-live="polite">
              {undoNotice.pending
                ? `Restoring ${undoNotice.todoText}…`
                : `${undoNotice.todoText} deleted. Undo is available.`}
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
                todoText: undoNotice.todoText,
                focusOwner: focusedElementWithin(event.currentTarget),
              };
              undoNotice.onUndo();
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
                todoText: undoNotice.todoText,
                focusOwner: focusedElementWithin(event.currentTarget),
              };
              undoNotice.onDismiss();
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
