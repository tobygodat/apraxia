// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import type { AuthIdentity } from "../../auth/authPort";
import type { NewTodoInput, ProjectSummary, Todo } from "../../types/domain";
import type { TodoService } from "../../features/todos/todoService";
import {
  GlobalAddTodoController,
  type GlobalAddTodoActions,
  useGlobalAddTodo,
} from "./GlobalAddTodoController";
import { GlobalAddTodoShell } from "./GlobalAddTodoShell";

const IDENTITY: AuthIdentity = {
  userId: "private-user-id",
  email: "toby@example.com",
  expiresAt: 1_800_000_000,
};

const PROJECTS: readonly ProjectSummary[] = [
  { id: "5f8d7f2f-6807-4612-b7ee-6ddab6f8b476", title: "Home" },
  { id: "a8a06b7e-f0be-4f5d-b9a3-a4d263bc7371", title: "Launch" },
];

const CREATED_TODO: Todo = {
  id: "7c630b57-bd92-4cc3-b349-530de6f28c7a",
  text: "Send the brief",
  completed: false,
  completedAt: null,
  dueDate: "2026-09-04",
  dueTime: "09:30",
  projectId: PROJECTS[1].id,
  todayRank: null,
  createdAt: "2026-09-02T12:00:00.000Z",
  updatedAt: "2026-09-02T12:00:00.000Z",
};

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

function ContextualAdd() {
  const { openTodoComposer } = useGlobalAddTodo();

  return (
    <button
      type="button"
      onClick={() =>
        openTodoComposer({ initialDueDate: "2026-09-05" })
      }
    >
      Add task for Saturday
    </button>
  );
}

function renderController(
  createTodo: TodoService["createTodo"],
  route = "/projects",
  onCreated: (todo: Todo) => undefined = () => undefined,
) {
  const service: Pick<TodoService, "createTodo"> = { createTodo };

  return render(
    <MemoryRouter initialEntries={[route]}>
      <GlobalAddTodoController
        workspaceSessionKey="session-a"
        service={service}
        projects={PROJECTS}
        onCreated={onCreated}
      >
        <GlobalAddTodoShell
          identity={IDENTITY}
          onSignOut={vi.fn(async () => undefined)}
          signOutStatus="idle"
        >
          <ContextualAdd />
        </GlobalAddTodoShell>
      </GlobalAddTodoController>
    </MemoryRouter>,
  );
}

