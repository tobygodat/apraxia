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
  it("opens the current week on Today, wraps to its earlier days, and ends with Inbox", () => {
    const model = buildTodoBoardModel(
      [
        todo({ id: "inbox", text: "Inbox" }),
        todo({ id: "oldest", text: "Oldest", dueDate: "2026-08-30" }),
        todo({ id: "older", text: "Older", dueDate: "2026-09-01" }),
        todo({ id: "today", text: "Today", dueDate: "2026-09-02" }),
        todo({ id: "sunday", text: "Sunday", dueDate: "2026-09-06" }),
      ],
      "2026-08-31",
      "2026-09-02",
    );

    expect(model.isCurrentWeek).toBe(true);
    // Today leads, the rest of the week follows, then Monday and Tuesday wrap
    // to the end. Inbox is undated, so it trails every day column.
    expect(model.columns.map((column) => column.key)).toEqual([
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-08-31",
      "2026-09-01",
      "inbox",
    ]);
    expect(model.columns.at(-1)?.todos.map(({ id }) => id)).toEqual(["inbox"]);
    expect(columnTodoIds(model, "2026-09-02")).toEqual(["oldest", "older", "today"]);
    expect(columnTodoIds(model, "2026-09-06")).toEqual(["sunday"]);
    // The week's earlier days keep their own columns; open past-due rows still
    // appear only under Today.
    expect(columnTodoIds(model, "2026-08-31")).toEqual([]);
    expect(columnTodoIds(model, "2026-09-01")).toEqual([]);
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
      "2026-08-31",
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
      "2026-08-31",
      "2026-09-02",
    );

    expect(columnTodoIds(model, "2026-09-02")).toEqual([
      "00000000-0000-4000-8000-000000000022",
      "00000000-0000-4000-8000-000000000011",
    ]);
  });

  it("starts the current week on Today whichever weekday it falls on", () => {
    const sunday = buildTodoBoardModel([], "2026-08-31", "2026-09-06");
    expect(sunday.columns.slice(0, -1).map((column) => column.key)).toEqual([
      "2026-09-06",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ]);

    // Monday is already first, so its week needs no rotation.
    const monday = buildTodoBoardModel([], "2026-08-31", "2026-08-31");
    expect(monday.columns[0]?.key).toBe("2026-08-31");
    expect(monday.columns.at(-2)?.key).toBe("2026-09-06");
  });

  it("shows all Monday-through-Sunday dates for a navigated week", () => {
    const model = buildTodoBoardModel([], "2026-09-07", "2026-09-02");

    // A navigated week holds no Today, so it stays in plain Monday-first order.
    expect(model.isCurrentWeek).toBe(false);
    expect(model.columns.slice(0, -1).map((column) => column.key)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });

  it("shows open past-due tasks only under Today, never in historical date columns", () => {
    const open = todo({
      id: "open",
      text: "Open",
      dueDate: "2026-08-25",
    });
    const completed = todo({
      id: "completed",
      text: "Completed",
      completed: true,
      completedAt: "2026-08-25T16:00:00.000000Z",
      dueDate: "2026-08-25",
    });

    const model = buildTodoBoardModel([open, completed], "2026-08-24", "2026-09-02");

    expect(model.columns.flatMap((column) => column.todos).map(({ id }) => id)).not.toContain(
      "open",
    );
    const current = buildTodoBoardModel([open, completed], "2026-08-31", "2026-09-02");
    expect(columnTodoIds(current, "2026-09-02")).toEqual(["open"]);
    const historicalColumn = model.columns.find((column) => column.key === "2026-08-25");
    expect(historicalColumn?.todos.map(({ id }) => id)).toEqual(["completed"]);
  });

  it("keeps completed dates separate across a Sunday-to-Monday rollover", () => {
    const source = [
      todo({
        id: "open",
        text: "Open",
        dueDate: "2026-09-06",
        createdAt: "2026-09-01T08:00:00.000000Z",
      }),
      todo({
        id: "done",
        text: "Done",
        dueDate: "2026-09-06",
        completed: true,
        completedAt: "2026-09-06T12:00:00Z",
        createdAt: "2026-09-01T09:00:00.000000Z",
      }),
      todo({ id: "future", text: "Future", dueDate: "2026-09-08" }),
    ];
    const sunday = buildTodoBoardModel(source, "2026-08-31", "2026-09-06");
    expect(columnTodoIds(sunday, "2026-09-06")).toEqual(["open", "done"]);
    const monday = buildTodoBoardModel(source, "2026-09-07", "2026-09-07");
    expect(columnTodoIds(monday, "2026-09-07")).toEqual(["open"]);
    expect(columnTodoIds(monday, "2026-09-08")).toEqual(["future"]);
    const history = buildTodoBoardModel(source, "2026-08-31", "2026-09-07");
    expect(columnTodoIds(history, "2026-09-06")).toEqual(["done"]);
  });

  it("preserves date-only values and does not mutate the source list", () => {
    const source = Object.freeze([
      Object.freeze(todo({ id: "b", text: "B", dueDate: "2026-09-01" })),
      Object.freeze(todo({ id: "a", text: "A", dueDate: "2026-08-31" })),
    ]);

    const model = buildTodoBoardModel(source, "2026-08-31", "2026-09-02");

    expect(
      model.columns
        .find((column) => column.key === "2026-09-02")
        ?.todos.map(({ dueDate }) => dueDate),
    ).toEqual(["2026-08-31", "2026-09-01"]);
    expect(source.map(({ id }) => id)).toEqual(["b", "a"]);
  });

  it("counts open past-due tasks as overdue whichever week is selected", () => {
    const todos = [
      todo({ id: "inbox", text: "Inbox" }),
      todo({ id: "oldest", text: "Oldest", dueDate: "2026-08-30" }),
      todo({ id: "yesterday", text: "Yesterday", dueDate: "2026-09-01" }),
      todo({ id: "done", text: "Done", dueDate: "2026-08-30", completed: true }),
      todo({ id: "today", text: "Today", dueDate: "2026-09-02" }),
      todo({ id: "later", text: "Later", dueDate: "2026-09-06" }),
    ];

    for (const monday of ["2026-08-31", "2026-09-07"]) {
      const model = buildTodoBoardModel(todos, monday, "2026-09-02");
      expect(model.overdue.map(({ id }) => id)).toEqual(["oldest", "yesterday"]);
    }
  });

  it("rejects invalid selected weeks and duplicate rows", () => {
    expect(() => buildTodoBoardModel([], "2026-09-01", "2026-09-02")).toThrow("Monday");

    const duplicate = todo({ id: "same", text: "Duplicate" });
    expect(() =>
      buildTodoBoardModel([duplicate, { ...duplicate }], "2026-08-31", "2026-09-02"),
    ).toThrow("unique IDs");
  });
});
