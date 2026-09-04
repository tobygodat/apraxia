import { describe, expect, it } from "vitest";
import type { Todo } from "../../types/domain";
import { buildTodoBoardModel } from "./todoBoardModel";

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

describe("buildTodoBoardModel", () => {
  it("shows permanent Inbox, explicit Overdue, and today through Sunday for the current week", () => {
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
    expect(model.columns.map((column) => column.key)).toEqual([
      "inbox",
      "overdue",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
    expect(model.columns[0]?.todos.map(({ id }) => id)).toEqual(["inbox"]);
    expect(model.columns[1]?.todos.map(({ id }) => id)).toEqual([
      "oldest",
      "older",
    ]);
    expect(model.columns[2]?.todos.map(({ id }) => id)).toEqual(["today"]);
    expect(model.columns[6]?.todos.map(({ id }) => id)).toEqual(["sunday"]);
  });

  it("shows all Monday-through-Sunday dates for a navigated week", () => {
    const model = buildTodoBoardModel([], "2026-09-07", "2026-09-02");

    expect(model.isCurrentWeek).toBe(false);
    expect(model.columns.slice(2).map((column) => column.key)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });

  it("does not duplicate open overdue tasks in historical date columns", () => {
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

    const model = buildTodoBoardModel(
      [open, completed],
      "2026-08-24",
      "2026-09-02",
    );

    expect(model.columns[1]?.todos.map(({ id }) => id)).toEqual(["open"]);
    const historicalColumn = model.columns.find(
      (column) => column.key === "2026-08-25",
    );
    expect(historicalColumn?.todos.map(({ id }) => id)).toEqual(["completed"]);
  });

  it("preserves date-only values and does not mutate the source list", () => {
    const source = Object.freeze([
      Object.freeze(todo({ id: "b", text: "B", dueDate: "2026-09-01" })),
      Object.freeze(todo({ id: "a", text: "A", dueDate: "2026-08-31" })),
    ]);

    const model = buildTodoBoardModel(source, "2026-08-31", "2026-09-02");

    expect(model.columns[1]?.todos.map(({ dueDate }) => dueDate)).toEqual([
      "2026-08-31",
      "2026-09-01",
    ]);
    expect(source.map(({ id }) => id)).toEqual(["b", "a"]);
  });

  it("rejects invalid selected weeks and duplicate rows", () => {
    expect(() => buildTodoBoardModel([], "2026-09-01", "2026-09-02")).toThrow(
      "Monday",
    );

    const duplicate = todo({ id: "same", text: "Duplicate" });
    expect(() =>
      buildTodoBoardModel(
        [duplicate, { ...duplicate }],
        "2026-08-31",
        "2026-09-02",
      ),
    ).toThrow("unique IDs");
  });
});
