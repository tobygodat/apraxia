import type { Todo } from "../../types/domain";
import {
  asSqlDate,
  compareSqlDates,
  startOfWeekSunday,
  type SqlDate,
  visibleTodoWeekDates,
} from "./dateDomain";
import { compareTodayTodos, type TodayOrderableTodo } from "./todayOrder";

type TodoBoardColumnKind = "inbox" | "date" | "overdue";

export interface TodoBoardColumn {
  readonly key: string;
  readonly kind: TodoBoardColumnKind;
  readonly date: SqlDate | null;
  readonly canAdd: boolean;
  readonly todos: readonly Todo[];
}

export interface TodoBoardModel {
  readonly today: SqlDate;
  readonly visibleWeekStart: SqlDate;
  readonly isCurrentWeek: boolean;
  readonly columns: readonly TodoBoardColumn[];
  /**
   * Open tasks dated before today. The pile exists whichever week is on
   * screen, so it is counted from every task rather than from the columns.
   */
  readonly overdue: readonly Todo[];
}

function assertUniqueTodoIds(todos: readonly Todo[]): void {
  const todoIds = new Set<string>();

  for (const todo of todos) {
    if (!todo.id) {
      throw new RangeError("Todo board rows require an ID.");
    }
    if (todoIds.has(todo.id)) {
      throw new RangeError("Todo board rows must have unique IDs.");
    }
    todoIds.add(todo.id);

    if (todo.dueDate !== null) asSqlDate(todo.dueDate);
  }
}

/**
 * Date columns follow the Today order: manual rank first, then due date, due
 * time with unset times last, creation, and finally ID. Sorting by date alone
 * left same-day tasks in the service's ID order.
 */
function compareDatedColumnTodos(left: Todo, right: Todo): number {
  return compareTodayTodos(left as TodayOrderableTodo, right as TodayOrderableTodo);
}

/**
 * Build the complete Todos workspace without interpreting date-only values as
 * JavaScript instants. Open past-due tasks join Today without changing their
 * dates. Completed historical tasks remain in their original date columns.
 */
export function buildTodoBoardModel(
  todos: readonly Todo[],
  visibleWeekStart: string,
  today: string,
): TodoBoardModel {
  assertUniqueTodoIds(todos);

  const validToday = asSqlDate(today);
  // The week reads Sunday to Saturday, the way a calendar does. Today is marked
  // in place with a rule under its heading rather than moved to the front.
  const dates = visibleTodoWeekDates(visibleWeekStart, validToday);
  const validWeekStart = asSqlDate(visibleWeekStart);
  const isCurrentWeek = validWeekStart === startOfWeekSunday(validToday);

  const inbox = todos.filter((todo) => todo.dueDate === null);
  // Open past-due tasks, oldest first, whichever week is on screen: the pile is
  // counted from every task rather than from the columns.
  const overdue = todos
    .filter(
      (todo) =>
        !todo.completed && todo.dueDate !== null && compareSqlDates(todo.dueDate, validToday) < 0,
    )
    .sort(compareDatedColumnTodos);

  // Overdue and Inbox are columns like any other so that filtering, dragging
  // and focus recovery treat their rows the same way. The board renders the
  // seven dated ones as the week grid and these two as the full-width lists
  // beneath it.
  const columns: TodoBoardColumn[] = [
    ...dates.map<TodoBoardColumn>((date) => ({
      key: date,
      kind: "date",
      date,
      canAdd: true,
      todos: todos
        .filter((todo) => {
          if (todo.dueDate === null) return false;
          // A day column holds the tasks actually due that day. Open past-due
          // ones are gathered under Overdue instead of being folded into Today,
          // where their own dates stopped meaning anything.
          return (
            todo.dueDate === date && (todo.completed || compareSqlDates(date, validToday) >= 0)
          );
        })
        .sort(compareDatedColumnTodos),
    })),
    {
      key: "overdue",
      kind: "overdue",
      date: null,
      canAdd: false,
      todos: overdue,
    },
    {
      key: "inbox",
      kind: "inbox",
      date: null,
      canAdd: true,
      todos: inbox,
    },
  ];

  return {
    today: validToday,
    visibleWeekStart: validWeekStart,
    isCurrentWeek,
    columns,
    overdue,
  };
}
