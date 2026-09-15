import { describe, expect, it } from "vitest";
import { TODAY_RANK_STEP } from "../../../../shared/todayRpcContract";
import type { TodayOrderableTodo } from "./todayOrder";
import { assignTodayRanks, sortTodayTodos } from "./todayOrder";

function todo(id: string, overrides: Partial<TodayOrderableTodo> = {}): TodayOrderableTodo {
  return {
    id,
    dueDate: "2026-09-02",
    dueTime: null,
    todayRank: null,
    createdAt: "2026-09-01T12:00:00Z",
    ...overrides,
  };
}

describe("Today default and manual ordering", () => {
  it("keeps ranked todos first, then defaults unranked todos overdue-first", () => {
    const input = [
      todo("new-today", { createdAt: "2026-09-02T14:00:00Z" }),
      todo("ranked-second", {
        dueDate: "2026-08-30",
        todayRank: 2048,
      }),
      todo("oldest-overdue", { dueDate: "2026-08-20" }),
      todo("ranked-first", { todayRank: 1024 }),
      todo("recent-overdue", { dueDate: "2026-09-01" }),
    ];

    expect(sortTodayTodos(input).map((item) => item.id)).toEqual([
      "ranked-first",
      "ranked-second",
      "oldest-overdue",
      "recent-overdue",
      "new-today",
    ]);
    expect(input.map((item) => item.id)).toEqual([
      "new-today",
      "ranked-second",
      "oldest-overdue",
      "ranked-first",
      "recent-overdue",
    ]);
  });

  it("uses due time, creation instant, and ID as deterministic tie breakers", () => {
    const input = [
      todo("untimed"),
      todo("later", { dueTime: "15:00:00" }),
      todo("earlier-b", {
        dueTime: "09:00:00",
        createdAt: "2026-09-01T12:00:00-04:00",
      }),
      todo("earlier-a", {
        dueTime: "09:00:00",
        createdAt: "2026-09-01T16:00:00Z",
      }),
      todo("old", {
        dueTime: "09:00:00",
        createdAt: "2026-09-01T15:59:59Z",
      }),
    ];

    expect(sortTodayTodos(input).map((item) => item.id)).toEqual([
      "old",
      "earlier-a",
      "earlier-b",
      "later",
      "untimed",
    ]);
  });

  it("preserves Postgres microsecond precision when ordering creation instants", () => {
    const input = [
      todo("a-later-by-microseconds", {
        createdAt: "2026-09-01T12:00:00.000999Z",
      }),
      todo("z-earlier-by-microseconds", {
        createdAt: "2026-09-01T12:00:00.000001Z",
      }),
    ];

    expect(sortTodayTodos(input).map((item) => item.id)).toEqual([
      "z-earlier-by-microseconds",
      "a-later-by-microseconds",
    ]);
  });

  it("rejects malformed domain dates and timestamps", () => {
    expect(() => sortTodayTodos([todo("bad", { dueDate: "09/02/2026" })])).toThrow(RangeError);
    expect(() => sortTodayTodos([todo("bad", { createdAt: "not-a-timestamp" })])).toThrow(
      RangeError,
    );
    expect(() =>
      sortTodayTodos([todo("missing-offset", { createdAt: "2026-09-01T12:00:00" })]),
    ).toThrow("RFC 3339");
  });
});

describe("Today RPC rank payloads", () => {
  it("builds the same 1024-spaced ranks as Postgres", () => {
    expect([...assignTodayRanks(["a", "b", "c"])]).toEqual([
      ["a", 1024],
      ["b", 2048],
      ["c", 3072],
    ]);
  });

  it("rejects duplicate IDs before an atomic reorder call", () => {
    expect(() => assignTodayRanks(["a", "a"])).toThrow("duplicate todo IDs");
  });

  it.each([1001, 5000])("retains all %i IDs and their exact rank spacing", (count) => {
    const ids = Array.from({ length: count }, (_, index) => `task-${index}`);
    const ranks = assignTodayRanks(ids);
    expect(ranks.size).toBe(count);
    expect([...ranks]).toEqual(ids.map((id, index) => [id, (index + 1) * TODAY_RANK_STEP]));
    expect([...ranks.values()].every(Number.isSafeInteger)).toBe(true);
  });

  it("rejects UUID case aliases without changing generic ID support or map keys", () => {
    const uuid = "abcdef12-3456-4789-8abc-def123456789";
    expect(() => assignTodayRanks([uuid, uuid.toUpperCase()])).toThrow("duplicate todo IDs");
    expect([...assignTodayRanks([uuid.toUpperCase(), "generic-task"])]).toEqual([
      [uuid.toUpperCase(), 1024],
      ["generic-task", 2048],
    ]);
  });

  it("accepts an empty order and rejects lengths that would produce unsafe ranks", () => {
    expect([...assignTodayRanks([])]).toEqual([]);
    const unsafeCount = Math.floor(Number.MAX_SAFE_INTEGER / TODAY_RANK_STEP) + 1;
    // An array-like sentinel exercises the arithmetic guard before iteration.
    const unsafeIds = { length: unsafeCount } as unknown as readonly string[];
    expect(() => assignTodayRanks(unsafeIds)).toThrow("safe integer ranks");
  });
});
