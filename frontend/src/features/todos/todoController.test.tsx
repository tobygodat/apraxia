// @vitest-environment happy-dom

import { StrictMode } from "react";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeleteUndoToken, Profile, TodayTodo, Todo } from "../../types/domain";
import { asSqlDate } from "./dateDomain";
import type { TodoService } from "./todoService";
import { TodoController, TodoMutationError, useTodoController } from "./todoController";
import { cacheNavigationService, NavigationCache } from "../../apps/navigationCache";

const PROFILE: Profile = {
  userId: "11111111-1111-4111-8111-111111111111",
  timezone: "America/New_York",
  createdAt: "2026-09-01T12:00:00Z",
  updatedAt: "2026-09-01T12:00:00Z",
};
const PROJECT = { id: "44444444-4444-4444-8444-444444444444", title: "Launch" };
const TODAY = "2026-09-03";
const OVERDUE: Todo = {
  id: "22222222-2222-4222-8222-222222222222",
  text: "Send the brief",
  completed: false,
  completedAt: null,
  dueDate: "2026-09-02",
  dueTime: "14:30:00.123456",
  projectId: PROJECT.id,
  todayRank: 2048,
  createdAt: "2026-09-01T14:00:00.000000Z",
  updatedAt: "2026-09-01T14:00:00.000000Z",
};
const DUE_TODAY: Todo = {
  ...OVERDUE,
  id: "33333333-3333-4333-8333-333333333333",
  text: "Review notes",
  dueDate: TODAY,
  todayRank: null,
  projectId: null,
};
const INBOX: Todo = {
  ...OVERDUE,
  id: "55555555-5555-4555-8555-555555555555",
  text: "Inbox note",
  dueDate: null,
  dueTime: null,
  todayRank: null,
  projectId: null,
};
const TOKEN = "2026-09-03T19:00:00.123456Z" as DeleteUndoToken;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

function fixture(
  initial: Todo[] = [OVERDUE, DUE_TODAY, INBOX],
  overrides: Partial<TodoService> = {},
) {
  let rows = initial;
  let deleted: Todo | null = null;
  const update = (id: string, values: Partial<Todo>) => {
    const saved = { ...rows.find((row) => row.id === id)!, ...values };
    rows = rows.map((row) => (row.id === id ? saved : row));
    return saved;
  };
  const service: TodoService = {
    loadWorkspace: vi.fn(async () => ({
      profile: PROFILE,
      classes: [],
      projects: [PROJECT],
      todos: rows,
    })),
    loadToday: vi.fn(async (date) =>
      rows.flatMap((row): TodayTodo[] =>
        !row.completed && row.dueDate !== null && row.dueDate <= date
          ? [
              {
                ...row,
                completed: false,
                completedAt: null,
                dueDate: row.dueDate,
                isOverdue: row.dueDate < date,
                isManuallyOrdered: row.todayRank !== null,
                projectTitle: row.projectId === PROJECT.id ? PROJECT.title : null,
              },
            ]
          : [],
      ),
    ),
    createTodo: vi.fn(async () => {
      throw new Error("unused");
    }),
    updateTodoDetails: vi.fn(async (id, input) => update(id, input)),
    setTodoCompleted: vi.fn(async (id, completed) =>
      update(id, { completed, completedAt: completed ? "2026-09-03T19:00:00Z" : null }),
    ),
    softDeleteTodo: vi.fn(async (id) => {
      deleted = rows.find((row) => row.id === id)!;
      rows = rows.filter((row) => row.id !== id);
      return TOKEN;
    }),
    restoreTodo: vi.fn(async () => {
      if (!deleted) return false;
      rows = [...rows, deleted];
      deleted = null;
      return true;
    }),
    reorderToday: vi.fn(async (_date, ids: readonly string[]) =>
      ids.map((id, index) => {
        update(id, { todayRank: (index + 1) * 1024 });
        return { todoId: id, todayRank: (index + 1) * 1024 };
      }),
    ),
    ...overrides,
  };
  return { service, rows: () => rows };
}

