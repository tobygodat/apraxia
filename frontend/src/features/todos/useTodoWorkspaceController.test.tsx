// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type {
  DeleteUndoToken,
  Profile,
  Todo,
} from "../../types/domain";
import type {
  TodoService,
  TodoWorkspaceSnapshot,
} from "./todoService";
import type { TodosBoardProps } from "./TodosBoard";
import {
  TodoMutationFailedError,
  TodoMutationNotStartedError,
  type TodoWorkspaceController,
  useTodoWorkspaceController,
} from "./useTodoWorkspaceController";

const PROFILE: Profile = {
  userId: "11111111-1111-4111-8111-111111111111",
  timezone: "America/New_York",
  createdAt: "2026-09-01T12:00:00.000000Z",
  updatedAt: "2026-09-01T12:00:00.000000Z",
};

const TODO: Todo = {
  id: "22222222-2222-4222-8222-222222222222",
  text: "Prepare review",
  completed: false,
  completedAt: null,
  dueDate: "2026-09-02",
  dueTime: null,
  projectId: null,
  todayRank: null,
  createdAt: "2026-09-01T14:00:00.000000Z",
  updatedAt: "2026-09-01T14:00:00.000000Z",
};

const SECOND_TODO: Todo = {
  ...TODO,
  id: "33333333-3333-4333-8333-333333333333",
  text: "Confirm venue",
};

