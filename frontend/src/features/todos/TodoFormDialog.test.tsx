// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "../../types/domain";
import {
  TodoComposerDialog,
  type TodoComposerDialogProps,
  TodoEditDialog,
  type TodoEditDialogProps,
} from "./TodoFormDialog";

const PROJECT = { id: "44444444-4444-4444-8444-444444444444", title: "Launch" };
const TODO: Todo = {
  id: "22222222-2222-4222-8222-222222222222",
  text: "Send the brief",
  completed: false,
  completedAt: null,
  dueDate: "2026-09-02",
  dueTime: "14:30:00.123456",
  projectId: PROJECT.id,
  todayRank: null,
  createdAt: "2026-09-01T14:00:00.000000Z",
  updatedAt: "2026-09-01T14:00:00.000000Z",
};

afterEach(() => cleanup());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

function field(name: string) {
  return screen.getByLabelText(name) as HTMLInputElement;
}

function renderCreate(
  onCreate: TodoComposerDialogProps["onCreate"] = vi.fn(async () => undefined),
  extra: { initialDueDate?: string } = {},
) {
  const onClose = vi.fn();
  const view = render(
    <>
      <button type="button">Opener</button>
      <TodoComposerDialog
        open
        projects={[PROJECT]}
        onCreate={onCreate}
        onClose={onClose}
        {...extra}
      />
    </>,
  );
  return { view, onCreate, onClose };
}

function renderEdit(overrides: Partial<TodoEditDialogProps> = {}) {
  const props: TodoEditDialogProps = {
    todo: TODO,
    projects: [PROJECT],
    onSave: vi.fn(async () => undefined),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<TodoEditDialog {...props} />);
  return { view, props };
}

