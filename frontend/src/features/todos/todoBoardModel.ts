import type { Todo } from "../../types/domain";
import {
  asSqlDate,
  compareSqlDates,
  startOfWeekMonday,
  type SqlDate,
  visibleTodoWeekDates,
} from "./dateDomain";
import { compareTodayTodos, type TodayOrderableTodo } from "./todayOrder";

type TodoBoardColumnKind = "inbox" | "date";

export interface TodoBoardColumn {
  readonly key: string;
  readonly kind: TodoBoardColumnKind;
  readonly date: SqlDate | null;
  readonly canAdd: boolean;
  readonly todos: readonly Todo[];
}

export interface TodoBoardModel {
  readonly today: SqlDate;
  readonly visibleWeekMonday: SqlDate;
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
  visibleWeekMonday: string,
  today: string,
): TodoBoardModel {
  assertUniqueTodoIds(todos);

  const validToday = asSqlDate(today);
  const dates = visibleTodoWeekDates(visibleWeekMonday, validToday);
  const validMonday = asSqlDate(visibleWeekMonday);
  const isCurrentWeek = validMonday === startOfWeekMonday(validToday);

  const inbox = todos.filter((todo) => todo.dueDate === null);

  const columns: TodoBoardColumn[] = [
    {
      key: "inbox",
      kind: "inbox",
      date: null,
      canAdd: true,
      todos: inbox,
    },
    ...dates.map<TodoBoardColumn>((date) => ({
      key: date,
      kind: "date",
      date,
      canAdd: true,
      todos: todos
        .filter((todo) => {
          if (todo.dueDate === null) return false;
          if (isCurrentWeek && date === validToday && !todo.completed) {
            return compareSqlDates(todo.dueDate, validToday) <= 0;
          }
          // Incomplete historical tasks appear only under Today. Completed ones
          // remain visible when the user deliberately navigates that week.
          return (
            todo.dueDate === date && (todo.completed || compareSqlDates(date, validToday) >= 0)
          );
        })
        .sort(compareDatedColumnTodos),
    })),
  ];

  return {
    today: validToday,
    visibleWeekMonday: validMonday,
    isCurrentWeek,
    columns,
    overdue: todos.filter(
      (todo) =>
        !todo.completed && todo.dueDate !== null && compareSqlDates(todo.dueDate, validToday) < 0,
    ),
  };
}
