import type { LocalDate, TodayTodo, UUID } from "../../types/domain";
import { asSqlDate, compareSqlDates, type SqlDate } from "./dateDomain";
import { assignTodayRanks, sortTodayTodos, type MoveDirection } from "./todayOrder";
import type { TodayRankUpdate } from "./todoService";

export interface TodayListModel {
  readonly localDate: SqlDate;
  readonly todos: readonly TodayTodo[];
  readonly overdueCount: number;
  readonly dueTodayCount: number;
  readonly hasManualOrder: boolean;
}

export type TodayDropPlacement = "before" | "after";

function assertTodayTodo(todo: TodayTodo, localDate: SqlDate): void {
  if (!todo.id) {
    throw new RangeError("Today rows require an ID.");
  }
  if (todo.completed !== false || todo.completedAt !== null) {
    throw new RangeError("Today can contain only incomplete todos.");
  }

  const dueDate = asSqlDate(todo.dueDate);
  const dueDateComparison = compareSqlDates(dueDate, localDate);
  if (dueDateComparison > 0) {
    throw new RangeError("Today cannot contain a future todo.");
  }
  if (todo.isOverdue !== dueDateComparison < 0) {
    throw new RangeError("Today due-date status must match the local date.");
  }
  if (todo.isManuallyOrdered !== (todo.todayRank !== null)) {
    throw new RangeError("Today manual-order status must match its saved rank.");
  }
}

/**
 * Build the reusable Today panel model from the browser-safe RPC contract.
 * Ranked rows keep their persisted order. Newly eligible, unranked rows follow
 * them in the same deterministic overdue-first order as Postgres.
 */
export function buildTodayListModel(
  todos: readonly TodayTodo[],
  localDate: LocalDate,
): TodayListModel {
  const validLocalDate = asSqlDate(localDate);
  const todoIds = new Set<UUID>();

  for (const todo of todos) {
    assertTodayTodo(todo, validLocalDate);
    if (todoIds.has(todo.id)) {
      throw new RangeError("Today rows must have unique IDs.");
    }
    todoIds.add(todo.id);
  }

  const orderedTodos = sortTodayTodos(todos);
  const overdueCount = orderedTodos.filter((todo) => todo.isOverdue).length;

  return {
    localDate: validLocalDate,
    todos: orderedTodos,
    overdueCount,
    dueTodayCount: orderedTodos.length - overdueCount,
    hasManualOrder: orderedTodos.some((todo) => todo.isManuallyOrdered),
  };
}

export function moveTodayListTodo(
  todos: readonly TodayTodo[],
  todoId: UUID,
  direction: MoveDirection,
): readonly TodayTodo[] {
  const sourceIndex = todos.findIndex((todo) => todo.id === todoId);
  if (sourceIndex < 0) {
    throw new RangeError("The todo is no longer in Today.");
  }

  const targetIndex = direction === "up" ? sourceIndex - 1 : sourceIndex + 1;
  if (targetIndex < 0 || targetIndex >= todos.length) return todos;

  const next = [...todos];
  [next[sourceIndex], next[targetIndex]] = [next[targetIndex]!, next[sourceIndex]!];
  return next;
}

/** Move a dragged row relative to another row without dropping any list item. */
export function placeTodayListTodo(
  todos: readonly TodayTodo[],
  todoId: UUID,
  targetTodoId: UUID,
  placement: TodayDropPlacement,
): readonly TodayTodo[] {
  if (todoId === targetTodoId) return todos;

  const sourceIndex = todos.findIndex((todo) => todo.id === todoId);
  const targetIndex = todos.findIndex((todo) => todo.id === targetTodoId);
  if (sourceIndex < 0 || targetIndex < 0) {
    throw new RangeError("The todo is no longer in Today.");
  }

  const next = [...todos];
  const [source] = next.splice(sourceIndex, 1);
  const remainingTargetIndex = next.findIndex((todo) => todo.id === targetTodoId);
  const insertionIndex = placement === "after" ? remainingTargetIndex + 1 : remainingTargetIndex;
  next.splice(insertionIndex, 0, source!);
  return next;
}

/** Apply the same optimistic rank spacing as the atomic reorder RPC. */
export function applyOptimisticTodayRanks(todos: readonly TodayTodo[]): readonly TodayTodo[] {
  const ranks = assignTodayRanks(todos.map((todo) => todo.id));
  return todos.map((todo) => ({
    ...todo,
    todayRank: ranks.get(todo.id)!,
    isManuallyOrdered: true,
  }));
}

/**
 * Reconcile a successful RPC response and reject partial, duplicated, or
 * differently ordered results so the UI cannot claim an unsaved order.
 */
export function applyPersistedTodayRanks(
  todos: readonly TodayTodo[],
  updates: readonly TodayRankUpdate[],
): readonly TodayTodo[] {
  if (updates.length !== todos.length) {
    throw new RangeError("The saved Today order was incomplete.");
  }

  const rankByTodoId = new Map<UUID, number>();
  const savedRanks = new Set<number>();
  const todoIds = new Set(todos.map((todo) => todo.id));
  for (const update of updates) {
    if (
      !todoIds.has(update.todoId) ||
      rankByTodoId.has(update.todoId) ||
      savedRanks.has(update.todayRank) ||
      !Number.isSafeInteger(update.todayRank) ||
      update.todayRank <= 0
    ) {
      throw new RangeError("The saved Today order was invalid.");
    }
    rankByTodoId.set(update.todoId, update.todayRank);
    savedRanks.add(update.todayRank);
  }

  const persistedOrder = [...updates]
    .sort((left, right) => left.todayRank - right.todayRank)
    .map((update) => update.todoId);
  if (persistedOrder.some((todoId, index) => todoId !== todos[index]?.id)) {
    throw new RangeError("The saved Today order did not match the requested order.");
  }

  return todos.map((todo) => ({
    ...todo,
    todayRank: rankByTodoId.get(todo.id)!,
    isManuallyOrdered: true,
  }));
}