async function ready(kind: "workspace" | "today" | "both" = "both") {
  const { service } = fixture();
  const controller = new TodoController(service);
  if (kind !== "today") await controller.loadWorkspace();
  if (kind !== "workspace") await controller.setLocalDate(TODAY);
  return { controller, service };
}

const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("TodoController loads", () => {
  it("loads the workspace and ranked Today slices independently", async () => {
    const { controller, service } = await ready();
    const state = controller.getSnapshot();
    expect(state.workspaceStatus).toBe("ready");
    expect(state.todayStatus).toBe("ready");
    expect(state.profile).toEqual(PROFILE);
    expect(ids(state.todos)).toEqual(ids([OVERDUE, DUE_TODAY, INBOX]));
    // Ranked rows lead; unranked eligible rows follow in Postgres order.
    expect(ids(state.today.todos)).toEqual([OVERDUE.id, DUE_TODAY.id]);
    expect(state.today.todos[0]!.projectTitle).toBe(PROJECT.title);
    expect(state.today.todos.filter((row) => row.isOverdue)).toHaveLength(1);
    expect(service.loadToday).toHaveBeenCalledWith(TODAY, expect.anything());
  });

  it("seeds ready workspace and Today state from a warmed navigation cache with no loading status", async () => {
    const { service: source } = fixture();
    const cache = new NavigationCache();
    const service = cacheNavigationService(
      source,
      cache,
      "todos",
      ["loadWorkspace", "loadToday"],
      [],
    ) as unknown as TodoService;
    // Warm the cache the way an earlier visit or a prefetch would.
    await service.loadWorkspace({ signal: new AbortController().signal });
    await service.loadToday(TODAY, { signal: new AbortController().signal });
    const loadWorkspaceCalls = vi.mocked(source.loadWorkspace).mock.calls.length;
    const loadTodayCalls = vi.mocked(source.loadToday).mock.calls.length;

    const controller = new TodoController(service, { workspace: true, today: true });
    // Seeded synchronously at construction, before any load runs.
    expect(controller.getSnapshot().workspaceStatus).toBe("ready");
    expect(ids(controller.getSnapshot().todos)).toEqual(ids([OVERDUE, DUE_TODAY, INBOX]));

    const setLocalDate = controller.setLocalDate(TODAY);
    // Seeded synchronously inside setLocalDate, before its own loadToday resolves.
    expect(controller.getSnapshot().todayStatus).toBe("ready");
    expect(ids(controller.getSnapshot().today.todos)).toEqual([OVERDUE.id, DUE_TODAY.id]);
    expect(await setLocalDate).toBe(true);
    expect(controller.getSnapshot().todayStatus).toBe("ready");

    // The underlying reads still ran in the background but stayed cache-fresh.
    expect(source.loadWorkspace).toHaveBeenCalledTimes(loadWorkspaceCalls);
    expect(source.loadToday).toHaveBeenCalledTimes(loadTodayCalls);
  });

  it("re-seeds ready state from the navigation cache after a StrictMode stop/start cycle", async () => {
    const { service: source } = fixture();
    const cache = new NavigationCache();
    const service = cacheNavigationService(
      source,
      cache,
      "todos",
      ["loadWorkspace", "loadToday"],
      [],
    ) as unknown as TodoService;
    await service.loadWorkspace({ signal: new AbortController().signal });
    await service.loadToday(TODAY, { signal: new AbortController().signal });

    const controller = new TodoController(service, { workspace: true, today: true });
    await controller.setLocalDate(TODAY);
    expect(controller.getSnapshot().workspaceStatus).toBe("ready");
    expect(controller.getSnapshot().todayStatus).toBe("ready");

    // StrictMode's mount/unmount/mount replays stop() then start() on the same
    // instance before any effect re-runs loadWorkspace/setLocalDate.
    controller.stop();
    expect(controller.getSnapshot().workspaceStatus).toBe("idle");
    expect(controller.getSnapshot().profile).toBeNull();

    controller.start();
    expect(controller.getSnapshot().workspaceStatus).toBe("ready");
    expect(controller.getSnapshot().todayStatus).toBe("ready");
    expect(controller.getSnapshot().profile).toEqual(PROFILE);
    expect(ids(controller.getSnapshot().todos)).toEqual(ids([OVERDUE, DUE_TODAY, INBOX]));
    expect(ids(controller.getSnapshot().today.todos)).toEqual([OVERDUE.id, DUE_TODAY.id]);
  });

  it("keeps workspaceLoaded/todayLoaded true through a background refresh after the first snapshot", async () => {
    const { controller, service } = await ready();
    expect(controller.getSnapshot().workspaceLoaded).toBe(true);
    expect(controller.getSnapshot().todayLoaded).toBe(true);

    const workspaceReload = controller.loadWorkspace();
    // The refresh flips status back to loading, but the row must stay hidden:
    // loaded never resets once a snapshot has been applied.
    expect(controller.getSnapshot().workspaceStatus).toBe("loading");
    expect(controller.getSnapshot().workspaceLoaded).toBe(true);
    await workspaceReload;
    expect(controller.getSnapshot().workspaceLoaded).toBe(true);

    const todayReload = controller.loadToday();
    expect(controller.getSnapshot().todayStatus).toBe("loading");
    expect(controller.getSnapshot().todayLoaded).toBe(true);
    await todayReload;
    expect(controller.getSnapshot().todayLoaded).toBe(true);
    expect(service.loadWorkspace).toHaveBeenCalled();
  });

  it("starts with workspaceLoaded/todayLoaded false on a cold load and resets them on stop()", async () => {
    const { service } = fixture();
    const controller = new TodoController(service);
    expect(controller.getSnapshot().workspaceLoaded).toBe(false);
    expect(controller.getSnapshot().todayLoaded).toBe(false);
    const load = controller.loadWorkspace();
    expect(controller.getSnapshot().workspaceStatus).toBe("loading");
    expect(controller.getSnapshot().workspaceLoaded).toBe(false);
    await load;
    expect(controller.getSnapshot().workspaceLoaded).toBe(true);
    controller.stop();
    expect(controller.getSnapshot().workspaceLoaded).toBe(false);
    expect(controller.getSnapshot().todayLoaded).toBe(false);
  });

  it("fails closed on malformed provider rows without exposing provider text", async () => {
    const { service } = fixture([{ ...OVERDUE, id: "not-a-uuid" }]);
    const controller = new TodoController(service);
    expect(await controller.loadWorkspace()).toBe(false);
    expect(controller.getSnapshot().workspaceStatus).toBe("error");
    expect(controller.getSnapshot().todos).toEqual([]);
    vi.mocked(service.loadToday).mockResolvedValueOnce([
      { ...OVERDUE, isOverdue: false, isManuallyOrdered: true, projectTitle: null } as TodayTodo,
    ]);
    expect(await controller.setLocalDate(TODAY)).toBe(false);
    expect(controller.getSnapshot().todayStatus).toBe("error");
  });

  it("ignores a replaced read even when the adapter ignores cancellation", async () => {
    const stale = deferred<TodayTodo[]>();
    const { service } = fixture([], { loadToday: vi.fn(() => stale.promise) });
    const controller = new TodoController(service);
    const first = controller.setLocalDate(TODAY);
    vi.mocked(service.loadToday).mockResolvedValueOnce([]);
    const second = controller.loadToday();
    stale.resolve([
      { ...OVERDUE, isOverdue: true, isManuallyOrdered: true, projectTitle: null } as TodayTodo,
    ]);
    expect(await Promise.all([first, second])).toEqual([false, true]);
    expect(controller.getSnapshot().today.todos).toEqual([]);
  });

  it("re-reads when local midnight passes during a Today read and rebases known rows", async () => {
    const { controller, service } = await ready();
    vi.mocked(service.loadToday).mockClear();
    await controller.setLocalDate("2026-09-04");
    expect(controller.getSnapshot().today.todos.every((row) => row.isOverdue)).toBe(true);
    expect(service.loadToday).toHaveBeenCalledWith("2026-09-04", expect.anything());
    expect(controller.getSnapshot().today.localDate).toBe("2026-09-04");
  });
});

