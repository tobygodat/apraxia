import { useCallback, useId, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { useColdLoad } from "../../apps/coldLoad";
import type { TodayTodo, UUID } from "../../types/domain";
import { isDocumentFocus } from "../../components/dialog/Dialog";
import { DragIcon, PlusIcon } from "../../components/icons";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { formatTaskDate, formatTaskTime } from "./taskFormatting";
import type { TodayDropPlacement } from "./todayListModel";
import type { MoveDirection } from "./todayOrder";
import { TodoSourceChip } from "./TodoSourceChip";
import type { TodayListDay, TodayListViewState } from "./todoViews";
import "./TodayList.css";
import "./todosPaper.css";

export interface TodayListProps {
  readonly heading?: string;
  readonly day?: TodayListDay;
  readonly onDayChange?: (day: TodayListDay) => void;
  readonly state: TodayListViewState;
  readonly onRetry: () => void;
  readonly onAddTodo: () => void;
  readonly onCompleteTodo: (todoId: UUID) => void;
  /** The edit surface restores focus itself (see Dialog). */
  readonly onEditTodo: (todo: TodayTodo) => void;
  readonly onDeleteTodo: (todo: TodayTodo) => void;
  readonly onUndoDelete: () => void;
  readonly onDismissUndo: () => void;
  readonly onMoveTodo: (todoId: UUID, direction: MoveDirection) => void;
  readonly onPlaceTodo: (todoId: UUID, targetTodoId: UUID, placement: TodayDropPlacement) => void;
}

interface DragTarget {
  readonly todoId: UUID;
  readonly placement: TodayDropPlacement;
}

interface MutationFocusRecovery {
  readonly kind: "complete" | "delete" | "restore" | "dismiss";
  readonly sourceTodoId: UUID;
  readonly sourceControlId: string;
  readonly targetTodoIds: readonly UUID[];
  ownedFocus: HTMLElement;
}

/**
 * A row due on the day being shown names that day and nothing more; the date is
 * already the list's own heading. A past-due row says so in a word and then
 * gives the day it was actually due.
 */
function dueDateLabel(todo: TodayTodo, day: TodayListDay): string {
  if (todo.isOverdue) return `was due ${formatTaskDate(todo.dueDate)}`;
  return `Due ${day.toLowerCase()}`;
}

export function TodayList({
  heading = "Today",
  day = "Today",
  onDayChange,
  state,
  onRetry,
  onAddTodo,
  onCompleteTodo,
  onEditTodo,
  onDeleteTodo,
  onUndoDelete,
  onDismissUndo,
  onMoveTodo,
  onPlaceTodo,
}: TodayListProps) {
  const idBase = useId();
  const draggedTodoIdRef = useRef<UUID | null>(null);
  const dragTargetRef = useRef<DragTarget | null>(null);
  const mutationFocusRef = useRef<MutationFocusRecovery | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const { model } = state;
  useColdLoad(state.loadStatus === "loading" && !state.loaded);
  const listLocked = state.loadStatus !== "ready" || state.pendingMutation !== null;
  const reorderLocked = listLocked || day === "Tomorrow";
  const scrollId = `${idBase}-scroll`;
  const addTodoId = `${idBase}-add`;
  const undoControlId = `${idBase}-undo`;
  const dismissUndoId = `${idBase}-dismiss-undo`;
  const undoSummaryId = `${idBase}-undo-summary`;
  const undoLocked = state.pendingMutation !== null || Boolean(state.undoNotice?.pending);
  const deleteLocked = listLocked || state.undoNotice !== null;
  const completeControlId = useCallback(
    (todoId: UUID) => `${idBase}-complete-${encodeURIComponent(todoId)}`,
    [idBase],
  );

  useLayoutEffect(() => {
    const trackNewFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || isDocumentFocus(target)) return;
      const mutation = mutationFocusRef.current;
      if (mutation && target !== mutation.ownedFocus) mutationFocusRef.current = null;
    };
    document.addEventListener("focusin", trackNewFocus);
    return () => {
      document.removeEventListener("focusin", trackNewFocus);
      mutationFocusRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const recovery = mutationFocusRef.current;
    if (!recovery) return;
    const activeElement = document.activeElement;
    if (activeElement !== recovery.ownedFocus && !isDocumentFocus(activeElement)) {
      mutationFocusRef.current = null;
      return;
    }

    function focusControl(controlIds: readonly string[]) {
      const target = controlIds
        .map((controlId) => document.getElementById(controlId))
        .find((element) => element !== null);
      if (!target) return;
      // Record our own move before focusin, so only a newer interaction cancels it.
      recovery!.ownedFocus = target;
      target.focus();
    }

    const sourceStillVisible = model.todos.some((todo) => todo.id === recovery.sourceTodoId);
    if (recovery.kind === "restore" || recovery.kind === "dismiss") {
      if (state.pendingMutation !== null || state.undoNotice?.pending) return;
      if (recovery.kind === "restore" && sourceStillVisible) {
        focusControl([completeControlId(recovery.sourceTodoId), addTodoId]);
      } else if (state.undoNotice === null) {
        focusControl([...model.todos.map((todo) => completeControlId(todo.id)), addTodoId]);
      } else if (!state.undoNotice.error && state.loadStatus !== "error") {
        return;
      }
      mutationFocusRef.current = null;
      return;
    }

    const mutationPending =
      state.pendingMutation?.kind === recovery.kind &&
      state.pendingMutation.todoId === recovery.sourceTodoId;
    if (sourceStillVisible) {
      if (!mutationPending && state.mutationError) focusControl([recovery.sourceControlId]);
      if (!mutationPending) mutationFocusRef.current = null;
      return;
    }

    if (mutationPending) {
      focusControl([scrollId]);
      return;
    }
    focusControl([...recovery.targetTodoIds.map(completeControlId), addTodoId]);
    mutationFocusRef.current = null;
  }, [
    addTodoId,
    completeControlId,
    model.todos,
    scrollId,
    state.loadStatus,
    state.mutationError,
    state.pendingMutation,
    state.undoNotice,
  ]);

  function prepareMutationFocus(
    kind: MutationFocusRecovery["kind"],
    todoId: UUID,
    sourceControlId: string,
    targetTodoIds: readonly UUID[] = [],
  ) {
    const source = document.getElementById(sourceControlId);
    const active = document.activeElement;
    mutationFocusRef.current =
      source &&
      active instanceof HTMLElement &&
      (active === source || Boolean(source.closest("article")?.contains(active)))
        ? { kind, sourceTodoId: todoId, sourceControlId, targetTodoIds, ownedFocus: active }
        : null;
  }

  function resetDrag() {
    draggedTodoIdRef.current = null;
    dragTargetRef.current = null;
    setDragTarget(null);
  }

  function handleDragOver(event: DragEvent<HTMLElement>, targetTodoId: UUID) {
    if (reorderLocked || draggedTodoIdRef.current === null) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement: TodayDropPlacement =
      event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
    const nextDragTarget = { todoId: targetTodoId, placement };
    dragTargetRef.current = nextDragTarget;
    setDragTarget(nextDragTarget);
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetTodoId: UUID) {
    event.preventDefault();
    const todoId = draggedTodoIdRef.current;
    const placement =
      dragTargetRef.current?.todoId === targetTodoId ? dragTargetRef.current.placement : "before";
    resetDrag();
    if (!reorderLocked && todoId && todoId !== targetTodoId) {
      onPlaceTodo(todoId, targetTodoId, placement);
    }
  }

  return (
    <section
      className="today-list"
      aria-labelledby={`${idBase}-heading`}
      aria-busy={state.loadStatus === "loading" || state.pendingMutation !== null || undefined}
    >
      <header className="today-list__header">
        <div>
          <h2 id={`${idBase}-heading`}>{heading}</h2>
          {day === "Tomorrow" ? (
            <p id={`${idBase}-summary`}>{model.todos.length} due tomorrow</p>
          ) : null}
        </div>
        <button
          className="today-list__add paper-button paper-button--primary"
          id={addTodoId}
          type="button"
          aria-disabled={state.pendingMutation !== null || undefined}
          onClick={() => {
            if (state.pendingMutation === null) onAddTodo();
          }}
        >
          <PlusIcon />
          Add task
        </button>
        {onDayChange && (
          <div className="today-list__day-switch" role="group" aria-label="Task day">
            {(["Today", "Tomorrow"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={day === option}
                disabled={state.pendingMutation !== null}
                onClick={() => onDayChange(option)}
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </header>

      {state.undoNotice ? (
        <a
          className="today-list__undo-shortcut"
          href={`#${undoControlId}`}
          onClick={(event) => {
            event.preventDefault();
            document.getElementById(undoControlId)?.focus();
          }}
        >
          Skip to Undo
        </a>
      ) : null}

      {state.loadStatus === "loading" && !state.loaded ? (
        <p className="cloud-shell__sr-only" role="status">
          Loading {day}…
        </p>
      ) : null}

      {state.loadStatus === "error" && state.loadError ? (
        <div className="today-list__error paper-error" role="alert">
          <p>{state.loadError}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}

      {state.mutationError ? (
        <p className="today-list__error today-list__error--mutation paper-error" role="alert">
          {state.mutationError}
        </p>
      ) : null}

      <div
        className="today-list__scroll"
        id={scrollId}
        role="region"
        aria-label={`${day} task list`}
        tabIndex={0}
        aria-describedby={day === "Tomorrow" ? `${idBase}-summary` : undefined}
      >
        {model.todos.length === 0 && state.pendingMutation !== null ? (
          <p className="today-list__pending-empty" role="status">
            Updating {day}…
          </p>
        ) : model.todos.length === 0 && state.loadStatus === "ready" ? (
          <div className="today-list__empty">
            <p>{day === "Tomorrow" ? "Nothing is due tomorrow." : "Nothing is due yet."}</p>
            <button type="button" onClick={onAddTodo}>
              Add a task
            </button>
          </div>
        ) : model.todos.length > 0 ? (
          <ol className="today-list__items" aria-label={`${day} tasks`}>
            {model.todos.map((todo, index) => {
              const titleId = `${idBase}-todo-${encodeURIComponent(todo.id)}`;
              const isPending = state.pendingMutation?.todoId === todo.id;
              const isDragTarget = dragTarget?.todoId === todo.id;
              const rowClassName = [
                "today-list-item",
                todo.isOverdue ? "today-list-item--overdue" : "",
                isDragTarget ? `today-list-item--drop-${dragTarget.placement}` : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <li
                  className={rowClassName}
                  key={todo.id}
                  draggable={!reorderLocked}
                  onDragStart={(event) => {
                    if (reorderLocked) {
                      event.preventDefault();
                      return;
                    }
                    draggedTodoIdRef.current = todo.id;
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = "move";
                      // Only this list's private ref carries the record identity.
                      event.dataTransfer.setData("text/plain", "apraxia-today-reorder");
                    }
                  }}
                  onDragOver={(event) => handleDragOver(event, todo.id)}
                  onDrop={(event) => handleDrop(event, todo.id)}
                  onDragEnd={resetDrag}
                >
                  <article aria-labelledby={titleId} aria-busy={isPending || undefined}>
                    {day === "Today" ? (
                      <span
                        className="today-list-item__drag"
                        role="button"
                        tabIndex={0}
                        aria-label={`Reorder ${todo.text}`}
                        aria-disabled={listLocked || undefined}
                        title="Drag to reorder, or use Up and Down arrow keys"
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                          event.preventDefault();
                          const direction = event.key === "ArrowUp" ? "up" : "down";
                          if (
                            !listLocked &&
                            (direction === "up" ? index > 0 : index < model.todos.length - 1)
                          )
                            onMoveTodo(todo.id, direction);
                        }}
                      >
                        <DragIcon />
                      </span>
                    ) : (
                      // Holds the handle's column open so both days' rows line
                      // up. Paper takes the handle out of flow and drops this.
                      <span className="today-list-item__drag-placeholder" aria-hidden="true" />
                    )}

                    <label className="today-list-item__check">
                      <input
                        className="paper-check"
                        id={completeControlId(todo.id)}
                        type="checkbox"
                        checked={false}
                        aria-disabled={listLocked || undefined}
                        onChange={() => {
                          if (!listLocked) {
                            prepareMutationFocus(
                              "complete",
                              todo.id,
                              completeControlId(todo.id),
                              [model.todos[index + 1]?.id, model.todos[index - 1]?.id].filter(
                                (todoId): todoId is UUID => Boolean(todoId),
                              ),
                            );
                            onCompleteTodo(todo.id);
                          }
                        }}
                      />
                      <span aria-hidden="true" />
                      <span className="today-list-sr-only">Mark {todo.text} complete</span>
                    </label>

                    <div className="today-list-item__content">
                      <p id={titleId}>{todo.text}</p>
                      <div className="today-list-item__meta">
                        {todo.isOverdue ? (
                          <span className="today-list-item__late">Overdue</span>
                        ) : null}
                        <time dateTime={todo.dueDate}>{dueDateLabel(todo, day)}</time>
                        {todo.dueTime ? (
                          <time dateTime={todo.dueTime}>{formatTaskTime(todo.dueTime)}</time>
                        ) : null}
                        <TodoSourceChip todo={todo} projectTitle={todo.projectTitle} />
                      </div>
                    </div>

                    <div className="today-list-item__actions">
                      <div className="today-list-item__manage">
                        <button
                          id={`${titleId}-edit`}
                          type="button"
                          aria-disabled={listLocked || undefined}
                          onClick={() => {
                            if (!listLocked) onEditTodo(todo);
                          }}
                          aria-label={`Edit ${todo.text}`}
                          title="Edit"
                        >
                          <WorkspaceIcon name="edit" />
                          <span className="today-list-action-label">Edit</span>
                        </button>
                        <button
                          id={`${titleId}-delete`}
                          type="button"
                          aria-disabled={deleteLocked || undefined}
                          aria-describedby={state.undoNotice ? undoSummaryId : undefined}
                          onClick={() => {
                            if (!deleteLocked) {
                              prepareMutationFocus(
                                "delete",
                                todo.id,
                                `${titleId}-delete`,
                                [model.todos[index + 1]?.id, model.todos[index - 1]?.id].filter(
                                  (todoId): todoId is UUID => Boolean(todoId),
                                ),
                              );
                              onDeleteTodo(todo);
                            }
                          }}
                          aria-label={`Delete ${todo.text}`}
                          title="Delete"
                        >
                          <WorkspaceIcon name="trash" />
                          <span className="today-list-action-label">Delete</span>
                        </button>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      {state.undoNotice ? (
        <footer className="today-list__undo" role="group" aria-label="Undo deletion">
          <div className="today-list__undo-copy">
            <p id={undoSummaryId}>
              {state.undoNotice.pending
                ? `Restoring ${state.undoNotice.todoText}…`
                : `${state.undoNotice.todoText} deleted. Undo or dismiss before deleting another task.`}
            </p>
            {state.undoNotice.error ? <p role="alert">{state.undoNotice.error}</p> : null}
          </div>
          <div className="today-list__undo-actions">
            <button
              id={undoControlId}
              type="button"
              aria-disabled={undoLocked || undefined}
              aria-describedby={undoSummaryId}
              onClick={() => {
                if (undoLocked) return;
                prepareMutationFocus("restore", state.undoNotice!.todoId, undoControlId);
                onUndoDelete();
              }}
            >
              {state.undoNotice.pending ? "Restoring…" : "Undo"}
            </button>
            <button
              id={dismissUndoId}
              type="button"
              aria-label="Dismiss undo"
              aria-disabled={undoLocked || undefined}
              onClick={() => {
                if (undoLocked) return;
                prepareMutationFocus("dismiss", state.undoNotice!.todoId, dismissUndoId);
                onDismissUndo();
              }}
            >
              Dismiss
            </button>
          </div>
        </footer>
      ) : null}

      {/* The panel shows one day; the way out of it belongs at its foot. */}
      <Link className="today-list__all" to="/todos">
        All tasks this week
      </Link>

      <p className="today-list-sr-only" aria-live="polite" aria-atomic="true">
        <span key={state.announcement.sequence}>
          {state.mutationError || state.undoNotice?.error ? "" : state.announcement.message}
        </span>
      </p>
    </section>
  );
}