describe("GlobalAddTodoController", () => {
  it("connects the shell action to TodoService and clears the next form after success", async () => {
    const createTodo = vi.fn<TodoService["createTodo"]>(async () => CREATED_TODO);
    const onCreated = vi.fn(() => undefined);
    renderController(createTodo, "/projects", onCreated);
    const opener = screen.getByRole("button", { name: /\+ add/i });

    opener.focus();
    fireEvent.click(opener);

    const task = screen.getByRole("textbox", { name: "Task" });
    expect(document.activeElement).toBe(task);
    fireEvent.change(task, { target: { value: "  Send the brief  " } });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-09-04" },
    });
    fireEvent.change(screen.getByLabelText("Due time"), {
      target: { value: "09:30" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
      target: { value: PROJECTS[1].id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(createTodo).toHaveBeenCalledOnce());
    const [input, options] = createTodo.mock.calls[0] as [
      NewTodoInput,
      { readonly signal: AbortSignal },
    ];
    expect(input).toEqual({
      text: "Send the brief",
      dueDate: "2026-09-04",
      dueTime: "09:30",
      projectId: PROJECTS[1].id,
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal.aborted).toBe(false);
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(CREATED_TODO);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    expect((screen.getByRole("textbox", { name: "Task" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Due time") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement).value).toBe("");
  });

  it("preserves exact input when TodoService fails and permits a safe retry", async () => {
    const createTodo = vi
      .fn<TodoService["createTodo"]>()
      .mockRejectedValueOnce(new Error("database secret must stay hidden"))
      .mockResolvedValueOnce(CREATED_TODO);
    const { container } = renderController(createTodo, "/ideas");
    const opener = screen.getByRole("button", { name: /\+ add/i });
    opener.focus();
    fireEvent.click(opener);

    const task = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "  Call Sam 📞  " } });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-09-04" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(
      await screen.findByText(
        "We couldn’t add this task. Your details are still here—try again.",
      ),
    ).toBeTruthy();
    expect((task as HTMLInputElement).value).toBe("  Call Sam 📞  ");
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe(
      "2026-09-04",
    );
    expect(container.textContent).not.toContain("database secret");

    const firstSignal = createTodo.mock.calls[0]?.[1].signal;
    expect(firstSignal?.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(createTodo).toHaveBeenCalledTimes(2));
    expect(createTodo.mock.calls[1]?.[1].signal).not.toBe(firstSignal);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("supports contextual route dates and returns focus after cancel", () => {
    const createTodo = vi.fn<TodoService["createTodo"]>(async () => CREATED_TODO);
    renderController(createTodo, "/todos");
    const contextualOpener = screen.getByRole("button", {
      name: "Add task for Saturday",
    });

    contextualOpener.focus();
    fireEvent.click(contextualOpener);

    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe(
      "2026-09-05",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Discard this draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(contextualOpener);
    expect(createTodo).not.toHaveBeenCalled();

    const globalOpener = screen.getByRole("button", { name: /\+ add/i });
    fireEvent.click(globalOpener);
    expect((screen.getByRole("textbox", { name: "Task" }) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("");
  });

  it("aborts the exact service request when its authenticated owner unmounts", async () => {
    let receivedSignal: AbortSignal | undefined;
    const createTodo = vi.fn<TodoService["createTodo"]>(
      (_input, { signal }) =>
        new Promise<Todo>((_resolve, reject) => {
          receivedSignal = signal;
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const { unmount } = renderController(createTodo);

    fireEvent.click(screen.getByRole("button", { name: /\+ add/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Pending request" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(createTodo).toHaveBeenCalledOnce());

    expect(receivedSignal?.aborted).toBe(false);
    unmount();
    expect(receivedSignal?.aborted).toBe(true);
  });

  it.each(["account", "service"] as const)(
    "abandons old drafts, actions, and a late saved result after a %s change",
    async (change) => {
      let resolveCreate!: (todo: Todo) => void;
      let latestActions!: GlobalAddTodoActions;
      const createTodo = vi.fn<TodoService["createTodo"]>(
        () => new Promise((resolve) => { resolveCreate = resolve; }),
      );
      const firstService = { createTodo };
      const secondService = { createTodo: vi.fn<TodoService["createTodo"]>() };
      const onCreated = vi.fn(() => undefined);

      function CaptureActions() {
        latestActions = useGlobalAddTodo();
        return <ContextualAdd />;
      }

      function Owner({ next = false }: { next?: boolean }) {
        return (
          <GlobalAddTodoController
            workspaceSessionKey={next && change === "account" ? "session-b" : "session-a"}
            service={next && change === "service" ? secondService : firstService}
            projects={PROJECTS}
            onCreated={onCreated}
          >
            <CaptureActions />
          </GlobalAddTodoController>
        );
      }

      const { rerender } = render(<Owner />);
      const retainedActions = latestActions;
      fireEvent.click(screen.getByRole("button", { name: "Add task for Saturday" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
        target: { value: "Private account A draft" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add task" }));
      await waitFor(() => expect(createTodo).toHaveBeenCalledOnce());

      rerender(<Owner next />);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(createTodo.mock.calls[0]?.[1].signal.aborted).toBe(true);
      act(() => retainedActions.openTodoComposer());
      expect(screen.queryByRole("dialog")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Add task for Saturday" }));
      const nextTask = screen.getByRole("textbox", { name: "Task" }) as HTMLInputElement;
      expect(nextTask.value).toBe("");
      fireEvent.change(nextTask, { target: { value: "Current account draft" } });
      await act(async () => resolveCreate(CREATED_TODO));

      expect(onCreated).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(nextTask.value).toBe("Current account draft");
    },
  );

  it("does not offer a duplicate retry if saving succeeds but local reconciliation throws", async () => {
    const createTodo = vi.fn<TodoService["createTodo"]>(async () => CREATED_TODO);
    const onCreated = vi.fn(() => {
      throw new Error("private local cache error");
    });
    renderController(createTodo, "/todos", onCreated);
    fireEvent.click(screen.getByRole("button", { name: /\+ add/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Saved once" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(createTodo).toHaveBeenCalledOnce();
    expect(screen.getByText("Task added, but this view may be out of date. Refresh to see it.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private local cache error");
  });
});

it("offers class selection in Global Add and forwards one parent to the service", async () => {
  const createTodo = vi.fn(async () => ({ ...CREATED_TODO, projectId: null, classId: "math", assignmentType: "Quiz" }));
  render(<GlobalAddTodoController workspaceSessionKey="a" service={{ createTodo }} projects={PROJECTS} classes={[{ id: "math", name: "Math" }]} onCreated={() => undefined}><ContextualAdd /></GlobalAddTodoController>);
  fireEvent.click(screen.getByRole("button", { name: "Add task for Saturday" }));
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Quiz preparation" } });
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: PROJECTS[0].id } });
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: "math" } });
  fireEvent.change(screen.getByLabelText("Assignment type"), { target: { value: "Quiz" } });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  await waitFor(() => expect(createTodo).toHaveBeenCalledWith({ text: "Quiz preparation", projectId: null, classId: "math", assignmentType: "Quiz", dueDate: "2026-09-05", dueTime: null }, { signal: expect.any(AbortSignal) }));
});
