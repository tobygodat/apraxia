import type { Todo } from "../../types/domain";
import {
  asSqlDate,
  classifyTodoDueDate,
  compareSqlDates,
  startOfWeekMonday,
  type SqlDate,
  visibleTodoWeekDates,
} from "./dateDomain";

export type TodoBoardColumnKind = "inbox" | "overdue" | "date";

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
 * Build the complete Todos workspace without interpreting date-only values as
 * JavaScript instants. Open overdue tasks live in the dedicated Overdue column
 * and are intentionally not duplicated in a navigated historical date column.
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
  const overdue = todos.filter(
    (todo) =>
      !todo.completed &&
      todo.dueDate !== null &&
      classifyTodoDueDate(todo.dueDate, validToday) === "overdue",
  );

  const columns: TodoBoardColumn[] = [
    {
      key: "inbox",
      kind: "inbox",
      date: null,
      canAdd: true,
      todos: inbox,
    },
    {
      key: "overdue",
      kind: "overdue",
      date: null,
      canAdd: false,
      todos: [...overdue].sort((left, right) =>
        compareSqlDates(left.dueDate!, right.dueDate!),
      ),
    },
    ...dates.map<TodoBoardColumn>((date) => ({
      key: date,
      kind: "date",
      date,
      canAdd: true,
      todos: todos.filter((todo) => {
        if (todo.dueDate !== date) return false;

        // An incomplete past-due task belongs to Overdue. Completed historical
        // tasks remain visible when the user deliberately navigates that week.
        return todo.completed || compareSqlDates(date, validToday) >= 0;
      }),
    })),
  ];

  return {
    today: validToday,
    visibleWeekMonday: validMonday,
    isCurrentWeek,
    columns,
  };
}
