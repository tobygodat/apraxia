// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthIdentity } from "../../auth/authPort";
import type { DeleteUndoToken, Profile, Todo } from "../../types/domain";
import type { TodoService, TodoWorkspaceSnapshot } from "./todoService";
import { TodosWorkspace } from "./TodosWorkspace";

const IDENTITY: AuthIdentity = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "test@example.com",
  expiresAt: 1_900_000_000,
};
const PROFILE: Profile = {
  userId: IDENTITY.userId,
  timezone: "America/New_York",
  createdAt: "2026-09-01T12:00:00.000000Z",
  updatedAt: "2026-09-01T12:00:00.000000Z",
};
const TODO: Todo = {
  id: "22222222-2222-4222-8222-222222222222",
  text: "Send the brief",
  completed: false,
  completedAt: null,
  dueDate: "2026-09-02",
  dueTime: "14:30:00",
  projectId: null,
  todayRank: null,
  createdAt: "2026-09-01T14:00:00.000000Z",
  updatedAt: "2026-09-01T14:00:00.000000Z",
};
const INBOX: Todo = {
  ...TODO,
  id: "33333333-3333-4333-8333-333333333333",
  text: "Inbox note",
  dueDate: null,
  dueTime: null,
};
const PROJECT = { id: "44444444-4444-4444-8444-444444444444", title: "Launch" };
const TOKEN = "2026-09-03T19:00:00.123456Z" as DeleteUndoToken;
const SNAPSHOT: TodoWorkspaceSnapshot = {
  profile: PROFILE,
  classes: [],
  projects: [PROJECT],
  todos: [TODO, INBOX],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

function createService(overrides: Partial<TodoService> = {}): TodoService {
  return {
    loadWorkspace: vi.fn(async () => SNAPSHOT),
    createTodo: vi.fn(async (input) => ({
      ...TODO,
      ...input,
      id: "55555555-5555-4555-8555-555555555555",
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
      projectId: input.projectId ?? null,
    })),
    updateTodoDetails: vi.fn(async (id, input) => ({ ...TODO, id, ...input })),
    setTodoCompleted: vi.fn(async (id, completed) => ({
      ...TODO,
      id,
      completed,
      completedAt: completed ? "2026-09-03T19:00:00Z" : null,
    })),
    softDeleteTodo: vi.fn(async () => TOKEN),
    restoreTodo: vi.fn(async () => true),
    loadToday: vi.fn(async () => []),
    reorderToday: vi.fn(async () => []),
    ...overrides,
  };
}

function mount(service: TodoService) {
  return render(
    <MemoryRouter initialEntries={["/todos"]}>
      <TodosWorkspace
        service={service}
        identity={IDENTITY}
        workspaceSessionKey="account-a"
        onSignOut={vi.fn(async () => undefined)}
        signOutStatus="idle"
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // It is already Friday in UTC, but still Thursday in the profile timezone.
  vi.setSystemTime(new Date("2026-09-04T00:30:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TodosWorkspace", () => {
  it("keeps account controls available during loading and derives dates from the loaded profile", async () => {
    const loading = deferred<TodoWorkspaceSnapshot>();
    mount(createService({ loadWorkspace: vi.fn(() => loading.promise) }));
    expect(screen.getByText("Loading your tasks…")).toBeTruthy();
    expect((screen.getByRole("button", { name: /\+ add/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "account" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Inbox" })).toBeNull();

    await act(async () => loading.resolve(SNAPSHOT));
    expect(screen.getByRole("heading", { name: /Thursday, Sep 3.*Today/ })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: /· Today$/ })).getByText(TODO.text),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: /\+ add/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("shows only owned load-error copy and supports retry", async () => {
    const loadWorkspace = vi
      .fn<TodoService["loadWorkspace"]>()
      .mockRejectedValueOnce(new Error("private provider response"))
      .mockResolvedValueOnce(SNAPSHOT);
    mount(createService({ loadWorkspace }));
    expect(await screen.findByText("Tasks could not be loaded. Try again.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private provider response");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article", { name: TODO.text })).toBeTruthy();
    expect(loadWorkspace).toHaveBeenCalledTimes(2);
  });

  it("reconciles global Add without refetching or erasing an existing delete Undo", async () => {
    const service = createService();
    mount(service);
    fireEvent.click(await screen.findByRole("button", { name: `Delete ${INBOX.text}` }));
    const undo = await screen.findByRole("button", { name: "Undo" });
    fireEvent.click(screen.getByRole("button", { name: /\+ add/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "New draft" },
    });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-09-03" } });
    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "09:30" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
      target: { value: PROJECT.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(await screen.findByRole("article", { name: "New draft" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(service.loadWorkspace).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Undo" })).toBe(undo);
    fireEvent.click(undo);
    expect(await screen.findByRole("article", { name: INBOX.text })).toBeTruthy();
    expect(service.restoreTodo).toHaveBeenCalledWith(
      INBOX.id,
      TOKEN,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("connects contextual Inbox Add and navigable full weeks to the same form", async () => {
    mount(createService());
    fireEvent.click(await screen.findByRole("button", { name: "Add task to Inbox" }));
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    fireEvent.click(screen.getByRole("button", { name: /Add task to Monday, Sep 7/ }));
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-09-07");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { name: /Thursday, Sep 3.*Today/ })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Monday, Sep 7/ })).toBeNull();
  });

  it("completes an overdue todo without rolling its stored due date forward", async () => {
    const service = createService();
    mount(service);
    const completion = await screen.findByRole("checkbox", {
      name: `Mark as complete ${TODO.text}`,
    });
    completion.focus();
    fireEvent.click(completion);
    await waitFor(() => expect(screen.queryByRole("article", { name: TODO.text })).toBeNull());
    expect(service.setTodoCompleted).toHaveBeenCalledWith(
      TODO.id,
      true,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.queryByRole("article", { name: TODO.text })).toBeNull();
  });

  it("saves edited details atomically and moves a cleared date into Inbox", async () => {
    const service = createService();
    mount(service);
    fireEvent.click(await screen.findByRole("button", { name: `Edit ${TODO.text}` }));
    expect((screen.getByRole("textbox", { name: "Task" }) as HTMLInputElement).value).toBe(
      TODO.text,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Updated brief" },
    });
    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(service.updateTodoDetails).toHaveBeenCalledWith(
      TODO.id,
      {
        text: "Updated brief",
        dueDate: null,
        dueTime: null,
        projectId: null,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      within(screen.getByRole("region", { name: "Inbox" })).getByRole("article", {
        name: "Updated brief",
      }),
    ).toBeTruthy();
  });

  it("fails closed if a provider returns another profile", async () => {
    mount(
      createService({
        loadWorkspace: vi.fn(async () => ({
          ...SNAPSHOT,
          profile: { ...PROFILE, userId: "66666666-6666-4666-8666-666666666666" },
        })),
      }),
    );
    expect(await screen.findByText("Tasks could not be loaded. Try again.")).toBeTruthy();
    expect(screen.queryByText(TODO.text)).toBeNull();
    expect((screen.getByRole("button", { name: /\+ add/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