describe("TodoController completion and details", () => {
  it("completes optimistically in both slices, then confirms the exact saved row", async () => {
    const { controller, service } = await ready();
    const pending = deferred<Todo>();
    vi.mocked(service.setTodoCompleted).mockReturnValueOnce(pending.promise);
    expect(controller.setCompleted(DUE_TODAY.id, true)).toBe(true);
    expect(controller.setCompleted(DUE_TODAY.id, true)).toBe(false);
    let state = controller.getSnapshot();
    expect(state.pendingTodoIds.has(DUE_TODAY.id)).toBe(true);
    expect(state.todos.find((row) => row.id === DUE_TODAY.id)?.completed).toBe(true);
    expect(ids(state.today.todos)).toEqual([OVERDUE.id]);
    pending.resolve({ ...DUE_TODAY, completed: true, completedAt: "2026-09-03T19:00:00Z" });
    await flush();
    state = controller.getSnapshot();
    expect(state.pending).toEqual([]);
    expect(state.mutationResult).toEqual({
      sequence: 1,
      todoId: DUE_TODAY.id,
      action: "complete",
      status: "succeeded",
    });
    expect(state.announcement.message).toBe("Review notes completed.");
    // Completing never rolls an overdue date forward.
    expect(state.todos.find((row) => row.id === DUE_TODAY.id)?.dueDate).toBe(TODAY);
  });

  it("rolls completion back after failure or a malformed response and reports one copy kind", async () => {
    const { controller, service } = await ready();
    vi.mocked(service.setTodoCompleted).mockResolvedValueOnce({
      ...OVERDUE,
      completed: true,
      completedAt: "bad",
    });
    controller.setCompleted(OVERDUE.id, true);
    await flush();
    let state = controller.getSnapshot();
    expect(state.mutationError).toBe("completion_failed");
    expect(state.mutationResult?.status).toBe("failed");
    expect(state.todos.find((row) => row.id === OVERDUE.id)?.completed).toBe(false);
    expect(ids(state.today.todos)).toEqual([OVERDUE.id, DUE_TODAY.id]);
    vi.mocked(service.setTodoCompleted).mockRejectedValueOnce(new DOMException("x", "AbortError"));
    controller.setCompleted(OVERDUE.id, true);
    await flush();
    state = controller.getSnapshot();
    expect(state.mutationResult?.status).toBe("cancelled");
    expect(state.mutationError).toBe("cancelled");
  });

  it("updates details optimistically, preserving fractional time and date-only values", async () => {
    const { controller, service } = await ready();
    const saved = await controller.updateDetails(OVERDUE.id, {
      text: "Renamed",
      dueDate: "2026-09-02",
      dueTime: "14:30:00.1",
    });
    expect(saved.text).toBe("Renamed");
    expect(service.updateTodoDetails).toHaveBeenCalledWith(
      OVERDUE.id,
      { text: "Renamed", dueDate: "2026-09-02", dueTime: "14:30:00.1" },
      expect.anything(),
    );
    expect(controller.getSnapshot().today.todos[0]?.text).toBe("Renamed");
    expect(controller.getSnapshot().announcement.message).toBe("Renamed updated.");
    // A different saved microsecond is a mismatch, not an equivalent time.
    vi.mocked(service.updateTodoDetails).mockResolvedValueOnce({
      ...OVERDUE,
      dueTime: "14:30:00.100001",
    });
    await expect(
      controller.updateDetails(OVERDUE.id, { dueDate: "2026-09-02", dueTime: "14:30:00.1" }),
    ).rejects.toBeInstanceOf(TodoMutationError);
    expect(controller.getSnapshot().mutationError).toBe("update_failed");
    expect(controller.getSnapshot().todos.find((row) => row.id === OVERDUE.id)?.dueTime).toBe(
      "14:30:00.1",
    );
  });

  it("updates class context in Today, checks the saved parent, and rolls back a wrong response", async () => {
    const { controller, service } = await ready();
    const input = {
      text: "Worksheet",
      projectId: null,
      classId: "math",
      assignmentType: "Quiz",
      dueDate: TODAY,
      dueTime: null,
    };
    await controller.updateDetails(OVERDUE.id, input);
    expect(controller.getSnapshot().today.todos.find((row) => row.id === OVERDUE.id)).toMatchObject(
      input,
    );
    vi.mocked(service.updateTodoDetails).mockResolvedValueOnce({ ...OVERDUE, ...input });
    await expect(
      controller.updateDetails(OVERDUE.id, { ...input, classId: "art" }),
    ).rejects.toBeInstanceOf(TodoMutationError);
    expect(controller.getSnapshot().today.todos.find((row) => row.id === OVERDUE.id)?.classId).toBe(
      "math",
    );
  });

  it("moves a rescheduled or cleared task out of Today and into Inbox atomically", async () => {
    const { controller } = await ready();
    await controller.rescheduleTodo(DUE_TODAY.id, "2026-09-10");
    expect(ids(controller.getSnapshot().today.todos)).toEqual([OVERDUE.id]);
    expect(controller.getSnapshot().announcement.message).toBe("Review notes moved out of Today.");
    await controller.updateDetails(OVERDUE.id, { dueDate: null, dueTime: null });
    const state = controller.getSnapshot();
    expect(state.today.todos).toEqual([]);
    expect(state.todos.find((row) => row.id === OVERDUE.id)).toMatchObject({
      dueDate: null,
      dueTime: null,
    });
  });

  it("rejects an already-aborted edit before calling the provider and settles an external abort", async () => {
    const { controller, service } = await ready();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      controller.updateDetails(OVERDUE.id, { text: "x" }, { signal: aborted.signal }),
    ).rejects.toMatchObject({ kind: "not_started" });
    expect(service.updateTodoDetails).not.toHaveBeenCalled();
    const never = deferred<Todo>();
    vi.mocked(service.updateTodoDetails).mockReturnValueOnce(never.promise);
    const owner = new AbortController();
    const request = controller.updateDetails(OVERDUE.id, { text: "x" }, { signal: owner.signal });
    owner.abort();
    await expect(request).rejects.toMatchObject({ kind: "cancelled" });
    expect(controller.getSnapshot().pending).toEqual([]);
    expect(controller.getSnapshot().mutationError).toBeNull();
    expect(controller.getSnapshot().todos.find((row) => row.id === OVERDUE.id)?.text).toBe(
      OVERDUE.text,
    );
  });
});