describe("TodoFormDialog create mode", () => {
  it("opens a named modal focused on the task field and submits browser-safe values", async () => {
    const { onCreate, onClose } = renderCreate();
    expect(screen.getByRole("dialog", { name: "Add a task" })).toBeTruthy();
    expect(document.activeElement).toBe(field("Task"));
    fireEvent.change(field("Task"), { target: { value: "  Write notes  " } });
    fireEvent.change(field("Due date"), { target: { value: "2026-09-03" } });
    fireEvent.change(field("Due time"), { target: { value: "09:15" } });
    fireEvent.change(field("Project"), { target: { value: PROJECT.id } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(
      { text: "Write notes", dueDate: "2026-09-03", dueTime: "09:15", projectId: PROJECT.id },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("prefills a contextual due date and returns focus to the opener on cancel or Escape", () => {
    const { onClose } = renderCreate(undefined, { initialDueDate: "2026-09-04" });
    expect(field("Due date").value).toBe("2026-09-04");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("associates validation with the first invalid field and guards a time without a date", () => {
    const { onCreate } = renderCreate();
    fireEvent.change(field("Due time"), { target: { value: "09:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(field("Task").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field("Task"));
    expect(field("Due time").getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(field("Due time").getAttribute("aria-describedby")!)?.textContent,
    ).toMatch(/due date/i);
    fireEvent.change(field("Task"), { target: { value: "Task" } });
    expect(field("Task").getAttribute("aria-invalid")).toBe("false");
    fireEvent.change(field("Due date"), { target: { value: "2026-09-03" } });
    fireEvent.change(field("Due date"), { target: { value: "" } });
    expect(field("Due time").value).toBe("");
  });

  it("preserves exact values after a failed save, hides raw errors, and permits retry", async () => {
    const onCreate = vi.fn<TodoComposerDialogProps["onCreate"]>(async () => {
      throw new Error("relation todos does not exist");
    });
    const { onClose } = renderCreate(onCreate);
    fireEvent.change(field("Task"), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await screen.findByText("We couldn’t add this task. Your details are still here—try again.");
    expect(document.body.textContent).not.toContain("relation todos");
    expect(field("Task").value).toBe("Keep me");
    expect(onClose).not.toHaveBeenCalled();
    onCreate.mockImplementation(async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("locks fields and dismissal while a save is pending and allows a single request", async () => {
    const pending = deferred<void>();
    const onCreate = vi.fn(() => pending.promise);
    const { onClose } = renderCreate(onCreate);
    fireEvent.change(field("Task"), { target: { value: "Once" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    fireEvent.click(screen.getByRole("button", { name: "Adding…" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(field("Task").disabled).toBe(true);
    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      pending.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("aborts the request and ignores a late success after unmount", async () => {
    const pending = deferred<void>();
    const onCreate = vi.fn((_input: unknown, options: { signal: AbortSignal }) => {
      const signal = options.signal;
      return pending.promise.then(() => {
        expect(signal.aborted).toBe(true);
      });
    });
    const { view, onClose } = renderCreate(onCreate as never);
    fireEvent.change(field("Task"), { target: { value: "Late" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    view.unmount();
    await act(async () => {
      pending.resolve();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("TodoFormDialog edit and reschedule modes", () => {
  it("renders nothing without a todo and shows existing values with the exact stored time retained", () => {
    const empty = render(
      <TodoEditDialog todo={null} projects={[]} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    empty.unmount();
    renderEdit();
    expect(screen.getByRole("dialog", { name: "Edit task" })).toBeTruthy();
    expect(document.activeElement).toBe(field("Task"));
    expect(field("Task").required).toBe(true);
    expect(field("Due time").value).toMatch(/^14:30/);
    expect(screen.getByText(/Saved time: 14:30:00.123456/)).toBeTruthy();
  });

  it("saves full atomic details, keeps untouched time precision, then closes", async () => {
    const { props } = renderEdit();
    fireEvent.change(field("Task"), { target: { value: "Send the final brief" } });
    fireEvent.change(field("Due date"), { target: { value: "2026-09-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(props.onSave).toHaveBeenCalledWith(
      TODO.id,
      {
        text: "Send the final brief",
        projectId: PROJECT.id,
        dueDate: "2026-09-05",
        dueTime: "14:30:00.123456",
      },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("clears both schedule fields together when the date is removed", async () => {
    const { props } = renderEdit();
    fireEvent.change(field("Due date"), { target: { value: "2026-09-03" } });
    fireEvent.change(field("Due date"), { target: { value: "" } });
    expect(field("Due time").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith(
        TODO.id,
        {
          text: TODO.text,
          projectId: PROJECT.id,
          dueDate: null,
          dueTime: null,
        },
        expect.anything(),
      ),
    );
  });

  it("reschedules only the schedule, focusing the date first", async () => {
    const { props } = renderEdit({ mode: "reschedule" });
    expect(screen.getByRole("dialog", { name: "Reschedule task" })).toBeTruthy();
    expect(document.activeElement).toBe(field("Due date"));
    expect(screen.queryByLabelText("Project")).toBeNull();
    fireEvent.change(field("Due date"), { target: { value: "2026-09-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith(
        TODO.id,
        { dueDate: "2026-09-09", dueTime: "14:30:00.123456" },
        expect.anything(),
      ),
    );
  });

  it("keeps an unavailable current project and the draft across a same-record refresh", () => {
    const { view } = renderEdit({ projects: [] });
    expect(screen.getByRole("option", { name: "Current project (unavailable)" })).toBeTruthy();
    expect(field("Project").value).toBe(PROJECT.id);
    fireEvent.change(field("Task"), { target: { value: "Draft" } });
    view.rerender(
      <TodoEditDialog
        todo={{ ...TODO, text: "Refreshed" }}
        projects={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(field("Task").value).toBe("Draft");
  });

  it("preserves values on failure and uses the fallback focus when the opener is gone", async () => {
    const fallback = document.createElement("div");
    fallback.tabIndex = -1;
    document.body.append(fallback);
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onSave = vi.fn(async () => {
      throw new Error("secret");
    });
    const { view, props } = renderEdit({ onSave, fallbackFocusRef: { current: fallback } });
    fireEvent.change(field("Task"), { target: { value: "Try" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("We couldn’t save this task. Your details are still here—try again.");
    expect(field("Task").value).toBe("Try");
    expect(document.body.textContent).not.toContain("secret");
    opener.remove();
    view.rerender(<TodoEditDialog {...props} todo={null} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(fallback);
    fallback.remove();
  });
});

describe("TodoFormDialog class fields", () => {
  const CLASSES = [{ id: "math", name: "Math" }];

  it("switches between project and class, keeping assignment type class-only", async () => {
    const onCreate = vi.fn(async () => undefined);
    render(
      <TodoComposerDialog
        open
        projects={[PROJECT]}
        classes={CLASSES}
        initialProjectId={PROJECT.id}
        initialDueDate="2020-03-08"
        onCreate={onCreate}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(field("Task"), { target: { value: "Worksheet" } });
    fireEvent.change(field("Class"), { target: { value: "math" } });
    expect(field("Project").value).toBe("");
    fireEvent.change(field("Assignment type"), { target: { value: "Quiz" } });
    fireEvent.change(field("Project"), { target: { value: PROJECT.id } });
    expect(field("Class").value).toBe("");
    expect(screen.queryByLabelText("Assignment type")).toBeNull();
    fireEvent.change(field("Class"), { target: { value: "math" } });
    expect(field("Assignment type").value).toBe("");
    fireEvent.change(field("Assignment type"), { target: { value: "Reading" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        {
          text: "Worksheet",
          projectId: null,
          classId: "math",
          assignmentType: "Reading",
          dueDate: "2020-03-08",
          dueTime: null,
        },
        { signal: expect.any(AbortSignal) },
      ),
    );
  });

  it("retains unavailable class context and clears it atomically when choosing a project", async () => {
    const { props } = renderEdit({
      todo: { ...TODO, projectId: null, classId: "math", assignmentType: "Quiz", dueTime: null },
    });
    expect(field("Class").value).toBe("math");
    expect(field("Assignment type").value).toBe("Quiz");
    fireEvent.change(field("Project"), { target: { value: PROJECT.id } });
    expect(screen.queryByLabelText("Assignment type")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith(
        TODO.id,
        {
          text: TODO.text,
          projectId: PROJECT.id,
          classId: null,
          assignmentType: "",
          dueDate: TODO.dueDate,
          dueTime: null,
        },
        { signal: expect.any(AbortSignal) },
      ),
    );
  });

  it("assigns an ordinary task to a class with no synthetic due time", async () => {
    const { props } = renderEdit({
      todo: { ...TODO, projectId: null, dueTime: null },
      classes: CLASSES,
    });
    fireEvent.change(field("Class"), { target: { value: "math" } });
    fireEvent.change(field("Assignment type"), { target: { value: "Homework" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(props.onSave).toHaveBeenCalledWith(
        TODO.id,
        {
          text: TODO.text,
          projectId: null,
          classId: "math",
          assignmentType: "Homework",
          dueDate: TODO.dueDate,
          dueTime: null,
        },
        { signal: expect.any(AbortSignal) },
      ),
    );
  });
});
