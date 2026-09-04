import { describe, expect, it } from "vitest";
import type { TodayTodo } from "../../types/domain";
import {
  applyOptimisticTodayRanks,
  applyPersistedTodayRanks,
  buildTodayListModel,
  moveTodayListTodo,
  placeTodayListTodo,
} from "./todayListModel";

function todo(
  id: string,
  overrides: Partial<TodayTodo> = {},
): TodayTodo {
  const todayRank = overrides.todayRank ?? null;
  return {
    id,
    text: id,
    completed: false,
    completedAt: null,
    dueDate: "2026-09-02",
    dueTime: null,
    projectId: null,
    projectTitle: null,
    todayRank,
    isOverdue: false,
    isManuallyOrdered: todayRank !== null,
    createdAt: "2026-09-01T12:00:00.000000Z",
    updatedAt: "2026-09-01T12:00:00.000000Z",
    ...overrides,
  };
}

describe("Today list model", () => {
  it("uses saved manual order before deterministic overdue-first defaults", () => {
    const model = buildTodayListModel(
      [
        todo("new-today", { createdAt: "2026-09-02T12:00:00.000000Z" }),
        todo("ranked-today-first", {
          todayRank: 1024,
          isManuallyOrdered: true,
        }),
        todo("new-old-overdue", {
          dueDate: "2026-08-25",
          isOverdue: true,
        }),
        todo("ranked-overdue-second", {
          dueDate: "2026-08-20",
          isOverdue: true,
          todayRank: 2048,
          isManuallyOrdered: true,
        }),
        todo("new-recent-overdue", {
          dueDate: "2026-09-01",
          isOverdue: true,
        }),
      ],
      "2026-09-02",
    );

    expect(model.todos.map(({ id }) => id)).toEqual([
      "ranked-today-first",
      "ranked-overdue-second",
      "new-old-overdue",
      "new-recent-overdue",
      "new-today",
    ]);
    expect(model.overdueCount).toBe(3);
    expect(model.dueTodayCount).toBe(2);
    expect(model.hasManualOrder).toBe(true);
  });

  it("places newly eligible unranked rows deterministically without erasing saved ranks", () => {
    const persisted = todo("persisted", {
      dueDate: "2026-09-01",
      isOverdue: true,
      todayRank: 1024,
      isManuallyOrdered: true,
    });
    const newlyEligible = todo("newly-eligible", {
      dueDate: "2026-09-01",
      isOverdue: true,
      createdAt: "2026-08-31T10:00:00.000000Z",
    });

    const model = buildTodayListModel(
      [newlyEligible, persisted],
      "2026-09-02",
    );

    expect(model.todos.map(({ id }) => id)).toEqual([
      "persisted",
      "newly-eligible",
    ]);
    expect(model.todos[0]?.todayRank).toBe(1024);
    expect(model.todos[1]?.todayRank).toBeNull();
  });

  it("rejects future, completed, duplicate, and inconsistent rows", () => {
    expect(() =>
      buildTodayListModel(
        [todo("future", { dueDate: "2026-09-03" })],
        "2026-09-02",
      ),
    ).toThrow("future todo");
    expect(() =>
      buildTodayListModel(
        [
          {
            ...todo("done"),
            completed: true,
            completedAt: "2026-09-02T12:00:00Z",
          } as unknown as TodayTodo,
        ],
        "2026-09-02",
      ),
    ).toThrow("incomplete todos");
    expect(() =>
      buildTodayListModel([todo("same"), todo("same")], "2026-09-02"),
    ).toThrow("unique IDs");
    expect(() =>
      buildTodayListModel(
        [
          todo("rank-mismatch", {
            todayRank: 1024,
            isManuallyOrdered: false,
          }),
        ],
        "2026-09-02",
      ),
    ).toThrow("manual-order status");
  });
});

describe("Today list movement", () => {
  const todos = [todo("a"), todo("b"), todo("c")];

  it("supports keyboard movement and preserves a boundary reference", () => {
    expect(moveTodayListTodo(todos, "b", "up").map(({ id }) => id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(moveTodayListTodo(todos, "a", "up")).toBe(todos);
  });

  it("places a dragged todo before or after its target", () => {
    expect(
      placeTodayListTodo(todos, "c", "a", "before").map(({ id }) => id),
    ).toEqual(["c", "a", "b"]);
    expect(
      placeTodayListTodo(todos, "a", "c", "after").map(({ id }) => id),
    ).toEqual(["b", "c", "a"]);
  });

  it("applies optimistic ranks and accepts only an exact persisted order", () => {
    const optimistic = applyOptimisticTodayRanks([todos[1]!, todos[0]!, todos[2]!]);
    expect(optimistic.map(({ todayRank }) => todayRank)).toEqual([
      1024,
      2048,
      3072,
    ]);
    expect(optimistic.every(({ isManuallyOrdered }) => isManuallyOrdered)).toBe(
      true,
    );

    const persisted = applyPersistedTodayRanks(optimistic, [
      { todoId: "b", todayRank: 10 },
      { todoId: "a", todayRank: 20 },
      { todoId: "c", todayRank: 30 },
    ]);
    expect(persisted.map(({ id }) => id)).toEqual(["b", "a", "c"]);
    expect(() =>
      applyPersistedTodayRanks(optimistic, [
        { todoId: "a", todayRank: 10 },
        { todoId: "b", todayRank: 20 },
        { todoId: "c", todayRank: 30 },
      ]),
    ).toThrow("did not match");
    expect(() =>
      applyPersistedTodayRanks(optimistic, [
        { todoId: "b", todayRank: 10 },
        { todoId: "a", todayRank: 10 },
        { todoId: "c", todayRank: 30 },
      ]),
    ).toThrow("invalid");
  });
});
