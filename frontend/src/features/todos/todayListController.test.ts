// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TODAY_RANK_STEP } from "../../../../shared/todayRpcContract";
import type { DeleteUndoToken, NewTodoInput, TodayTodo, Todo } from "../../types/domain";
import type {
  TodoRequestOptions, TodoService, TodoWorkspaceSnapshot, UpdateTodoDetailsInput,
} from "./todoService";
import { TodayListController, useTodayListController } from "./todayListController";

afterEach(cleanup);
const DATE = "2026-09-02";
const TOKEN = "2026-09-02T12:34:56.123456+00:00" as DeleteUndoToken;
function id(index: number): string {
  return `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
const A = id(1), B = id(2), C = id(3), PROJECT = id(90), OTHER_PROJECT = id(91);

function todo(todoId = A, overrides: Partial<Todo> = {}): Todo {
  return {
    id: todoId, text: `Task ${todoId.slice(-1)}`,
    completed: false, completedAt: null, dueDate: DATE, dueTime: null,
    projectId: null, todayRank: null,
    createdAt: "2026-09-01T12:00:00.000000Z",
    updatedAt: "2026-09-01T12:00:00.000000Z",
    ...overrides,
  };
}

function today(row: Todo, localDate = DATE): TodayTodo {
  return {
    ...row, completed: false, completedAt: null, dueDate: row.dueDate!,
    isOverdue: row.dueDate! < localDate, isManuallyOrdered: row.todayRank !== null,
    projectTitle: row.projectId === PROJECT ? "Original project" : null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeTodoService implements TodoService {
  rows: Todo[];
  deleted: Todo | null = null;
  constructor(rows: readonly Todo[]) { this.rows = [...rows]; }

  loadWorkspace = vi.fn(async (_options: TodoRequestOptions): Promise<TodoWorkspaceSnapshot> => {
    throw new Error("not used");
  });
  createTodo = vi.fn(async (_input: NewTodoInput, _options: TodoRequestOptions): Promise<Todo> => {
    throw new Error("not used");
  });
  loadToday = vi.fn(async (localDate: string, _options: TodoRequestOptions): Promise<readonly TodayTodo[]> =>
    this.rows.filter((row) => !row.completed && row.dueDate !== null && row.dueDate <= localDate)
      .map((row) => today(row, localDate)));
  updateTodoDetails = vi.fn(async (
    todoId: string, input: UpdateTodoDetailsInput, _options: TodoRequestOptions,
  ): Promise<Todo> => {
    const saved = { ...this.rows.find((row) => row.id === todoId)!, ...input };
    this.rows = this.rows.map((row) => row.id === todoId ? saved : row);
    return saved;
  });
  setTodoCompleted = vi.fn(async (
    todoId: string, completed: boolean, _options: TodoRequestOptions,
  ): Promise<Todo> => {
    const saved = {
      ...this.rows.find((row) => row.id === todoId)!, completed,
      completedAt: completed ? "2026-09-02T14:00:00.123456Z" : null,
    };
    this.rows = this.rows.map((row) => row.id === todoId ? saved : row);
    return saved;
  });
  softDeleteTodo = vi.fn(async (
    todoId: string, _options: TodoRequestOptions,
  ): Promise<DeleteUndoToken> => {
    this.deleted = this.rows.find((row) => row.id === todoId)!;
    this.rows = this.rows.filter((row) => row.id !== todoId);
    return TOKEN;
  });
  restoreTodo = vi.fn(async (
    _todoId: string, _undoToken: DeleteUndoToken, _options: TodoRequestOptions,
  ): Promise<boolean> => {
    this.rows.push(this.deleted!);
    this.deleted = null;
    return true;
  });
  reorderToday = vi.fn(async (
    _localDate: string, orderedTodoIds: readonly string[], _options: TodoRequestOptions,
  ): Promise<readonly { todoId: string; todayRank: number }[]> => {
    const ranks = new Map(orderedTodoIds.map((todoId, index) => [todoId, (index + 1) * TODAY_RANK_STEP]));
    this.rows = this.rows.map((row) => ranks.has(row.id) ? { ...row, todayRank: ranks.get(row.id)! } : row);
    return orderedTodoIds.map((todoId) => ({ todoId, todayRank: ranks.get(todoId)! }));
  });
}

async function ready(rows: Todo[] = [todo(A), todo(B)]) {
  const service = new FakeTodoService(rows);
  const controller = new TodayListController(service, DATE);
  expect(await controller.load()).toBe(true);
  return { service, controller };
}
function ids(controller: TodayListController) {
  return controller.getSnapshot().model.todos.map((row) => row.id);
}

describe("TodayListController reads and ordering", () => {
  it("keeps saved ranks ahead of deterministic newly eligible overdue tasks", async () => {
    const { controller, service } = await ready([
      todo(A, { dueDate: "2026-08-30" }), todo(B, { todayRank: 1024 }),
    ]);
    expect(ids(controller)).toEqual([B, A]);
    expect(controller.getSnapshot().model.todos.filter(todo => todo.isOverdue)).toHaveLength(1);
    expect(service.loadToday).toHaveBeenCalledWith(DATE, { signal: expect.any(AbortSignal) });
  });

  it.each([
    { id: "not-a-uuid" }, { text: " " }, { dueTime: "10:00:00.1234567" },
    { completed: true, completedAt: null }, { todayRank: 1.5 },
    { updatedAt: "2026-02-30T12:00:00Z" }, { dueDate: "2026-09-03" },
    { isOverdue: true }, { projectTitle: { unsafe: "provider object" } },
  ])("preserves confirmed rows when a Today read is malformed: %j", async (invalid) => {
    const { service, controller } = await ready();
    service.loadToday.mockResolvedValueOnce([{ ...today(todo()), ...invalid } as TodayTodo]);
    expect(await controller.load()).toBe(false);
    expect(ids(controller)).toEqual([A, B]);
    expect(controller.getSnapshot().loadError).toBe("Today could not be loaded. Try again.");
  });

  it("rejects sparse or case-insensitively duplicated provider rows", async () => {
    const { service, controller } = await ready();
    service.loadToday.mockResolvedValueOnce(new Array<TodayTodo>(1));
    expect(await controller.load()).toBe(false);
    service.loadToday.mockResolvedValueOnce([today(todo()), today(todo())]);
    expect(await controller.load()).toBe(false);
  });

  it("shows safe retry errors for upstream AbortError without exposing provider text", async () => {
    const { service, controller } = await ready();
    service.loadToday.mockRejectedValueOnce(new DOMException("private server token", "AbortError"));
    expect(await controller.load()).toBe(false);
    expect(controller.getSnapshot().loadStatus).toBe("error");
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("private server token");
  });

  it("ignores a replaced read even if the adapter ignores cancellation", async () => {
    const { service, controller } = await ready();
    const oldRead = deferred<readonly TodayTodo[]>();
    service.loadToday.mockReturnValueOnce(oldRead.promise);
    const firstLoad = controller.load();
    service.rows = [todo(C)];
    expect(await controller.load()).toBe(true);
    expect(await firstLoad).toBe(false);
    oldRead.resolve([today(todo(A))]);
    await Promise.resolve();
    expect(ids(controller)).toEqual([C]);
  });

  it("sends the full eligible ID order and rolls back on failure", async () => {
    const { service, controller } = await ready([todo(A), todo(B), todo(C)]);
    const write = deferred<readonly { todoId: string; todayRank: number }[]>();
    service.reorderToday.mockReturnValueOnce(write.promise);
    const moved = controller.moveTodo(B, "up");
    expect(ids(controller)).toEqual([B, A, C]);
    expect(service.reorderToday).toHaveBeenCalledWith(DATE, [B, A, C], { signal: expect.any(AbortSignal) });
    write.reject(new Error("private exception"));
    expect(await moved).toBe(false);
    expect(ids(controller)).toEqual([A, B, C]);
    expect(controller.getSnapshot().model.todos.every((row) => row.todayRank === null)).toBe(true);
    expect(controller.getSnapshot().mutationError).toContain("previous order was restored");
  });

  it("persists keyboard and drag orders across reload", async () => {
    const { controller, service } = await ready([todo(A), todo(B), todo(C)]);
    expect(await controller.moveTodo(A, "down")).toBe(true);
    expect(await controller.placeTodo(C, B, "before")).toBe(true);
    const fresh = new TodayListController(service, DATE);
    expect(await fresh.load()).toBe(true);
    expect(ids(fresh)).toEqual([C, B, A]);
  });

  it.each([
    [{ todoId: B, todayRank: 1024 }],
    [{ todoId: B, todayRank: 1024 }, { todoId: A, todayRank: 1.5 }],
    [{ todoId: A, todayRank: 1024 }, { todoId: B, todayRank: 2048 }],
  ])("rejects a partial or unpersisted reorder result", async (...updates) => {
    const { service, controller } = await ready();
    service.reorderToday.mockResolvedValueOnce(updates);
    expect(await controller.moveTodo(B, "up")).toBe(false);
    expect(ids(controller)).toEqual([A, B]);
  });

  it.each([1001, 5000])("persists all %i rows above the former reorder cap", async (count) => {
    const { service, controller } = await ready(Array.from({ length: count }, (_, index) => todo(id(index + 1))));
    const expectedIds = Array.from({ length: count }, (_, index) => id(index + 1));
    [expectedIds[0], expectedIds[1]] = [expectedIds[1]!, expectedIds[0]!];
    expect(await controller.moveTodo(A, "down")).toBe(true);
    expect(controller.getSnapshot().pendingMutation).toBeNull();
    expect(controller.getSnapshot().mutationError).toBeNull();
    expect(service.reorderToday).toHaveBeenCalledWith(DATE, expectedIds, { signal: expect.any(AbortSignal) });
    expect(ids(controller)).toEqual(expectedIds);
    expect(controller.getSnapshot().model.todos.map((row) => row.todayRank)).toEqual(
      expectedIds.map((_, index) => (index + 1) * TODAY_RANK_STEP),
    );
    expect(await controller.load()).toBe(true);
    expect(ids(controller)).toEqual(expectedIds);
  });

  it("rejects a 1000-row truncated response to a complete 1001-row reorder", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => todo(id(index + 1)));
    const { service, controller } = await ready(rows);
    service.reorderToday.mockImplementationOnce(async (_date, orderedIds) =>
      orderedIds.slice(0, 1000).map((todoId, index) => ({ todoId, todayRank: (index + 1) * TODAY_RANK_STEP })));
    expect(await controller.moveTodo(A, "down")).toBe(false);
    expect(service.reorderToday.mock.calls[0]?.[1]).toHaveLength(1001);
    expect(controller.getSnapshot().pendingMutation).toBeNull();
    expect(controller.getSnapshot().mutationError).toContain("previous order was restored");
    expect(ids(controller)).toEqual(rows.map((row) => row.id));
    expect(controller.getSnapshot().model.todos.every((row) => row.todayRank === null)).toBe(true);
  });
});

describe("TodayListController details and completion", () => {
  it("removes completed tasks immediately and validates exact saved state", async () => {
    const { service, controller } = await ready();
    const write = deferred<Todo>();
    service.setTodoCompleted.mockReturnValueOnce(write.promise);
    const completion = controller.completeTodo(A);
    expect(ids(controller)).toEqual([B]);
    write.resolve(todo(A, { completed: true, completedAt: "2026-09-02T13:00:00.123456Z" }));
    expect(await completion).toBe(true);
    expect(ids(controller)).toEqual([B]);
    expect(controller.getSnapshot().announcement.message).toContain("completed");
  });

  it("rolls completion back after upstream abort or malformed timestamp", async () => {
    const { service, controller } = await ready();
    service.setTodoCompleted.mockRejectedValueOnce({ name: "AbortError" });
    expect(await controller.completeTodo(A)).toBe(false);
    service.setTodoCompleted.mockResolvedValueOnce(todo(A, { completed: true, completedAt: "private invalid time" }));
    expect(await controller.completeTodo(A)).toBe(false);
    expect(ids(controller)).toEqual([A, B]);
    expect(controller.getSnapshot().pendingMutation).toBeNull();
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("private invalid time");
  });

  it("optimistically updates all details, preserving fractional time and date-only values", async () => {
    const { service, controller } = await ready();
    const write = deferred<Todo>();
    service.updateTodoDetails.mockReturnValueOnce(write.promise);
    const input = { text: "Revised", projectId: PROJECT, dueDate: "2026-09-01", dueTime: "09:30:00.123456" };
    const update = controller.updateDetails(A, input);
    expect(controller.getSnapshot().model.todos[0]).toMatchObject({ ...input, isOverdue: true, projectTitle: null });
    write.resolve(todo(A, { ...input, updatedAt: "2026-09-02T14:00:00.654321Z" }));
    expect(await update).toBe(true);
    expect(service.updateTodoDetails).toHaveBeenCalledWith(A, input, { signal: expect.any(AbortSignal) });
    expect(controller.getSnapshot().model.todos[0]?.dueTime).toBe("09:30:00.123456");
  });

  it("accepts equivalent zero-padding without rounding a persisted fraction", async () => {
    const { service, controller } = await ready();
    service.updateTodoDetails.mockResolvedValueOnce(todo(A, { dueTime: "09:30:00.120000" }));
    expect(await controller.updateDetails(A, { dueDate: DATE, dueTime: "09:30:00.12" })).toBe(true);
    expect(controller.getSnapshot().model.todos.find((row) => row.id === A)?.dueTime).toBe("09:30:00.120000");
    service.updateTodoDetails.mockResolvedValueOnce(todo(A, { dueTime: "09:30:00.120001" }));
    expect(await controller.updateDetails(A, { dueDate: DATE, dueTime: "09:30:00.12" })).toBe(false);
  });

  it("clears date and time atomically, removing the task from Today", async () => {
    const { controller, service } = await ready([todo(A, { dueTime: "10:15:00.123456" })]);
    expect(await controller.updateDetails(A, { dueDate: null, dueTime: null })).toBe(true);
    expect(ids(controller)).toEqual([]);
    expect(service.updateTodoDetails).toHaveBeenCalledWith(A, { dueDate: null, dueTime: null }, expect.anything());
  });

  it.each([
    null, [], {}, { dueDate: null }, { dueTime: "09:00" }, { text: " " },
    { dueDate: "2026-02-30" }, { projectId: "secret" }, { userId: A, text: "changed" },
  ])("rejects invalid or out-of-contract input before the provider: %j", async (input) => {
    const { controller, service } = await ready();
    expect(await controller.updateDetails(A, input as UpdateTodoDetailsInput)).toBe(false);
    expect(service.updateTodoDetails).not.toHaveBeenCalled();
    expect(ids(controller)).toEqual([A, B]);
  });

  it("removes future reschedules immediately and restores them on failed writes", async () => {
    const { service, controller } = await ready();
    const write = deferred<Todo>();
    service.updateTodoDetails.mockReturnValueOnce(write.promise);
    const update = controller.rescheduleTodo(A, "2026-09-05");
    expect(ids(controller)).toEqual([B]);
    write.reject(new Error("offline"));
    expect(await update).toBe(false);
    expect(ids(controller)).toEqual([A, B]);
    expect(await controller.rescheduleTodo(A, "2026-09-05")).toBe(true);
    expect(ids(controller)).toEqual([B]);
  });

  it("does not resurrect a concurrent completion returned by an eligible reschedule", async () => {
    const { service, controller } = await ready([todo(A, { dueDate: "2026-09-01" })]);
    service.updateTodoDetails.mockResolvedValueOnce(todo(A, {
      dueDate: DATE, completed: true, completedAt: "2026-09-02T15:00:00.123456Z",
    }));
    expect(await controller.rescheduleTodo(A, DATE)).toBe(true);
    expect(ids(controller)).toEqual([]);
    expect(controller.getSnapshot().announcement.message).toContain("complete and no longer");
  });

  it("reconciles authoritative fields/rank and never keeps an obsolete project title", async () => {
    const { service, controller } = await ready([
      todo(A, { dueDate: "2026-09-01", todayRank: 1024, projectId: PROJECT }),
      todo(B, { todayRank: 2048 }),
    ]);
    service.updateTodoDetails.mockResolvedValueOnce(todo(A, {
      text: "Authoritative task", projectId: OTHER_PROJECT, dueDate: DATE,
      dueTime: "10:15:00.123456", todayRank: null,
    }));
    expect(await controller.rescheduleTodo(A, DATE)).toBe(true);
    expect(ids(controller)).toEqual([B, A]);
    expect(controller.getSnapshot().model.todos[1]).toMatchObject({
      text: "Authoritative task", projectId: OTHER_PROJECT, projectTitle: null,
      dueTime: "10:15:00.123456", todayRank: null, isOverdue: false, isManuallyOrdered: false,
    });
  });

  it.each([
    { completed: true, completedAt: null },
    { completed: false, completedAt: "2026-09-02T15:00:00.123456Z" },
    { todayRank: -1 }, { dueTime: "10:15:00.1234567" }, { id: B },
  ])("rolls malformed write responses back to the exact confirmed row: %j", async (invalid) => {
    const source = todo(A, { dueDate: "2026-09-01" });
    const { service, controller } = await ready([source]);
    service.updateTodoDetails.mockResolvedValueOnce(todo(A, { dueDate: DATE, ...invalid }));
    expect(await controller.rescheduleTodo(A, DATE)).toBe(false);
    expect(controller.getSnapshot().model.todos).toEqual([today(source)]);
  });

  it("settles external abort promptly even if the provider never settles", async () => {
    const { service, controller } = await ready();
    const write = deferred<Todo>();
    const abort = new AbortController();
    service.updateTodoDetails.mockReturnValueOnce(write.promise);
    const update = controller.updateDetails(A, { text: "New" }, { signal: abort.signal });
    abort.abort();
    expect(await update).toBe(false);
    expect(ids(controller)).toEqual([A, B]);
    expect(controller.getSnapshot().pendingMutation).toBeNull();
    expect(controller.getSnapshot().mutationError).toContain("cancelled");
    expect(service.updateTodoDetails.mock.calls[0]?.[2].signal.aborted).toBe(true);
    write.resolve(todo(A, { text: "New" }));
    await Promise.resolve();
    expect(controller.getSnapshot().model.todos[0]?.text).toBe("Task 1");
  });

  it("does not call the provider for an already-aborted form", async () => {
    const { service, controller } = await ready();
    const abort = new AbortController();
    abort.abort();
    expect(await controller.updateDetails(A, { text: "New" }, { signal: abort.signal })).toBe(false);
    expect(service.updateTodoDetails).not.toHaveBeenCalled();
  });
});

describe("TodayListController Delete and Undo", () => {
  it("removes optimistically and keeps the exact fractional token private", async () => {
    const { service, controller } = await ready();
    const write = deferred<DeleteUndoToken>();
    service.softDeleteTodo.mockReturnValueOnce(write.promise);
    const deletion = controller.deleteTodo(A);
    expect(ids(controller)).toEqual([B]);
    expect(await controller.deleteTodo(B)).toBe(false);
    controller.dismissUndo();
    expect(controller.getSnapshot().pendingMutation?.kind).toBe("delete");
    write.resolve(TOKEN);
    expect(await deletion).toBe(true);
    expect(controller.getSnapshot().undoNotice).toEqual({
      todoId: A, todoText: "Task 1", pending: false, error: null,
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(TOKEN);
    expect(await controller.deleteTodo(B)).toBe(false);
    // A settled Undo notice is not a global write lock.
    expect(await controller.updateDetails(B, { text: "Other edited" })).toBe(true);
    expect(await controller.completeTodo(B)).toBe(true);
    expect(controller.getSnapshot().undoNotice?.todoId).toBe(A);
  });

  it.each(["private-token", "2026-09-02T12:34:56.1234567Z", "2026-02-30T12:00:00Z"])(
    "rejects malformed deletion tokens and rolls back: %s", async (token) => {
      const { service, controller } = await ready();
      service.softDeleteTodo.mockResolvedValueOnce(token as DeleteUndoToken);
      expect(await controller.deleteTodo(A)).toBe(false);
      expect(ids(controller)).toEqual([A, B]);
      expect(controller.getSnapshot().undoNotice).toBeNull();
      expect(controller.getSnapshot().mutationError).toContain("not deleted");
      expect(JSON.stringify(controller.getSnapshot())).not.toContain(token);
    },
  );

  it("restores with the exact token, then displays only authoritative eligible rows", async () => {
    const { service, controller } = await ready();
    expect(await controller.deleteTodo(A)).toBe(true);
    const read = deferred<readonly TodayTodo[]>();
    service.loadToday.mockReturnValueOnce(read.promise);
    const undo = controller.undoDelete();
    await waitFor(() => expect(service.loadToday).toHaveBeenCalledTimes(2));
    expect(service.restoreTodo).toHaveBeenCalledWith(A, TOKEN, { signal: expect.any(AbortSignal) });
    expect(ids(controller)).toEqual([B]);
    expect(controller.getSnapshot().undoNotice?.pending).toBe(true);
    expect(await controller.completeTodo(B)).toBe(false);
    expect(await controller.undoDelete()).toBe(false);
    controller.dismissUndo();
    expect(controller.getSnapshot().undoNotice).not.toBeNull();
    read.resolve([
      today(todo(B, { todayRank: 1024 })),
      today(todo(A, { text: "Saved elsewhere", todayRank: 2048, dueTime: "11:00:00.123456" })),
    ]);
    expect(await undo).toBe(true);
    expect(ids(controller)).toEqual([B, A]);
    expect(controller.getSnapshot().model.todos[1]?.text).toBe("Saved elsewhere");
    expect(controller.getSnapshot().undoNotice).toBeNull();
    expect(service.createTodo).not.toHaveBeenCalled();
  });

  it("does not reinsert a restored task that is now completed, undated, or future", async () => {
    const { service, controller } = await ready();
    expect(await controller.deleteTodo(A)).toBe(true);
    service.restoreTodo.mockImplementationOnce(async () => true);
    expect(await controller.undoDelete()).toBe(true);
    expect(ids(controller)).toEqual([B]);
    expect(controller.getSnapshot().undoNotice).toBeNull();
  });

  it("retains Undo on false or rejected restore without a speculative read", async () => {
    const { service, controller } = await ready();
    await controller.deleteTodo(A);
    service.restoreTodo.mockResolvedValueOnce(false);
    expect(await controller.undoDelete()).toBe(false);
    expect(service.loadToday).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().undoNotice?.error).toContain("Try Undo again");
    service.restoreTodo.mockRejectedValueOnce(new Error("private restore failure"));
    expect(await controller.undoDelete()).toBe(false);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("private restore failure");
    expect(await controller.undoDelete()).toBe(true);
    expect(service.restoreTodo).toHaveBeenCalledTimes(3);
  });

  it("retries only the read after successful restore followed by failed reconciliation", async () => {
    const { service, controller } = await ready();
    await controller.deleteTodo(A);
    service.loadToday.mockRejectedValueOnce(new Error("private read failure"));
    expect(await controller.undoDelete()).toBe(false);
    expect(controller.getSnapshot().loadStatus).toBe("error");
    expect(controller.getSnapshot().undoNotice?.error).toContain("task was restored");
    expect(ids(controller)).toEqual([B]);
    expect(await controller.undoDelete()).toBe(true);
    expect(service.restoreTodo).toHaveBeenCalledTimes(1);
    expect(service.createTodo).not.toHaveBeenCalled();
    expect(ids(controller)).toEqual([A, B]);
  });

  it("keeps a visible refresh error after dismissing a successfully-restored notice", async () => {
    const { service, controller } = await ready();
    await controller.deleteTodo(A);
    service.loadToday.mockResolvedValueOnce([today(todo(A, { updatedAt: "invalid" }))]);
    expect(await controller.undoDelete()).toBe(false);
    controller.dismissUndo();
    expect(controller.getSnapshot().undoNotice).toBeNull();
    expect(controller.getSnapshot().loadStatus).toBe("error");
    expect(controller.getSnapshot().loadError).toContain("task was restored");
    expect(await controller.load()).toBe(true);
    expect(service.restoreTodo).toHaveBeenCalledTimes(1);
    expect(ids(controller)).toEqual([A, B]);
  });

  it("allows dismissing settled Undo while an unrelated mutation is active", async () => {
    const { service, controller } = await ready();
    await controller.deleteTodo(A);
    const write = deferred<Todo>();
    service.setTodoCompleted.mockReturnValueOnce(write.promise);
    const completion = controller.completeTodo(B);
    controller.dismissUndo();
    expect(controller.getSnapshot().undoNotice).toBeNull();
    write.resolve(todo(B, { completed: true, completedAt: "2026-09-02T15:00:00Z" }));
    expect(await completion).toBe(true);
    expect(await controller.undoDelete()).toBe(false);
  });
});

describe("TodayListController lifecycle, date changes, and shared create", () => {
  it("accepts eligible creates with no joined title, consumes ineligible ones, and ignores replays", async () => {
    const { controller } = await ready();
    expect(controller.acceptCreatedTodo(todo(C, { projectId: PROJECT }))).toBe(true);
    expect(controller.getSnapshot().model.todos.find((row) => row.id === C)?.projectTitle).toBeNull();
    expect(controller.acceptCreatedTodo(todo(C))).toBe(false);
    expect(controller.acceptCreatedTodo(todo(id(4), { dueDate: null }))).toBe(true);
    expect(controller.acceptCreatedTodo(todo(id(4)))).toBe(false);
    expect(ids(controller)).toEqual([A, B, C]);
    expect(controller.acceptCreatedTodo(todo("invalid"))).toBe(false);
  });

  it("preserves creates accepted during an older read", async () => {
    const { controller, service } = await ready();
    const read = deferred<readonly TodayTodo[]>();
    service.loadToday.mockReturnValueOnce(read.promise);
    const load = controller.load();
    expect(controller.acceptCreatedTodo(todo(C))).toBe(true);
    read.resolve([today(todo(A)), today(todo(B))]);
    expect(await load).toBe(true);
    expect(ids(controller)).toEqual([A, B, C]);
  });

  it("preserves accepted creates when an overlapping optimistic write fails", async () => {
    const { controller, service } = await ready();
    const write = deferred<Todo>();
    service.setTodoCompleted.mockReturnValueOnce(write.promise);
    const completion = controller.completeTodo(A);
    expect(controller.acceptCreatedTodo(todo(C))).toBe(true);
    expect(ids(controller)).toEqual([B, C]);
    write.reject(new Error("offline"));
    expect(await completion).toBe(false);
    expect(ids(controller)).toEqual([A, B, C]);
  });

  it("preserves accepted creates when an overlapping reorder succeeds", async () => {
    const { controller, service } = await ready();
    const write = deferred<readonly { todoId: string; todayRank: number }[]>();
    service.reorderToday.mockReturnValueOnce(write.promise);
    const moved = controller.moveTodo(B, "up");
    expect(controller.acceptCreatedTodo(todo(C))).toBe(true);
    write.resolve([{ todoId: B, todayRank: 1024 }, { todoId: A, todayRank: 2048 }]);
    expect(await moved).toBe(true);
    expect(ids(controller)).toEqual([B, A, C]);
  });

  it("queues reloads behind writes instead of discarding an outstanding Delete token", async () => {
    const { controller, service } = await ready();
    const write = deferred<DeleteUndoToken>();
    service.softDeleteTodo.mockReturnValueOnce(write.promise);
    const deletion = controller.deleteTodo(A);
    expect(await controller.load()).toBe(false);
    expect(service.loadToday).toHaveBeenCalledTimes(1);
    expect(service.softDeleteTodo.mock.calls[0]?.[1].signal.aborted).toBe(false);
    service.rows = [todo(B)];
    write.resolve(TOKEN);
    expect(await deletion).toBe(true);
    await waitFor(() => expect(controller.getSnapshot().loadStatus).toBe("ready"));
    expect(service.loadToday).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().undoNotice?.todoId).toBe(A);
    expect(ids(controller)).toEqual([B]);
  });

  it("preserves Undo and reclassifies original dates across local midnight", async () => {
    const { controller, service } = await ready([todo(A), todo(B), todo(C, { dueDate: "2026-09-03" })]);
    await controller.deleteTodo(A);
    expect(await controller.setLocalDate("2026-09-03")).toBe(true);
    expect(controller.getSnapshot().undoNotice?.todoId).toBe(A);
    expect(ids(controller)).toEqual([B, C]);
    expect(controller.getSnapshot().model.todos[0]).toMatchObject({ dueDate: DATE, isOverdue: true });
    expect(await controller.undoDelete()).toBe(true);
    expect(service.restoreTodo).toHaveBeenCalledWith(A, TOKEN, expect.anything());
    expect(ids(controller)).toEqual([A, B, C]);
  });

  it("does not abort a Delete when midnight arrives before its response", async () => {
    const { controller, service } = await ready();
    const write = deferred<DeleteUndoToken>();
    service.softDeleteTodo.mockReturnValueOnce(write.promise);
    const deletion = controller.deleteTodo(A);
    expect(await controller.setLocalDate("2026-09-03")).toBe(false);
    expect(service.softDeleteTodo.mock.calls[0]?.[1].signal.aborted).toBe(false);
    expect(controller.getSnapshot().model.todos[0]?.isOverdue).toBe(true);
    service.rows = [todo(B)];
    write.resolve(TOKEN);
    expect(await deletion).toBe(true);
    await waitFor(() => expect(controller.getSnapshot().loadStatus).toBe("ready"));
    expect(controller.getSnapshot().model.localDate).toBe("2026-09-03");
    expect(controller.getSnapshot().undoNotice?.todoId).toBe(A);
    expect(service.loadToday).toHaveBeenLastCalledWith("2026-09-03", expect.anything());
  });

  it("still refreshes newly eligible rows after a restore fails across midnight", async () => {
    const { controller, service } = await ready([todo(A), todo(B), todo(C, { dueDate: "2026-09-03" })]);
    await controller.deleteTodo(A);
    const restore = deferred<boolean>();
    service.restoreTodo.mockReturnValueOnce(restore.promise);
    const undo = controller.undoDelete();
    expect(await controller.setLocalDate("2026-09-03")).toBe(false);
    restore.resolve(false);
    expect(await undo).toBe(false);
    await waitFor(() => expect(controller.getSnapshot().loadStatus).toBe("ready"));
    expect(ids(controller)).toEqual([B, C]);
    expect(controller.getSnapshot().undoNotice?.error).toContain("Try Undo again");
    expect(service.loadToday).toHaveBeenLastCalledWith("2026-09-03", expect.anything());
  });

  it("re-reads the current local date if midnight arrives during Undo reconciliation", async () => {
    const { controller, service } = await ready();
    await controller.deleteTodo(A);
    const read = deferred<readonly TodayTodo[]>();
    service.loadToday.mockReturnValueOnce(read.promise);
    const undo = controller.undoDelete();
    await waitFor(() => expect(service.loadToday).toHaveBeenCalledTimes(2));
    expect(await controller.setLocalDate("2026-09-03")).toBe(false);
    read.resolve([today(todo(A)), today(todo(B))]);
    expect(await undo).toBe(true);
    expect(service.restoreTodo).toHaveBeenCalledTimes(1);
    expect(service.loadToday).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().model.localDate).toBe("2026-09-03");
    expect(controller.getSnapshot().model.todos.every((row) => row.isOverdue)).toBe(true);
  });

  it("clears account data, rejects retained callbacks, and ignores late provider results after stop", async () => {
    const { controller, service } = await ready();
    const write = deferred<Todo>();
    service.updateTodoDetails.mockReturnValueOnce(write.promise);
    const update = controller.updateDetails(A, { text: "Old account" });
    controller.stop();
    expect(await update).toBe(false);
    expect(await controller.load()).toBe(false);
    expect(await controller.setLocalDate("2026-09-03")).toBe(false);
    expect(await controller.updateDetails(A, { text: "Retained" })).toBe(false);
    expect(await controller.completeTodo(A)).toBe(false);
    expect(await controller.deleteTodo(A)).toBe(false);
    expect(await controller.undoDelete()).toBe(false);
    expect(controller.acceptCreatedTodo(todo(C))).toBe(false);
    write.resolve(todo(A, { text: "Old account" }));
    await Promise.resolve();
    expect(ids(controller)).toEqual([]);
    expect(controller.getSnapshot().undoNotice).toBeNull();
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("Old account");
    expect(await controller.start()).toBe(true);
    expect(ids(controller)).toEqual([A, B]);
  });
});

describe("useTodayListController", () => {
  it("keeps a one-time live read failure visible with concurrent-root StrictMode timing", async () => {
    const service = new FakeTodoService([todo(A)]);
    let failNextLiveRead = true;
    const liveReads: AbortSignal[] = [];
    service.loadToday.mockImplementation(async (_date, { signal }) => {
      await Promise.resolve();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      liveReads.push(signal);
      if (failNextLiveRead) {
        failNextLiveRead = false;
        throw new Error("private one-time provider failure");
      }
      return [today(todo(A))];
    });
    let current: ReturnType<typeof useTodayListController> | undefined;
    function Harness() {
      current = useTodayListController(service, DATE, "scope");
      return createElement("p", null, current.state.loadStatus);
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    // Do not wrap initial rendering in act: that flushes passive effects before
    // microtasks and hides the browser's layout-to-passive StrictMode timing.
    const testEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnvironment = testEnvironment.IS_REACT_ACT_ENVIRONMENT;
    testEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      root.render(createElement(StrictMode, null, createElement(Harness)));
      await vi.waitFor(() => {
        expect(current?.state.loadStatus).toBe("error");
      });
      expect(liveReads).toHaveLength(1);
      expect(service.loadToday).toHaveBeenCalledTimes(2);
      expect(current?.state.loadError).toBe("Today could not be loaded. Try again.");
      expect(await current!.controller.load()).toBe(true);
      expect(liveReads).toHaveLength(2);
    } finally {
      root.unmount();
      container.remove();
      testEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });

  it("keeps its controller/Undo across dates but replaces and clears it for a new account scope", async () => {
    const service = new FakeTodoService([todo(A), todo(B)]);
    const { result, rerender, unmount } = renderHook(
      ({ date, scope }) => useTodayListController(service, date, scope),
      { initialProps: { date: DATE, scope: "account/session-one" } },
    );
    await waitFor(() => expect(result.current.state.loadStatus).toBe("ready"));
    const oldController = result.current.controller;
    await act(async () => { expect(await oldController.deleteTodo(A)).toBe(true); });
    rerender({ date: "2026-09-03", scope: "account/session-one" });
    expect(result.current.controller).toBe(oldController);
    expect(result.current.state.model.localDate).toBe("2026-09-03");
    expect(result.current.state.undoNotice?.todoId).toBe(A);
    await waitFor(() => expect(result.current.state.loadStatus).toBe("ready"));
    rerender({ date: "2026-09-03", scope: "account/session-two" });
    expect(result.current.controller).not.toBe(oldController);
    expect(result.current.state.undoNotice).toBeNull();
    expect(ids(oldController)).toEqual([]);
    expect(await oldController.load()).toBe(false);
    await waitFor(() => expect(result.current.state.loadStatus).toBe("ready"));
    expect(service.loadToday.mock.calls.every((call) => call.length === 2)).toBe(true);
    unmount();
  });

  it("restarts safely under StrictMode effect replay", async () => {
    const service = new FakeTodoService([todo(A)]);
    const wrapper = ({ children }: PropsWithChildren) => createElement(StrictMode, null, children);
    const { result } = renderHook(() => useTodayListController(service, DATE, "scope"), { wrapper });
    await waitFor(() => expect(result.current.state.loadStatus).toBe("ready"));
    expect(ids(result.current.controller)).toEqual([A]);
    await act(async () => { expect(await result.current.controller.completeTodo(A)).toBe(true); });
  });
});
