import { describe, expect, it } from "vitest";
import type { Todo } from "../../types/domain";
import { buildTodoBoardModel, type TodoBoardModel } from "./todoBoardModel";

const BASE_TODO: Todo = {
  id: "00000000-0000-4000-8000-000000000001",
  text: "Base task",
  completed: false,
  completedAt: null,
  dueDate: null,
  dueTime: null,
  projectId: null,
  todayRank: null,
  createdAt: "2026-09-01T12:00:00.000000Z",
  updatedAt: "2026-09-01T12:00:00.000000Z",
};

function todo(overrides: Partial<Todo> & Pick<Todo, "id" | "text">): Todo {
  return { ...BASE_TODO, ...overrides };
}

function columnTodoIds(model: TodoBoardModel, key: string): string[] {
  const column = model.columns.find((candidate) => candidate.key === key);
  if (!column) throw new Error(`No board column for ${key}.`);
  return column.todos.map(({ id }) => id);
}

describe("buildTodoBoardModel", () => {
  it("runs Sunday to Saturday, then the overdue pile, then Inbox", () => {
    const model = buildTodoBoardModel(
      [
        todo({ id: "inbox", text: "Inbox" }),
        todo({ id: "oldest", text: "Oldest", dueDate: "2026-08-25" }),
        todo({ id: "older", text: "Older", dueDate: "2026-09-01" }),
        todo({ id: "today", text: "Today", dueDate: "2026-09-02" }),
        todo({ id: "saturday", text: "Saturday", dueDate: "2026-09-05" }),
      ],
      "2026-08-30",
      "2026-09-02",
    );

    expect(model.isCurrentWeek).toBe(true);
    // The week reads in calendar order. Today is marked in place rather than
    // moved to the front, and the two piles trail every day column.
    expect(model.columns.map((column) => column.key)).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "overdue",
      "inbox",
    ]);
    expect(columnTodoIds(model, "inbox")).toEqual(["inbox"]);
    // Today holds what is due today and nothing else, and an open past-due row
    // appears once: under Overdue, oldest first, not also in its own column.
    expect(columnTodoIds(model, "2026-09-02")).toEqual(["today"]);
    expect(columnTodoIds(model, "2026-09-01")).toEqual([]);
    expect(columnTodoIds(model, "2026-09-05")).toEqual(["saturday"]);
    expect(columnTodoIds(model, "overdue")).toEqual(["oldest", "older"]);
    expect(model.overdue.map(({ id }) => id)).toEqual(["oldest", "older"]);
  });

  it("orders a column by due time, then creation, not by row ID", () => {
    const model = buildTodoBoardModel(
      [
        todo({
          id: "ffffffff-0000-4000-8000-000000000001",
          text: "Evening",
          dueDate: "2026-09-04",
          dueTime: "17:00",
        }),
        todo({
          id: "00000000-0000-4000-8000-0000000000aa",
          text: "Morning",
          dueDate: "2026-09-04",
          dueTime: "09:00",
        }),
        todo({
          id: "11111111-0000-4000-8000-0000000000bb",
          text: "Untimed",
          dueDate: "2026-09-04",
          createdAt: "2026-09-01T08:00:00.000000Z",
        }),
      ],
      "2026-08-30",
      "2026-09-02",
    );

    // Unset due times sort last, so the untimed row follows both timed ones
    // even though it was created first.
    expect(columnTodoIds(model, "2026-09-04")).toEqual([
      "00000000-0000-4000-8000-0000000000aa",
      "ffffffff-0000-4000-8000-000000000001",
      "11111111-0000-4000-8000-0000000000bb",
    ]);
  });

  it("keeps a manual Today rank ahead of unranked rows in the Today column", () => {
    const model = buildTodoBoardModel(
      [
        todo({
          id: "00000000-0000-4000-8000-000000000011",
          text: "Unranked but earlier",
          dueDate: "2026-09-02",
          dueTime: "08:00",
        }),
        todo({
          id: "00000000-0000-4000-8000-000000000022",
          text: "Ranked",
          dueDate: "2026-09-02",
          dueTime: "20:00",
          todayRank: 1024,
        }),
      ],
      "2026-08-30",
      "2026-09-02",
    );

    expect(columnTodoIds(model, "2026-09-02")).toEqual([
      "00000000-0000-4000-8000-000000000022",
      "00000000-0000-4000-8000-000000000011",
    ]);
  });

  it("keeps the same calendar order whichever weekday today falls on", () => {
    const week = [
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ];
    for (const today of ["2026-08-30", "2026-09-02", "2026-09-05"]) {
      const model = buildTodoBoardModel([], "2026-08-30", today);
      expect(model.columns.slice(0, 7).map((column) => column.key)).toEqual(week);
      expect(model.isCurrentWeek).toBe(true);
    }
  });

  it("shows all seven dates of a navigated week", () => {
    const model = buildTodoBoardModel([], "2026-09-06", "2026-09-02");

    expect(model.isCurrentWeek).toBe(false);
    expect(model.columns.slice(0, 7).map((column) => column.key)).toEqual([
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ]);
  });

  it("leaves an open past-due task out of its own historical column", () => {
    const open = todo({ id: "open", text: "Open", dueDate: "2026-08-25" });
    const completed = todo({
      id: "completed",
      text: "Completed",
      completed: true,
      completedAt: "2026-08-25T16:00:00.000000Z",
      dueDate: "2026-08-25",
    });

    // The week that actually contains 25 August: the completed row keeps its
    // column, the open one does not, because it is in the overdue pile.
    const historical = buildTodoBoardModel([open, completed], "2026-08-23", "2026-09-02");
    expect(columnTodoIds(historical, "2026-08-25")).toEqual(["completed"]);
    expect(columnTodoIds(historical, "overdue")).toEqual(["open"]);

    // And it is not folded into Today either, whichever week is on screen.
    const current = buildTodoBoardModel([open, completed], "2026-08-30", "2026-09-02");
    expect(columnTodoIds(current, "2026-09-02")).toEqual([]);
    expect(columnTodoIds(current, "overdue")).toEqual(["open"]);
  });

  it("keeps completed dates separate across a week rollover", () => {
    const source = [
      todo({
        id: "open",
        text: "Open",
        dueDate: "2026-09-05",
        createdAt: "2026-09-01T08:00:00.000000Z",
      }),
      todo({
        id: "done",
        text: "Done",
        dueDate: "2026-09-05",
        completed: true,
        completedAt: "2026-09-05T12:00:00Z",
        createdAt: "2026-09-01T09:00:00.000000Z",
      }),
      todo({ id: "future", text: "Future", dueDate: "2026-09-08" }),
    ];
    const saturday = buildTodoBoardModel(source, "2026-08-30", "2026-09-05");
    expect(columnTodoIds(saturday, "2026-09-05")).toEqual(["open", "done"]);

    // A week later the open row has fallen past today, so only the completed
    // one is left in the historical column and the open one is overdue.
    const nextWeek = buildTodoBoardModel(source, "2026-09-06", "2026-09-06");
    expect(columnTodoIds(nextWeek, "2026-09-08")).toEqual(["future"]);
    expect(columnTodoIds(nextWeek, "overdue")).toEqual(["open"]);
    const history = buildTodoBoardModel(source, "2026-08-30", "2026-09-06");
    expect(columnTodoIds(history, "2026-09-05")).toEqual(["done"]);
  });

  it("preserves date-only values and does not mutate the source list", () => {
    const source = Object.freeze([
      Object.freeze(todo({ id: "b", text: "B", dueDate: "2026-09-01" })),
      Object.freeze(todo({ id: "a", text: "A", dueDate: "2026-08-31" })),
    ]);

    const model = buildTodoBoardModel(source, "2026-08-30", "2026-09-02");

    // Both are open and past due, so both sit in the pile rather than in the
    // day columns they name.
    expect(columnTodoIds(model, "2026-08-31")).toEqual([]);
    expect(columnTodoIds(model, "2026-09-01")).toEqual([]);
    expect(
      model.columns.find((column) => column.key === "overdue")?.todos.map(({ dueDate }) => dueDate),
    ).toEqual(["2026-08-31", "2026-09-01"]);
    expect(source.map(({ id }) => id)).toEqual(["b", "a"]);
  });

  it("counts open past-due tasks as overdue whichever week is selected", () => {
    const todos = [
      todo({ id: "inbox", text: "Inbox" }),
      todo({ id: "oldest", text: "Oldest", dueDate: "2026-08-25" }),
      todo({ id: "yesterday", text: "Yesterday", dueDate: "2026-09-01" }),
      todo({ id: "done", text: "Done", dueDate: "2026-08-25", completed: true }),
      todo({ id: "today", text: "Today", dueDate: "2026-09-02" }),
      todo({ id: "later", text: "Later", dueDate: "2026-09-05" }),
    ];

    for (const weekStart of ["2026-08-30", "2026-09-06"]) {
      const model = buildTodoBoardModel(todos, weekStart, "2026-09-02");
      expect(model.overdue.map(({ id }) => id)).toEqual(["oldest", "yesterday"]);
    }
  });

  it("rejects invalid selected weeks and duplicate rows", () => {
    expect(() => buildTodoBoardModel([], "2026-08-31", "2026-09-02")).toThrow("Sunday");

    const duplicate = todo({ id: "same", text: "Duplicate" });
    expect(() =>
      buildTodoBoardModel([duplicate, { ...duplicate }], "2026-08-30", "2026-09-02"),
    ).toThrow("unique IDs");
  });
});