const SNAPSHOT: TodoWorkspaceSnapshot = {
  profile: PROFILE,
  projects: [],
  todos: [TODO],
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function createService(overrides: Partial<TodoService> = {}): TodoService {
  return {
    loadWorkspace: vi.fn(async () => SNAPSHOT),
    createTodo: vi.fn(async () => TODO),
    updateTodoDetails: vi.fn(async () => TODO),
    setTodoCompleted: vi.fn(async () => TODO),
    softDeleteTodo: vi.fn(async () =>
      "2026-09-02T13:00:00.000000Z" as DeleteUndoToken,
    ),
    restoreTodo: vi.fn(async () => true),
    loadToday: vi.fn(async () => []),
    reorderToday: vi.fn(async () => []),
    ...overrides,
  };
}

async function renderReady(service: TodoService) {
  const hook = renderHook(() =>
    useTodoWorkspaceController(service, PROFILE.userId),
  );
  await waitFor(() => expect(hook.result.current.loadState.status).toBe("idle"));
  return hook;
}

afterEach(() => cleanup());

describe("useTodoWorkspaceController", () => {
  it("exposes a load state that binds directly to TodosBoard", () => {
    expectTypeOf<TodoWorkspaceController["loadState"]>().toMatchTypeOf<
      NonNullable<TodosBoardProps["loadState"]>
    >();
  });

  it("clears user-scoped rows while a replacement service loads", async () => {
    const firstService = createService();
    const secondLoad = deferred<TodoWorkspaceSnapshot>();
    const secondService = createService({
      loadWorkspace: vi.fn(() => secondLoad.promise),
    });
    const hook = renderHook(
      ({ service }) => useTodoWorkspaceController(service, PROFILE.userId),
      { initialProps: { service: firstService } },
    );

    await waitFor(() => expect(hook.result.current.todos).toEqual([TODO]));
    hook.rerender({ service: secondService });

    expect(hook.result.current.loadState.status).toBe("loading");
    expect(hook.result.current.profile).toBeNull();
    expect(hook.result.current.todos).toEqual([]);

    await act(async () => secondLoad.resolve({ ...SNAPSHOT, todos: [] }));
    await waitFor(() => expect(hook.result.current.loadState.status).toBe("idle"));
    expect(hook.result.current.todos).toEqual([]);
  });

  it("keeps completion settlement-driven and blocks duplicate row writes", async () => {
    const completion = deferred<Todo>();
    const setTodoCompleted = vi.fn(() => completion.promise);
    const service = createService({ setTodoCompleted });
    const hook = await renderReady(service);

    act(() => {
      expect(hook.result.current.setCompleted(TODO.id, true)).toBe(true);
      expect(hook.result.current.setCompleted(TODO.id, true)).toBe(false);
    });

    expect(hook.result.current.todos[0]?.completed).toBe(false);
    expect(hook.result.current.pendingTodoIds.has(TODO.id)).toBe(true);
    expect(setTodoCompleted).toHaveBeenCalledOnce();

    const savedTodo: Todo = {
      ...TODO,
      completed: true,
      completedAt: "2026-09-02T15:00:00.000000Z",
    };
    await act(async () => completion.resolve(savedTodo));

    await waitFor(() =>
      expect(hook.result.current.pendingTodoIds.has(TODO.id)).toBe(false),
    );
    expect(hook.result.current.todos).toEqual([savedTodo]);
    expect(hook.result.current.mutationResult).toMatchObject({
      sequence: 1,
      todoId: TODO.id,
      action: "complete",
      status: "succeeded",
    });
  });

  it("leaves the prior completion state visible when persistence fails", async () => {
    const service = createService({
      setTodoCompleted: vi.fn(async () => {
        throw new Error("database detail that must not escape");
      }),
    });
    const hook = await renderReady(service);

    act(() => {
      expect(hook.result.current.setCompleted(TODO.id, true)).toBe(true);
    });

    await waitFor(() =>
      expect(hook.result.current.mutationResult?.status).toBe("failed"),
    );
    expect(hook.result.current.todos).toEqual([TODO]);
    expect(hook.result.current.mutationError).toBe("completion_failed");
  });

  it("removes only a persisted soft delete and restores with its exact token", async () => {
    const deletion = deferred<DeleteUndoToken>();
    const restoration = deferred<boolean>();
    const softDeleteTodo = vi.fn(() => deletion.promise);
    const restoreTodo = vi.fn(() => restoration.promise);
    const service = createService({ softDeleteTodo, restoreTodo });
    const hook = await renderReady(service);

    act(() => {
      expect(hook.result.current.deleteTodo(TODO.id)).toBe(true);
    });
    expect(hook.result.current.todos).toEqual([TODO]);
    expect(hook.result.current.undoNotice).toBeNull();

    const token =
      "2026-09-02T13:00:00.123456Z" as DeleteUndoToken;
    await act(async () => deletion.resolve(token));
    await waitFor(() => expect(hook.result.current.todos).toEqual([]));
    expect(hook.result.current.undoNotice?.todoId).toBe(TODO.id);

    act(() => hook.result.current.undoNotice?.onUndo());
    expect(hook.result.current.undoNotice?.pending).toBe(true);
    expect(restoreTodo).toHaveBeenCalledWith(
      TODO.id,
      token,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => restoration.resolve(true));
    await waitFor(() => expect(hook.result.current.undoNotice).toBeNull());
    expect(hook.result.current.todos).toEqual([TODO]);
  });

  it("retains an actionable notice when the restore token is no longer valid", async () => {
    const service = createService({
      restoreTodo: vi.fn(async () => false),
    });
    const hook = await renderReady(service);

    act(() => {
      hook.result.current.deleteTodo(TODO.id);
    });
    await waitFor(() => expect(hook.result.current.undoNotice).not.toBeNull());
    act(() => hook.result.current.undoNotice?.onUndo());

    await waitFor(() =>
      expect(hook.result.current.undoNotice?.error).toContain(
        "no longer available",
      ),
    );
    expect(hook.result.current.todos).toEqual([]);
    expect(hook.result.current.undoNotice?.pending).toBe(false);
  });

  it("rejects edit failure safely while keeping the persisted row unchanged", async () => {
    const updateTodoDetails = vi.fn(async () => {
      throw new Error("sensitive provider response");
    });
    const hook = await renderReady(createService({ updateTodoDetails }));

    let caught: unknown;
    await act(async () => {
      try {
        await hook.result.current.updateDetails(TODO.id, {
          text: "Retained form value",
        });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(TodoMutationFailedError);
    expect(String(caught)).not.toContain("sensitive");
    expect(hook.result.current.todos).toEqual([TODO]);
    expect(hook.result.current.mutationError).toBe("update_failed");
    expect(hook.result.current.pendingTodoIds.has(TODO.id)).toBe(false);
  });

  it("aborts an old load and ignores its late result after retry", async () => {
    const firstLoad = deferred<TodoWorkspaceSnapshot>();
    const secondLoad = deferred<TodoWorkspaceSnapshot>();
    const signals: AbortSignal[] = [];
    const loadWorkspace = vi
      .fn()
      .mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
        signals.push(signal);
        return firstLoad.promise;
      })
      .mockImplementationOnce(({ signal }: { signal: AbortSignal }) => {
        signals.push(signal);
        return secondLoad.promise;
      });
    const service = createService({ loadWorkspace });
    const hook = renderHook(() =>
      useTodoWorkspaceController(service, PROFILE.userId),
    );

    act(() => hook.result.current.retryLoad());
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => firstLoad.resolve(SNAPSHOT));
    expect(hook.result.current.todos).toEqual([]);

    await act(async () => secondLoad.resolve({ ...SNAPSHOT, todos: [] }));
    await waitFor(() => expect(hook.result.current.loadState.status).toBe("idle"));
    expect(hook.result.current.todos).toEqual([]);
  });

  it("clears every private transient across a stable-service account change", async () => {
    const secondLoad = deferred<TodoWorkspaceSnapshot>();
    const edit = deferred<Todo>();
    const editSignals: AbortSignal[] = [];
    const completedTodo: Todo = {
      ...TODO,
      completed: true,
      completedAt: "2026-09-02T15:00:00.000000Z",
    };
    const service = createService({
      loadWorkspace: vi
        .fn()
        .mockResolvedValueOnce(SNAPSHOT)
        .mockImplementationOnce(() => secondLoad.promise),
      setTodoCompleted: vi.fn(async () => completedTodo),
      updateTodoDetails: vi.fn((_todoId, _input, { signal }) => {
        editSignals.push(signal);
        return edit.promise;
      }),
    });
    const hook = renderHook(
      ({ sessionKey }) =>
        useTodoWorkspaceController(service, sessionKey),
      { initialProps: { sessionKey: PROFILE.userId } },
    );
    await waitFor(() => expect(hook.result.current.loadState.status).toBe("idle"));

    act(() => hook.result.current.setCompleted(TODO.id, true));
    await waitFor(() =>
      expect(hook.result.current.mutationResult?.status).toBe("succeeded"),
    );
    const pendingEdit = hook.result.current
      .updateDetails(TODO.id, { text: "Account A draft" })
      .catch((error: unknown) => error);
    expect(editSignals[0]?.aborted).toBe(false);

    hook.rerender({ sessionKey: "44444444-4444-4444-8444-444444444444" });
    expect(editSignals[0]?.aborted).toBe(true);
    expect(hook.result.current.loadState.status).toBe("loading");
    expect(hook.result.current.profile).toBeNull();
    expect(hook.result.current.todos).toEqual([]);
    expect(hook.result.current.pendingTodoIds.size).toBe(0);
    expect(hook.result.current.mutationResult).toBeNull();
    expect(hook.result.current.undoNotice).toBeNull();

    await act(async () =>
      secondLoad.resolve({
        ...SNAPSHOT,
        profile: {
          ...PROFILE,
          userId: "44444444-4444-4444-8444-444444444444",
        },
        todos: [],
      }),
    );
    await waitFor(() => expect(hook.result.current.loadState.status).toBe("idle"));
    await act(async () => edit.resolve({ ...completedTodo, text: "Account A draft" }));
    await pendingEdit;
    expect(hook.result.current.todos).toEqual([]);
  });

  it("serializes delete through Undo or dismiss so tokens cannot cross", async () => {
    const firstDelete = deferred<DeleteUndoToken>();
    const secondDelete = deferred<DeleteUndoToken>();
    const softDeleteTodo = vi
      .fn()
      .mockImplementationOnce(() => firstDelete.promise)
      .mockImplementationOnce(() => secondDelete.promise);
    const hook = await renderReady(
      createService({
        loadWorkspace: vi.fn(async () => ({
          ...SNAPSHOT,
          todos: [TODO, SECOND_TODO],
        })),
        softDeleteTodo,
      }),
    );

    act(() => {
      expect(hook.result.current.deleteTodo(TODO.id)).toBe(true);
      expect(hook.result.current.deleteTodo(SECOND_TODO.id)).toBe(false);
    });
    await act(async () =>
      firstDelete.resolve(
        "2026-09-02T13:00:00.000001Z" as DeleteUndoToken,
      ),
    );
    await waitFor(() => expect(hook.result.current.undoNotice?.todoId).toBe(TODO.id));

    act(() => {
      expect(hook.result.current.deleteTodo(SECOND_TODO.id)).toBe(false);
      hook.result.current.undoNotice?.onDismiss();
      expect(hook.result.current.deleteTodo(SECOND_TODO.id)).toBe(true);
    });
    await act(async () =>
      secondDelete.resolve(
        "2026-09-02T13:00:00.000002Z" as DeleteUndoToken,
      ),
    );
    await waitFor(() =>
      expect(hook.result.current.undoNotice?.todoId).toBe(SECOND_TODO.id),
    );
    expect(softDeleteTodo).toHaveBeenCalledTimes(2);
  });

  it("returns an upstream restore cancellation to a retryable Undo state", async () => {
    const hook = await renderReady(
      createService({
        restoreTodo: vi.fn(async () => {
          throw new DOMException("Interrupted upstream", "AbortError");
        }),
      }),
    );
    act(() => hook.result.current.deleteTodo(TODO.id));
    await waitFor(() => expect(hook.result.current.undoNotice).not.toBeNull());

    act(() => hook.result.current.undoNotice?.onUndo());
    await waitFor(() =>
      expect(hook.result.current.undoNotice?.error).toContain("interrupted"),
    );
    expect(hook.result.current.undoNotice?.pending).toBe(false);
  });

  it("fails closed on mismatched provider rows", async () => {
    const service = createService({
      setTodoCompleted: vi.fn(async () => TODO),
      updateTodoDetails: vi.fn(async () => ({
        ...SECOND_TODO,
        text: "Changed",
      })),
    });
    const hook = await renderReady(service);

    act(() => hook.result.current.setCompleted(TODO.id, true));
    await waitFor(() =>
      expect(hook.result.current.mutationResult?.status).toBe("failed"),
    );
    expect(hook.result.current.todos).toEqual([TODO]);

    let editError: unknown;
    await act(async () => {
      try {
        await hook.result.current.updateDetails(TODO.id, { text: "Changed" });
      } catch (error) {
        editError = error;
      }
    });
    expect(editError).toBeInstanceOf(TodoMutationFailedError);
    expect(hook.result.current.todos).toEqual([TODO]);
  });

  it("contains synchronous adapter throws without stranding UI state", async () => {
    const failingLoadService = createService({
      loadWorkspace: vi.fn(() => {
        throw new Error("sync load failure");
      }),
    });
    const loadHook = renderHook(() =>
      useTodoWorkspaceController(
        failingLoadService,
        PROFILE.userId,
      ),
    );
    await waitFor(() =>
      expect(loadHook.result.current.loadState.status).toBe("error"),
    );

    const hook = await renderReady(
      createService({
        softDeleteTodo: vi.fn(() => {
          throw new Error("sync delete failure");
        }),
      }),
    );
    act(() => expect(hook.result.current.deleteTodo(TODO.id)).toBe(true));
    await waitFor(() =>
      expect(hook.result.current.mutationResult?.status).toBe("failed"),
    );
    expect(hook.result.current.pendingTodoIds.size).toBe(0);
    expect(hook.result.current.todos).toEqual([TODO]);
  });

  it.each([
    ["09:00", "09:00:00"],
    ["09:00:00", "09:00"],
    ["09:00:00.1", "09:00:00.100000"],
    ["09:00:00.000001", "09:00:00.000001"],
  ])("accepts a saved time normalized from %s to %s", async (inputTime, savedTime) => {
    const savedTodo = { ...TODO, dueTime: savedTime };
    const service = createService({
      updateTodoDetails: vi.fn(async () => savedTodo),
    });
    const hook = await renderReady(service);
    let result: Todo | undefined;
    await act(async () => {
      result = await hook.result.current.updateDetails(TODO.id, {
        dueDate: TODO.dueDate!,
        dueTime: inputTime,
      });
    });
    expect(result).toEqual(savedTodo);
    expect(hook.result.current.todos).toEqual([savedTodo]);
    expect(hook.result.current.mutationError).toBeNull();
  });

  it("does not mistake a different saved microsecond for an equivalent time", async () => {
    const hook = await renderReady(createService({
      updateTodoDetails: vi.fn(async () => ({ ...TODO, dueTime: "09:00:00.000002" })),
    }));
    await act(async () => {
      await expect(hook.result.current.updateDetails(TODO.id, {
        dueDate: TODO.dueDate!,
        dueTime: "09:00:00.000001",
      })).rejects.toBeInstanceOf(TodoMutationFailedError);
    });
    expect(hook.result.current.todos).toEqual([TODO]);
    expect(hook.result.current.mutationError).toBe("update_failed");
  });

  it("rejects retained callbacks after replacing the service under the same workspace key", async () => {
    const workspace = { ...SNAPSHOT, todos: [TODO, SECOND_TODO] };
    const firstService = createService({ loadWorkspace: vi.fn(async () => workspace) });
    const secondService = createService({ loadWorkspace: vi.fn(async () => workspace) });
    const hook = renderHook(
      ({ service }) => useTodoWorkspaceController(service, PROFILE.userId),
      { initialProps: { service: firstService } },
    );
    await waitFor(() => expect(hook.result.current.loadState.status).toBe("idle"));
    const retained = hook.result.current;
    act(() => hook.result.current.deleteTodo(TODO.id));
    await waitFor(() => expect(hook.result.current.undoNotice).not.toBeNull());
    const retainedUndo = hook.result.current.undoNotice!;

    hook.rerender({ service: secondService });
    await waitFor(() => expect(hook.result.current.loadState.status).toBe("idle"));
    await act(async () => {
      expect(retained.setCompleted(SECOND_TODO.id, true)).toBe(false);
      expect(retained.deleteTodo(SECOND_TODO.id)).toBe(false);
      await expect(retained.updateDetails(SECOND_TODO.id, { text: "Old provider write" }))
        .rejects.toBeInstanceOf(TodoMutationNotStartedError);
      retained.retryLoad();
    });
    expect(firstService.setTodoCompleted).not.toHaveBeenCalled();
    expect(firstService.updateTodoDetails).not.toHaveBeenCalled();
    expect(firstService.softDeleteTodo).toHaveBeenCalledTimes(1);
    expect(secondService.loadWorkspace).toHaveBeenCalledTimes(1);

    act(() => hook.result.current.deleteTodo(TODO.id));
    await waitFor(() => expect(hook.result.current.undoNotice).not.toBeNull());
    act(() => {
      retainedUndo.onUndo();
      retainedUndo.onDismiss();
    });
    expect(firstService.restoreTodo).not.toHaveBeenCalled();
    expect(secondService.restoreTodo).not.toHaveBeenCalled();
    expect(hook.result.current.undoNotice?.todoId).toBe(TODO.id);
    act(() => hook.result.current.undoNotice?.onUndo());
    await waitFor(() => expect(hook.result.current.undoNotice).toBeNull());
    expect(secondService.restoreTodo).toHaveBeenCalledOnce();
    expect(hook.result.current.todos).toEqual([TODO, SECOND_TODO]);
  });

  it("ignores an old service mutation settlement after replacement finishes loading", async () => {
    const completion = deferred<Todo>();
    let signal: AbortSignal | undefined;
    const firstService = createService({
      setTodoCompleted: vi.fn((_id, _completed, options) => {
        signal = options.signal;
        return completion.promise;
      }),
    });
    const secondService = createService();
    const hook = renderHook(
      ({ service }) => useTodoWorkspaceController(service, PROFILE.userId),
      { initialProps: { service: firstService } },
    );
    await waitFor(() => expect(hook.result.current.loadState.status).toBe("idle"));
    act(() => hook.result.current.setCompleted(TODO.id, true));
    hook.rerender({ service: secondService });
    await waitFor(() => expect(hook.result.current.loadState.status).toBe("idle"));
    expect(signal?.aborted).toBe(true);
    await act(async () => completion.resolve({
      ...TODO,
      completed: true,
      completedAt: "2026-09-02T13:00:00Z",
    }));
    expect(hook.result.current.todos).toEqual([TODO]);
    expect(hook.result.current.mutationResult).toBeNull();
  });

  it.each([null, undefined, "", "not-a-token", "2026-02-30T13:00:00Z", "2026-09-02T13:00:00.1234567Z"])(
    "retains the row when deletion returns malformed token %j",
    async (token) => {
      const hook = await renderReady(createService({
        softDeleteTodo: vi.fn(async () => token as DeleteUndoToken),
      }));
      act(() => hook.result.current.deleteTodo(TODO.id));
      await waitFor(() => expect(hook.result.current.mutationResult?.status).toBe("failed"));
      expect(hook.result.current.todos).toEqual([TODO]);
      expect(hook.result.current.undoNotice).toBeNull();
      expect(hook.result.current.pendingTodoIds.size).toBe(0);
      expect(hook.result.current.mutationError).toBe("delete_failed");
    },
  );

  it.each(["false", 1, null, undefined, {}, []])(
    "keeps Undo retryable when restoration returns non-boolean %j",
    async (response) => {
      const restoreTodo = vi.fn()
        .mockResolvedValueOnce(response)
        .mockResolvedValueOnce(true);
      const hook = await renderReady(createService({ restoreTodo }));
      act(() => hook.result.current.deleteTodo(TODO.id));
      await waitFor(() => expect(hook.result.current.undoNotice).not.toBeNull());
      act(() => hook.result.current.undoNotice?.onUndo());
      await waitFor(() => expect(hook.result.current.undoNotice?.pending).toBe(false));
      expect(hook.result.current.todos).toEqual([]);
      expect(hook.result.current.undoNotice?.error).toBe("The todo could not be restored. Try Undo again.");
      act(() => hook.result.current.undoNotice?.onUndo());
      await waitFor(() => expect(hook.result.current.undoNotice).toBeNull());
      expect(hook.result.current.todos).toEqual([TODO]);
    },
  );

  it.each([
    { ...SNAPSHOT, todos: [{ ...TODO, dueDate: "not-a-date" }] },
    { ...SNAPSHOT, profile: { ...PROFILE, timezone: "Not/A_Zone" } },
    { ...SNAPSHOT, todos: [{ ...TODO, todayRank: Infinity }] },
    { ...SNAPSHOT, projects: [{ id: "not-a-uuid", title: "Project" }] },
  ])("fails safely instead of publishing a malformed workspace %#", async (snapshot) => {
    const service = createService({ loadWorkspace: vi.fn(async () => snapshot) });
    const hook = renderHook(() => useTodoWorkspaceController(service, PROFILE.userId));
    await waitFor(() => expect(hook.result.current.loadState).toEqual({ status: "error", kind: "load_failed" }));
    expect(hook.result.current.profile).toBeNull();
    expect(hook.result.current.projects).toEqual([]);
    expect(hook.result.current.todos).toEqual([]);
    expect(hook.result.current.setCompleted(TODO.id, true)).toBe(false);
  });

  it("rejects malformed completion and details rows without publishing them", async () => {
    const service = createService({
      setTodoCompleted: vi.fn(async () => ({
        ...TODO,
        completed: true,
        completedAt: "2026-09-02T13:00:00Z",
        dueDate: "not-a-date",
      })),
      updateTodoDetails: vi.fn(async () => ({ ...TODO, text: "Changed", updatedAt: "invalid" })),
    });
    const hook = await renderReady(service);
    act(() => hook.result.current.setCompleted(TODO.id, true));
    await waitFor(() => expect(hook.result.current.mutationResult?.status).toBe("failed"));
    expect(hook.result.current.mutationError).toBe("completion_failed");
    await act(async () => {
      await expect(hook.result.current.updateDetails(TODO.id, { text: "Changed" }))
        .rejects.toBeInstanceOf(TodoMutationFailedError);
    });
    expect(hook.result.current.todos).toEqual([TODO]);
    expect(hook.result.current.mutationError).toBe("update_failed");
  });

  it("accepts a persisted create idempotently without erasing other rows or Undo", async () => {
    const hook = await renderReady(createService());
    act(() => {
      expect(hook.result.current.acceptCreatedTodo(SECOND_TODO)).toBe(true);
      expect(hook.result.current.acceptCreatedTodo(SECOND_TODO)).toBe(true);
    });
    expect(hook.result.current.todos).toEqual([TODO, SECOND_TODO]);
    act(() => hook.result.current.deleteTodo(TODO.id));
    await waitFor(() => expect(hook.result.current.undoNotice).not.toBeNull());
    const notice = hook.result.current.undoNotice;
    const updatedCreate = { ...SECOND_TODO, text: "Confirmed venue" };
    act(() => expect(hook.result.current.acceptCreatedTodo(updatedCreate)).toBe(true));
    expect(hook.result.current.todos).toEqual([updatedCreate]);
    expect(hook.result.current.undoNotice).toBe(notice);
  });

  it("rejects create reconciliation while loading, malformed, pending, or stale", async () => {
    const load = deferred<TodoWorkspaceSnapshot>();
    const completion = deferred<Todo>();
    const firstService = createService({
      loadWorkspace: vi.fn(() => load.promise),
      setTodoCompleted: vi.fn(() => completion.promise),
    });
    const secondService = createService();
    const hook = renderHook(
      ({ service }) => useTodoWorkspaceController(service, PROFILE.userId),
      { initialProps: { service: firstService } },
    );
    expect(hook.result.current.acceptCreatedTodo(SECOND_TODO)).toBe(false);
    await act(async () => load.resolve(SNAPSHOT));
    await waitFor(() => expect(hook.result.current.loadState.status).toBe("idle"));
    const retainedAccept = hook.result.current.acceptCreatedTodo;
    act(() => {
      expect(hook.result.current.acceptCreatedTodo({ ...SECOND_TODO, dueDate: "invalid" })).toBe(false);
      hook.result.current.setCompleted(TODO.id, true);
      expect(hook.result.current.acceptCreatedTodo({ ...TODO, text: "New copy" })).toBe(false);
    });
    hook.rerender({ service: secondService });
    await waitFor(() => expect(hook.result.current.loadState.status).toBe("idle"));
    expect(retainedAccept(SECOND_TODO)).toBe(false);
    expect(hook.result.current.todos).toEqual([TODO]);
  });

  it("rejects an already-aborted edit before calling the provider", async () => {
    const service = createService();
    const hook = await renderReady(service);
    const caller = new AbortController();
    caller.abort();
    await act(async () => {
      await expect(hook.result.current.updateDetails(TODO.id, { text: "Changed" }, {
        signal: caller.signal,
      })).rejects.toBeInstanceOf(TodoMutationNotStartedError);
    });
    expect(service.updateTodoDetails).not.toHaveBeenCalled();
    expect(hook.result.current.pendingTodoIds.size).toBe(0);
    expect(hook.result.current.mutationError).toBeNull();
  });

  it("forwards edit lifetime abort and settles even when the provider ignores it", async () => {
    const edit = deferred<Todo>();
    let providerSignal: AbortSignal | undefined;
    const service = createService({
      updateTodoDetails: vi.fn((_id, _input, options) => {
        providerSignal = options.signal;
        return edit.promise;
      }),
    });
    const hook = await renderReady(service);
    const caller = new AbortController();
    const addListener = vi.spyOn(caller.signal, "addEventListener");
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    let request!: Promise<Todo>;
    act(() => {
      request = hook.result.current.updateDetails(TODO.id, { text: "Changed" }, {
        signal: caller.signal,
      });
    });
    const rejected = expect(request).rejects.toBeInstanceOf(TodoMutationNotStartedError);
    await act(async () => {
      caller.abort();
      await rejected;
    });
    expect(providerSignal?.aborted).toBe(true);
    expect(hook.result.current.pendingTodoIds.size).toBe(0);
    expect(hook.result.current.mutationError).toBeNull();
    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0]?.[1]);
    await act(async () => edit.resolve({ ...TODO, text: "Changed" }));
    expect(hook.result.current.todos).toEqual([TODO]);
  });

  it.each(["success", "failure"])("cleans edit lifetime listeners after %s", async (outcome) => {
    let providerSignal: AbortSignal | undefined;
    const service = createService({
      updateTodoDetails: vi.fn((_id, _input, options) => {
        providerSignal = options.signal;
        if (outcome === "failure") throw new Error("provider failure");
        return Promise.resolve({ ...TODO, text: "Changed" });
      }),
    });
    const hook = await renderReady(service);
    const caller = new AbortController();
    const addListener = vi.spyOn(caller.signal, "addEventListener");
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    await act(async () => {
      await hook.result.current.updateDetails(TODO.id, { text: "Changed" }, {
        signal: caller.signal,
      }).catch(() => undefined);
    });
    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0]?.[1]);
    caller.abort();
    expect(providerSignal?.aborted).toBe(false);
    expect(hook.result.current.pendingTodoIds.size).toBe(0);
  });
});