describe("TodoController delete and Undo", () => {
  it("removes optimistically, keeps the exact token private, and restores in place", async () => {
    const { controller, service } = await ready();
    expect(controller.deleteTodo(OVERDUE.id)).toBe(true);
    expect(ids(controller.getSnapshot().today.todos)).toEqual([DUE_TODAY.id]);
    await flush();
    let state = controller.getSnapshot();
    expect(state.undoNotice).toEqual({
      todoId: OVERDUE.id,
      todoText: OVERDUE.text,
      pending: false,
      error: null,
    });
    expect(JSON.stringify(state)).not.toContain(TOKEN);
    expect(state.announcement.message).toBe("Send the brief deleted. Undo is available.");
    // One visible Undo at a time: a second delete cannot start.
    expect(controller.deleteTodo(DUE_TODAY.id)).toBe(false);
    expect(controller.undoDelete()).toBe(true);
    expect(controller.undoDelete()).toBe(false);
    await flush();
    state = controller.getSnapshot();
    expect(service.restoreTodo).toHaveBeenCalledWith(OVERDUE.id, TOKEN, expect.anything());
    expect(state.undoNotice).toBeNull();
    expect(ids(state.todos)).toEqual(ids([OVERDUE, DUE_TODAY, INBOX]));
    expect(ids(state.today.todos)).toEqual([OVERDUE.id, DUE_TODAY.id]);
    expect(state.announcement.message).toBe("Send the brief restored.");
  });

  it("keeps an actionable notice when a restore is refused, interrupted, or fails", async () => {
    const { controller, service } = await ready();
    controller.deleteTodo(OVERDUE.id);
    await flush();
    vi.mocked(service.restoreTodo).mockResolvedValueOnce(false);
    controller.undoDelete();
    await flush();
    expect(controller.getSnapshot().undoNotice?.error).toBe(
      "Undo is no longer available for this task.",
    );
    vi.mocked(service.restoreTodo).mockRejectedValueOnce(new DOMException("x", "AbortError"));
    controller.undoDelete();
    await flush();
    expect(controller.getSnapshot().undoNotice?.error).toBe(
      "The restore was interrupted. Try Undo again.",
    );
    vi.mocked(service.restoreTodo).mockRejectedValueOnce(new Error("db"));
    controller.undoDelete();
    await flush();
    expect(controller.getSnapshot().undoNotice).toMatchObject({
      pending: false,
      error: "The task could not be restored. Try Undo again.",
    });
    controller.dismissUndo();
    expect(controller.getSnapshot().undoNotice).toBeNull();
    expect(controller.getSnapshot().announcement.message).toBe("Undo dismissed.");
    expect(controller.deleteTodo(DUE_TODAY.id)).toBe(true);
  });

  it("defers a delete clicked while the same row's completion is still in flight", async () => {
    const completion = deferred<Todo>();
    const { service } = fixture([OVERDUE, DUE_TODAY, INBOX], {
      setTodoCompleted: vi.fn(() => completion.promise),
    });
    const controller = new TodoController(service);
    await controller.loadWorkspace();
    expect(controller.setCompleted(OVERDUE.id, true)).toBe(true);
    expect(controller.deleteTodo(OVERDUE.id)).toBe(true);
    expect(service.softDeleteTodo).not.toHaveBeenCalled();
    completion.resolve({ ...OVERDUE, completed: true, completedAt: "2026-09-03T19:00:00Z" });
    await flush();
    await flush();
    expect(service.softDeleteTodo).toHaveBeenCalledWith(OVERDUE.id, expect.anything());
    const state = controller.getSnapshot();
    expect(ids(state.todos)).toEqual([DUE_TODAY.id, INBOX.id]);
    expect(state.undoNotice).toMatchObject({ todoId: OVERDUE.id, pending: false, error: null });
  });

  it("restores the row and reports delete failures without a token", async () => {
    const { controller, service } = await ready();
    vi.mocked(service.softDeleteTodo).mockRejectedValueOnce(new Error("db"));
    controller.deleteTodo(OVERDUE.id);
    await flush();
    const state = controller.getSnapshot();
    expect(state.mutationError).toBe("delete_failed");
    expect(state.mutationResult).toMatchObject({ action: "delete", status: "failed" });
    expect(state.undoNotice).toBeNull();
    expect(ids(state.today.todos)).toEqual([OVERDUE.id, DUE_TODAY.id]);
  });

  it("queues reloads and midnight behind a delete instead of discarding its Undo token", async () => {
    const { controller, service } = await ready();
    const pending = deferred<DeleteUndoToken>();
    vi.mocked(service.softDeleteTodo).mockReturnValueOnce(pending.promise);
    controller.deleteTodo(OVERDUE.id);
    vi.mocked(service.loadToday).mockClear();
    void controller.refresh();
    void controller.setLocalDate("2026-09-04");
    expect(service.loadToday).not.toHaveBeenCalled();
    pending.resolve(TOKEN);
    await flush();
    expect(controller.getSnapshot().undoNotice?.todoId).toBe(OVERDUE.id);
    await waitFor(() =>
      expect(service.loadToday).toHaveBeenCalledWith("2026-09-04", expect.anything()),
    );
    controller.undoDelete();
    await flush();
    expect(
      controller.getSnapshot().today.todos.find((row) => row.id === OVERDUE.id)?.isOverdue,
    ).toBe(true);
  });
});

