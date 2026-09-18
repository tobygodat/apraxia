// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeleteUndoToken, Profile, TodayTodo, Todo } from "../../types/domain";
import { TodayPanel, type TodayPanelProps } from "./TodayPanel";
import { WorkspaceContext, type WorkspaceStore } from "../../apps/workspaceStore";
import type { TodoService } from "./todoService";

const PROFILE: Profile = {
  userId: "11111111-1111-4111-8111-111111111111",
  timezone: "America/New_York",
  createdAt: "2026-09-01T12:00:00Z",
  updatedAt: "2026-09-01T12:00:00Z",
};
const PROJECT = { id: "44444444-4444-4444-8444-444444444444", title: "Launch" };
const TODO: Todo = {
  id: "22222222-2222-4222-8222-222222222222",
  text: "Send the brief",
  completed: false,
  completedAt: null,
  dueDate: "2026-09-02",
  dueTime: "14:30:00.123456",
  projectId: null,
  todayRank: null,
  createdAt: "2026-09-01T14:00:00.000000Z",
  updatedAt: "2026-09-01T14:00:00.000000Z",
};
const CREATED_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "2026-09-03T19:00:00.123456Z" as DeleteUndoToken;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((success) => {
    resolve = success;
  });
  return { promise, resolve };
}

function fixture(overrides: Partial<TodoService> = {}) {
  let rows = [TODO];
  let deleted: Todo | null = null;
  function update(id: string, values: Partial<Todo>) {
    const existing = rows.find((row) => row.id === id);
    if (!existing) throw new Error("Missing test row.");
    const saved = { ...existing, ...values };
    rows = rows.map((row) => (row.id === id ? saved : row));
    return saved;
  }
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
                projectTitle: null,
              },
            ]
          : [],
      ),
    ),
    createTodo: vi.fn(async (input) => {
      const saved = {
        ...TODO,
        ...input,
        id: CREATED_ID,
        dueDate: input.dueDate ?? null,
        dueTime: input.dueTime ?? null,
        projectId: input.projectId ?? null,
      };
      rows = [...rows, saved];
      return saved;
    }),
    updateTodoDetails: vi.fn(async (id, input) => update(id, input)),
    setTodoCompleted: vi.fn(async (id, completed) => ({
      todo: update(id, {
        completed,
        completedAt: completed ? "2026-09-03T19:00:00Z" : null,
      }),
      spawned: null,
      withdrawn: null,
    })),
    softDeleteTodo: vi.fn(async (id) => {
      deleted = rows.find((row) => row.id === id) ?? null;
      rows = rows.filter((row) => row.id !== id);
      return TOKEN;
    }),
    restoreTodo: vi.fn(async () => {
      if (!deleted) return false;
      rows = [...rows, deleted];
      deleted = null;
      return true;
    }),
    reorderToday: vi.fn(async (_date: string, ids: readonly string[]) =>
      ids.map((id, index) => {
        update(id, { todayRank: index + 1 });
        return { todoId: id, todayRank: index + 1 };
      }),
    ),
    ...overrides,
  };
  return {
    service,
    replaceRows: (next: Todo[]) => {
      rows = next;
    },
  };
}

function store(revision: number): WorkspaceStore {
  return {
    profile: null,
    profileError: false,
    projects: [],
    classes: [],
    projectError: false,
    revision,
    invalidate: vi.fn(),
    retryProfile: vi.fn(),
    dialogs: { isOpen: () => false, register: () => () => undefined },
  };
}
function props(service: TodoService, extra: Partial<TodayPanelProps> = {}): TodayPanelProps {
  return {
    service,
    workspaceSessionKey: "account-a",
    profile: PROFILE,
    projects: [PROJECT],
    ...extra,
  };
}

async function ready() {
  await screen.findByRole("checkbox", { name: `Mark ${TODO.text} complete` });
}
function field(name: string) {
  return screen.getByLabelText(name) as HTMLInputElement;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-04T00:30:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TodayPanel", () => {
  it("shows only tomorrow's incomplete tasks, defaults creation to tomorrow, and preserves Today", async () => {
    const data = fixture();
    const tomorrow = { ...TODO, id: CREATED_ID, text: "Prepare tomorrow", dueDate: "2026-09-04" };
    data.replaceRows([
      TODO,
      tomorrow,
      {
        ...tomorrow,
        id: "55555555-5555-4555-8555-555555555555",
        dueDate: "2026-09-05",
        text: "Later",
      },
      {
        ...tomorrow,
        id: "66666666-6666-4666-8666-666666666666",
        text: "Already done",
        completed: true,
        completedAt: "2026-09-03T18:00:00Z",
      },
    ]);
    render(<TodayPanel {...props(data.service, { allowTomorrow: true })} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    await screen.findByRole("checkbox", { name: "Mark Prepare tomorrow complete" });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Reorder Prepare tomorrow" })).toBeNull();
    expect(screen.getByText("Due tomorrow · Fri, Sep 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(field("Due date").value).toBe("2026-09-04");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await ready();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(data.service.loadToday).toHaveBeenCalledWith("2026-09-03", expect.anything());
    expect(
      vi.mocked(data.service.loadToday).mock.calls.every(([date]) => date === "2026-09-03"),
    ).toBe(true);
    expect(data.service.reorderToday).not.toHaveBeenCalled();
  });

  it("moves an edited task between day views without changing its title or saved rank", async () => {
    const data = fixture();
    data.replaceRows([
      TODO,
      { ...TODO, id: CREATED_ID, text: "Review Today", dueDate: "2026-09-04", todayRank: 2048 },
    ]);
    render(<TodayPanel {...props(data.service, { allowTomorrow: true })} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Review Today" }));
    fireEvent.change(field("Due date"), { target: { value: "2026-09-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Nothing is due tomorrow.");
    expect(screen.getByText("Review Today updated.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await screen.findByRole("checkbox", { name: "Mark Review Today complete" });
    expect(
      (await data.service.loadWorkspace({ signal: new AbortController().signal })).todos.find(
        (todo) => todo.id === CREATED_ID,
      )?.todayRank,
    ).toBe(2048);
    expect(data.service.reorderToday).not.toHaveBeenCalled();
  });

  it("ignores a late Tomorrow load after switching back to Today", async () => {
    const pending = deferred<Awaited<ReturnType<TodoService["loadWorkspace"]>>>();
    const data = fixture({ loadWorkspace: vi.fn(() => pending.promise) });
    render(<TodayPanel {...props(data.service, { allowTomorrow: true })} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    await waitFor(() => expect(data.service.loadWorkspace).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await ready();
    await act(async () =>
      pending.resolve({
        profile: PROFILE,
        classes: [],
        projects: [],
        todos: [{ ...TODO, text: "Late future task", dueDate: "2026-09-04" }],
      }),
    );
    expect(screen.queryByText("Late future task")).toBeNull();
    expect(screen.getByRole("button", { name: "Today" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps deletion Undo across day switches and supports completing Tomorrow tasks", async () => {
    const data = fixture();
    data.replaceRows([
      TODO,
      { ...TODO, id: CREATED_ID, text: "Prepare tomorrow", dueDate: "2026-09-04" },
    ]);
    render(<TodayPanel {...props(data.service, { allowTomorrow: true })} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Prepare tomorrow" }));
    await screen.findByRole("button", { name: "Undo" });
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Mark Prepare tomorrow complete" }),
    );
    await screen.findByText("Nothing is due tomorrow.");
    expect(data.service.restoreTodo).toHaveBeenCalledWith(CREATED_ID, TOKEN, expect.anything());
    expect(data.service.setTodoCompleted).toHaveBeenCalledWith(CREATED_ID, true, expect.anything());
    expect(data.service.reorderToday).not.toHaveBeenCalled();
  });

  it("loads independently and creates with the profile's local date", async () => {
    const { service } = fixture();
    render(<TodayPanel {...props(service)} />);
    await ready();
    expect(service.loadWorkspace).not.toHaveBeenCalled();
    expect(service.loadToday).toHaveBeenCalledWith("2026-09-03", {
      signal: expect.any(AbortSignal),
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(field("Due date").value).toBe("2026-09-03");
    fireEvent.change(field("Task"), { target: { value: "New local task" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add task" }));
    await screen.findByRole("checkbox", { name: "Mark New local task complete" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(service.createTodo).toHaveBeenCalledTimes(1);
  });

  it("edits details and refreshes the project display from the shared summaries", async () => {
    const { service } = fixture();
    render(<TodayPanel {...props(service)} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: `Edit ${TODO.text}` }));
    fireEvent.change(field("Task"), { target: { value: "Updated brief" } });
    fireEvent.change(field("Project"), { target: { value: PROJECT.id } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("checkbox", { name: "Mark Updated brief complete" });
    expect(screen.getByText(PROJECT.title)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reschedules out of Today without clobbering details and restores safe focus", async () => {
    const { service } = fixture();
    render(<TodayPanel {...props(service)} />);
    await ready();
    const opener = screen.getByRole("button", { name: `Edit ${TODO.text}` });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.change(field("Due date"), { target: { value: "2026-09-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(service.updateTodoDetails).toHaveBeenCalledWith(
      TODO.id,
      {
        dueDate: "2026-09-10",
        dueTime: "14:30:00.123456",
        text: TODO.text,
        projectId: TODO.projectId,
        recurrence: null,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Today tasks")));
  });

  it("retains a failed edit draft and does not expose provider details", async () => {
    const { service } = fixture({
      updateTodoDetails: vi.fn(async () => {
        throw new Error("private database response");
      }),
    });
    render(<TodayPanel {...props(service)} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: `Edit ${TODO.text}` }));
    fireEvent.change(field("Task"), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("We couldn’t save this task. Your details are still here—try again.");
    expect(field("Task").value).toBe("Keep this draft");
    expect(document.body.textContent).not.toContain("private database response");
  });

  it("deletes and restores the row locally on Undo", async () => {
    const { service } = fixture();
    render(<TodayPanel {...props(service)} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: `Delete ${TODO.text}` }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await ready();
    expect(service.restoreTodo).toHaveBeenCalledWith(TODO.id, TOKEN, {
      signal: expect.any(AbortSignal),
    });
    expect(service.loadToday).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("aborts the old form and ignores late creation across an account switch", async () => {
    const creation = deferred<Todo>();
    const { service } = fixture({ createTodo: vi.fn(() => creation.promise) });
    const view = render(<TodayPanel {...props(service)} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    fireEvent.change(field("Task"), { target: { value: "Old account draft" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add task" }));
    const signal = vi.mocked(service.createTodo).mock.calls[0]![1].signal;
    const next = fixture({ loadToday: vi.fn(async () => []) });
    view.rerender(<TodayPanel {...props(next.service, { workspaceSessionKey: "account-b" })} />);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => creation.resolve({ ...TODO, id: CREATED_ID, text: "Old account draft" }));
    expect(document.body.textContent).not.toContain("Old account draft");
  });

  it("closes a stale edit when the service changes within the same account", async () => {
    const first = fixture();
    const view = render(<TodayPanel {...props(first.service)} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: `Edit ${TODO.text}` }));
    fireEvent.change(field("Task"), { target: { value: "Stale draft" } });
    view.rerender(<TodayPanel {...props(fixture().service)} />);
    await ready();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(first.service.updateTodoDetails).not.toHaveBeenCalled();
  });

  it("queues external refresh behind deletion without losing its Undo token", async () => {
    const deletion = deferred<DeleteUndoToken>();
    const data = fixture({ softDeleteTodo: vi.fn(() => deletion.promise) });
    const view = render(
      <WorkspaceContext.Provider value={store(0)}>
        <TodayPanel {...props(data.service)} />
      </WorkspaceContext.Provider>,
    );
    await ready();
    fireEvent.click(screen.getByRole("button", { name: `Delete ${TODO.text}` }));
    const signal = vi.mocked(data.service.softDeleteTodo).mock.calls[0]![1].signal;
    view.rerender(
      <WorkspaceContext.Provider value={store(1)}>
        <TodayPanel {...props(data.service)} />
      </WorkspaceContext.Provider>,
    );
    expect(data.service.loadToday).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
    data.replaceRows([]);
    await act(async () => deletion.resolve(TOKEN));
    await waitFor(() => expect(data.service.loadToday).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("reloads after a persisted create cannot reconcile, without duplicate retry", async () => {
    const data = fixture({
      createTodo: vi.fn(async () => ({ ...TODO, id: "malformed-response" })),
    });
    render(<TodayPanel {...props(data.service)} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    fireEvent.change(field("Task"), { target: { value: "Saved elsewhere" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(data.service.loadToday).toHaveBeenCalledTimes(2));
    expect(data.service.createTodo).toHaveBeenCalledTimes(1);
  });
});