describe("TodoController Today order", () => {
  it("sends the full eligible ID order, applies persisted ranks to both slices, and rolls back on failure", async () => {
    const { controller, service } = await ready();
    expect(await controller.moveTodo(DUE_TODAY.id, "up")).toBe(true);
    expect(service.reorderToday).toHaveBeenCalledWith(
      TODAY,
      [DUE_TODAY.id, OVERDUE.id],
      expect.anything(),
    );
    let state = controller.getSnapshot();
    expect(ids(state.today.todos)).toEqual([DUE_TODAY.id, OVERDUE.id]);
    expect(state.todos.find((row) => row.id === DUE_TODAY.id)?.todayRank).toBe(1024);
    expect(state.announcement.message).toBe("Review notes moved up. Order saved.");
    expect(await controller.moveTodo(DUE_TODAY.id, "up")).toBe(false);
    vi.mocked(service.reorderToday).mockRejectedValueOnce(new Error("db"));
    expect(await controller.placeTodo(OVERDUE.id, DUE_TODAY.id, "before")).toBe(false);
    state = controller.getSnapshot();
    expect(ids(state.today.todos)).toEqual([DUE_TODAY.id, OVERDUE.id]);
    expect(state.mutationError).toBe("reorder_failed");
  });

  it("rejects a partial reorder receipt so the UI cannot claim an unsaved order", async () => {
    const { controller, service } = await ready();
    vi.mocked(service.reorderToday).mockResolvedValueOnce([
      { todoId: DUE_TODAY.id, todayRank: 1024 },
    ]);
    expect(await controller.placeTodo(DUE_TODAY.id, OVERDUE.id, "before")).toBe(false);
    expect(ids(controller.getSnapshot().today.todos)).toEqual([OVERDUE.id, DUE_TODAY.id]);
  });
});

describe("TodoController shared create and lifecycle", () => {
  it("accepts persisted creates into both slices and keeps them ahead of older reads", async () => {
    const staleToday = deferred<TodayTodo[]>();
    const staleWorkspace = deferred<Awaited<ReturnType<TodoService["loadWorkspace"]>>>();
    const { service } = fixture([OVERDUE], {
      loadToday: vi.fn(() => staleToday.promise),
      loadWorkspace: vi.fn(() => staleWorkspace.promise),
    });
    const controller = new TodoController(service);
    const reads = Promise.all([controller.setLocalDate(TODAY), controller.loadWorkspace()]);
    expect(controller.acceptCreatedTodo(DUE_TODAY)).toBe(true);
    expect(controller.acceptCreatedTodo({ ...DUE_TODAY, id: "bad" })).toBe(false);
    staleToday.resolve([
      {
        ...OVERDUE,
        isOverdue: true,
        isManuallyOrdered: true,
        projectTitle: PROJECT.title,
      } as TodayTodo,
    ]);
    staleWorkspace.resolve({
      profile: PROFILE,
      classes: [],
      projects: [PROJECT],
      todos: [OVERDUE],
    });
    await reads;
    expect(ids(controller.getSnapshot().today.todos)).toEqual([OVERDUE.id, DUE_TODAY.id]);
    expect(ids(controller.getSnapshot().todos)).toEqual([OVERDUE.id, DUE_TODAY.id]);
  });

  it("clears account data and rejects retained callbacks after stop", async () => {
    const { controller, service } = await ready();
    controller.deleteTodo(OVERDUE.id);
    await flush();
    controller.stop();
    const state = controller.getSnapshot();
    expect(state).toMatchObject({
      workspaceStatus: "idle",
      todayStatus: "idle",
      profile: null,
      todos: [],
      undoNotice: null,
    });
    expect(state.today.todos).toEqual([]);
    expect(controller.undoDelete()).toBe(false);
    expect(controller.setCompleted(DUE_TODAY.id, true)).toBe(false);
    expect(await controller.loadWorkspace()).toBe(false);
    expect(service.setTodoCompleted).not.toHaveBeenCalled();
  });
});

describe("useTodoController", () => {
  afterEach(() => cleanup());

  it("starts safely under StrictMode replay and keeps its controller across dates but not accounts", async () => {
    const { service } = fixture();
    const { result, rerender } = renderHook(
      ({ key, date }: { key: string; date: string }) =>
        useTodoController(service, key, { localDate: asSqlDate(date), workspace: true }),
      { initialProps: { key: "account-a", date: TODAY }, wrapper: StrictMode },
    );
    await waitFor(() => expect(result.current.state.todayStatus).toBe("ready"));
    expect(result.current.state.workspaceStatus).toBe("ready");
    const first = result.current.controller;
    act(() => {
      first.deleteTodo(OVERDUE.id);
    });
    await waitFor(() => expect(result.current.state.undoNotice).not.toBeNull());
    rerender({ key: "account-a", date: "2026-09-04" });
    expect(result.current.controller).toBe(first);
    // The prop changed before the reload: the visible model never shows yesterday's eligibility.
    expect(result.current.state.today.localDate).toBe("2026-09-04");
    await waitFor(() => expect(result.current.state.todayStatus).toBe("ready"));
    expect(result.current.state.undoNotice?.todoId).toBe(OVERDUE.id);
    rerender({ key: "account-b", date: "2026-09-04" });
    expect(result.current.controller).not.toBe(first);
    expect(result.current.state.undoNotice).toBeNull();
    expect(first.undoDelete()).toBe(false);
  });

  it("reloads loaded slices when the workspace revision changes", async () => {
    const { service } = fixture();
    const { result } = renderHook(() =>
      useTodoController(service, "account-a", { localDate: asSqlDate(TODAY) }),
    );
    await waitFor(() => expect(result.current.state.todayStatus).toBe("ready"));
    vi.mocked(service.loadToday).mockClear();
    await act(async () => {
      await result.current.controller.refresh();
    });
    expect(service.loadToday).toHaveBeenCalledTimes(1);
    expect(service.loadWorkspace).not.toHaveBeenCalled();
    render(<div />);
  });

  it("never seeds or loads the workspace slice for a Today-only controller, and refresh() skips it", async () => {
    const { service } = fixture();
    const { result } = renderHook(() =>
      useTodoController(service, "account-a", { localDate: asSqlDate(TODAY) }),
    );
    await waitFor(() => expect(result.current.state.todayStatus).toBe("ready"));
    expect(result.current.state.workspaceStatus).toBe("idle");
    expect(service.loadWorkspace).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.controller.refresh();
    });
    expect(service.loadWorkspace).not.toHaveBeenCalled();
    expect(result.current.state.workspaceStatus).toBe("idle");
  });

  it("keeps a warm Today cache seeded-only through StrictMode stop/start and issues one live load after replay", async () => {
    const { service: source } = fixture();
    const cache = new NavigationCache();
    const service = cacheNavigationService(
      source,
      cache,
      "todos",
      ["loadWorkspace", "loadToday"],
      [],
    ) as unknown as TodoService;
    await service.loadToday(TODAY, { signal: new AbortController().signal });

    const controller = new TodoController(service, { workspace: false, today: true });
    await controller.setLocalDate(TODAY);
    vi.mocked(source.loadToday).mockClear();

    // StrictMode replays stop() then start() on the same instance.
    controller.stop();
    // The cache entry may have been invalidated by another tab/write while stopped.
    cache.invalidate();
    controller.start();
    expect(controller.getSnapshot().todayStatus).toBe("ready");

    // The re-running setLocalDate effect requests the same date: because the
    // re-seeded slice is cache-seeded-only (never confirmed by a live load
    // since the stop/start), this must still issue exactly one live read.
    await controller.setLocalDate(TODAY);
    expect(source.loadToday).toHaveBeenCalledTimes(1);
  });
});
