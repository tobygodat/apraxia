// @vitest-environment happy-dom

import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectSummary, Todo } from "../../types/domain";
import { TodoEditDialog, type TodoEditDialogProps } from "./TodoEditDialog";

const PROJECTS: readonly ProjectSummary[] = [
  { id: "5f8d7f2f-6807-4612-b7ee-6ddab6f8b476", title: "Home" },
  { id: "a8a06b7e-f0be-4f5d-b9a3-a4d263bc7371", title: "Launch" },
];
const TODO: Todo = {
  id: "7c630b57-bd92-4cc3-b349-530de6f28c7a",
  text: "Prepare review",
  completed: false,
  completedAt: null,
  dueDate: "2026-09-02",
  dueTime: "14:30:00",
  projectId: PROJECTS[0].id,
  todayRank: null,
  createdAt: "2026-09-01T14:00:00Z",
  updatedAt: "2026-09-01T14:00:00Z",
};

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function Harness({
  onSave,
  todo = TODO,
  projects = PROJECTS,
  removeOpenerOnSave = false,
}: {
  readonly onSave: TodoEditDialogProps["onSave"];
  readonly todo?: Todo;
  readonly projects?: readonly ProjectSummary[];
  readonly removeOpenerOnSave?: boolean;
}) {
  const [selected, setSelected] = useState<Todo | null>(null);
  const [showOpener, setShowOpener] = useState(true);
  const fallbackRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={fallbackRef} tabIndex={-1}>Todo workspace</div>
      <input aria-label="Newer interaction" />
      {showOpener ? (
        <button type="button" onClick={() => setSelected(todo)}>Open edit</button>
      ) : null}
      <TodoEditDialog
        todo={selected}
        projects={projects}
        fallbackFocusRef={fallbackRef}
        onSave={async (...args) => {
          await onSave(...args);
          if (removeOpenerOnSave) setShowOpener(false);
        }}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function openEdit() {
  const opener = screen.getByRole("button", { name: "Open edit" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

function input(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

describe("TodoEditDialog", () => {
  it("reschedules without sending unrelated fields and retains exact stored time", async () => {
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>(async () => undefined);
    render(<TodoEditDialog mode="reschedule" todo={{ ...TODO, dueTime: "14:30:00.123456" }} projects={PROJECTS} onSave={onSave} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Reschedule task" })).toBeTruthy();
    expect(document.activeElement).toBe(input("Due date"));
    expect(screen.queryByLabelText("Task")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(TODO.text)).toBeTruthy();
    fireEvent.change(input("Due date"), { target: { value: "2026-09-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(TODO.id, {
      dueDate: "2026-09-10", dueTime: "14:30:00.123456",
    }, { signal: expect.any(AbortSignal) }));
  });

  it("clears both scheduling fields when rescheduling to Inbox", async () => {
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>(async () => undefined);
    render(<TodoEditDialog mode="reschedule" todo={TODO} projects={PROJECTS} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(input("Due date"), { target: { value: "" } });
    expect(input("Due time").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(TODO.id, {
      dueDate: null, dueTime: null,
    }, { signal: expect.any(AbortSignal) }));
  });

  it("renders nothing without a selected todo", () => {
    render(<TodoEditDialog todo={null} projects={PROJECTS} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a named modal with the existing values and required task semantics", () => {
    render(<Harness onSave={vi.fn()} />);
    openEdit();
    const dialog = screen.getByRole("dialog", { name: "Edit task" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(input("Task"));
    expect(input("Task").value).toBe(TODO.text);
    expect(input("Task").required).toBe(true);
    expect(input("Due date").value).toBe(TODO.dueDate);
    expect(input("Due time").value).toBe("14:30");
    expect((screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement).value).toBe(TODO.projectId);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("saves only full atomic details, closes, and returns focus to the opener", async () => {
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>(async () => undefined);
    render(<Harness onSave={onSave} />);
    const opener = openEdit();
    fireEvent.change(input("Task"), { target: { value: "  Send the brief  " } });
    fireEvent.change(input("Due date"), { target: { value: "2026-09-04" } });
    fireEvent.change(input("Due time"), { target: { value: "09:30" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
      target: { value: PROJECTS[1].id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSave).toHaveBeenCalledWith(TODO.id, {
      text: "Send the brief",
      dueDate: "2026-09-04",
      dueTime: "09:30",
      projectId: PROJECTS[1].id,
    }, { signal: expect.any(AbortSignal) });
    expect(Object.keys(onSave.mock.calls[0][1]).sort()).toEqual(["dueDate", "dueTime", "projectId", "text"]);
    expect(onSave.mock.calls[0][2].signal.aborted).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it.each([
    ["09:00:00.123456", "09:00"],
    ["23:59:59.000001", "23:59:59"],
  ])("preserves the exact saved time %s on a text-only edit", async (dueTime, visibleTime) => {
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>(async () => undefined);
    render(<Harness onSave={onSave} todo={{ ...TODO, dueTime }} />);
    openEdit();
    const time = input("Due time");
    expect(time.value).toBe(visibleTime);
    expect(document.getElementById(time.getAttribute("aria-describedby")!)?.textContent)
      .toBe(`Saved time: ${dueTime}. Kept exactly unless you change this field.`);
    fireEvent.change(input("Task"), { target: { value: "Edited text only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSave.mock.calls[0][1]).toEqual({
      text: "Edited text only",
      dueDate: TODO.dueDate,
      dueTime,
      projectId: TODO.projectId,
    });
  });

  it("preserves untouched time precision when rescheduling to another date", async () => {
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>(async () => undefined);
    const dueTime = "09:00:00.123456";
    render(<Harness onSave={onSave} todo={{ ...TODO, dueTime }} />);
    openEdit();
    fireEvent.change(input("Due date"), { target: { value: "2026-09-04" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][1]).toMatchObject({ dueDate: "2026-09-04", dueTime });
  });

  it.each(["10:15:30", ""])("replaces precise saved time after explicitly changing it to %s", async (dueTime) => {
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>(async () => undefined);
    render(<Harness onSave={onSave} todo={{ ...TODO, dueTime: "09:00:00.123456" }} />);
    openEdit();
    fireEvent.change(input("Due time"), { target: { value: dueTime } });
    expect(screen.queryByText(/Saved time:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][1].dueTime).toBe(dueTime || null);
  });

  it("clears the visible time and sends both nullable schedule fields when removing a date", async () => {
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>(async () => undefined);
    render(<Harness onSave={onSave} todo={{ ...TODO, dueTime: "09:00:00.123456" }} />);
    openEdit();
    fireEvent.change(input("Due date"), { target: { value: "" } });
    expect(input("Due time").value).toBe("");
    expect(screen.queryByText(/Saved time:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][1]).toEqual({
      text: TODO.text,
      dueDate: null,
      dueTime: null,
      projectId: TODO.projectId,
    });
  });

  it.each(["Cancel", "Escape"])("closes with %s without saving and restores focus", async (method) => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const opener = openEdit();
    fireEvent.change(input("Task"), { target: { value: "Discarded draft" } });
    if (method === "Cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    else fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    fireEvent.click(opener);
    expect(input("Task").value).toBe(TODO.text);
  });

  it("traps forward and backward Tab navigation inside the form", () => {
    render(<Harness onSave={vi.fn()} />);
    openEdit();
    const first = input("Task");
    const last = screen.getByRole("button", { name: "Save changes" });
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("associates validation with the first invalid field and retains a time without a date", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} todo={{ ...TODO, dueDate: null, dueTime: null }} />);
    openEdit();
    fireEvent.change(input("Task"), { target: { value: "" } });
    fireEvent.change(input("Due time"), { target: { value: "12:15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const task = input("Task");
    expect(document.activeElement).toBe(task);
    expect(task.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(task.getAttribute("aria-describedby")!)?.textContent).toBe("Enter a task.");
    expect(screen.getByText("Add a due date before adding a due time.")).toBeTruthy();
    expect(input("Due time").value).toBe("12:15");
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(input("Due date"), { target: { value: "2026-09-04" } });
    expect(screen.queryByText("Add a due date before adding a due time.")).toBeNull();
  });

  it("preserves exact values on failure, hides raw errors, and permits retry", async () => {
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>()
      .mockRejectedValueOnce(new Error("postgres secret detail"))
      .mockResolvedValueOnce(undefined);
    render(<Harness onSave={onSave} />);
    openEdit();
    fireEvent.change(input("Task"), { target: { value: "  Call Sam 📞  " } });
    fireEvent.change(input("Due date"), { target: { value: "2026-09-04" } });
    fireEvent.change(input("Due time"), { target: { value: "16:45" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
      target: { value: PROJECTS[1].id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent", "We couldn’t save this task. Your details are still here—try again.",
    );
    expect(input("Task").value).toBe("  Call Sam 📞  ");
    expect(input("Due date").value).toBe("2026-09-04");
    expect(input("Due time").value).toBe("16:45");
    expect((screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement).value).toBe(PROJECTS[1].id);
    expect(screen.queryByText(/postgres|secret detail/)).toBeNull();
    expect(input("Task").disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1][2].signal).not.toBe(onSave.mock.calls[0][2].signal);
  });

  it("locks controls and dismissal during save while preserving a focusable pending control", async () => {
    const result = deferred<void>();
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>(() => result.promise);
    render(<Harness onSave={onSave} />);
    openEdit();
    const form = input("Task").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    const pendingButton = screen.getByRole("button", { name: "Saving…" });
    expect(document.activeElement).toBe(pendingButton);
    expect(pendingButton.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Saving this task");
    for (const label of ["Task", "Due date", "Due time"]) expect(input(label).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(input("Task"), { target: { value: "Must not replace pending input" } });
    expect(input("Task").value).toBe(TODO.text);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.keyDown(pendingButton, { key: "Tab" });
    expect(document.activeElement).toBe(pendingButton);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][2].signal.aborted).toBe(false);
    await act(async () => { result.resolve(); await result.promise; });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("preserves an unavailable current project rather than clearing the association", async () => {
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>(async () => undefined);
    render(<Harness onSave={onSave} projects={[]} />);
    openEdit();
    const current = screen.getByRole("option", { name: "Current project (unavailable)" }) as HTMLOptionElement;
    expect(current.selected).toBe(true);
    expect(current.disabled).toBe(true);
    fireEvent.change(input("Task"), { target: { value: "Edited text only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][1].projectId).toBe(TODO.projectId);
  });

  it("keeps the draft when the same todo is refreshed", () => {
    const callbacks = { projects: PROJECTS, onSave: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<TodoEditDialog todo={TODO} {...callbacks} />);
    fireEvent.change(input("Task"), { target: { value: "Local draft" } });
    rerender(<TodoEditDialog todo={{ ...TODO, text: "Server refresh", dueDate: "2026-09-10" }} {...callbacks} />);
    expect(input("Task").value).toBe("Local draft");
    expect(input("Due date").value).toBe(TODO.dueDate);
  });

  it("aborts and ignores a late save after owner unmount", async () => {
    const result = deferred<void>();
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>(() => result.promise);
    const onClose = vi.fn();
    const { unmount } = render(<TodoEditDialog todo={TODO} projects={PROJECTS} onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    unmount();
    expect(onSave.mock.calls[0][2].signal.aborted).toBe(true);
    await act(async () => { result.resolve(); await result.promise; });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("starts a different todo cleanly and ignores the abandoned record's late save", async () => {
    const result = deferred<void>();
    const onSave = vi.fn<TodoEditDialogProps["onSave"]>(() => result.promise);
    const onClose = vi.fn();
    const callbacks = { projects: PROJECTS, onSave, onClose };
    const { rerender } = render(<TodoEditDialog todo={TODO} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const nextTodo = { ...TODO, id: "91fcb3b3-a344-4d47-a3a8-7f7b4f5dd27a", text: "Another todo" };
    rerender(<TodoEditDialog todo={nextTodo} {...callbacks} />);
    expect(onSave.mock.calls[0][2].signal.aborted).toBe(true);
    expect(input("Task").value).toBe(nextTodo.text);
    expect(input("Task").disabled).toBe(false);
    await act(async () => { result.resolve(); await result.promise; });
    expect(onClose).not.toHaveBeenCalled();
    expect(input("Task").value).toBe(nextTodo.text);
    expect(document.activeElement).toBe(input("Task"));
  });

  it("uses the workspace fallback after saving removes the original opener", async () => {
    render(<Harness onSave={async () => undefined} removeOpenerOnSave />);
    openEdit();
    fireEvent.change(input("Due date"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "Open edit" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("Todo workspace")));
  });

  it("does not take focus from a newer interaction when save removes the opener", async () => {
    const result = deferred<void>();
    render(<Harness onSave={() => result.promise} removeOpenerOnSave />);
    openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const external = screen.getByRole("textbox", { name: "Newer interaction" });
    external.focus();
    await act(async () => { result.resolve(); await result.promise; });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(external);
  });
});

it("retains unavailable class context and clears it atomically when choosing a project", async () => {
  const onSave = vi.fn(async () => undefined);
  render(<TodoEditDialog todo={{ ...TODO, projectId: null, classId: "math", assignmentType: "Quiz", dueTime: null }} projects={PROJECTS} onSave={onSave} onClose={vi.fn()} />);
  expect((screen.getByLabelText("Class") as HTMLSelectElement).value).toBe("math");
  expect((screen.getByLabelText("Assignment type") as HTMLSelectElement).value).toBe("Quiz");
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: PROJECTS[0].id } });
  expect(screen.queryByLabelText("Assignment type")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(TODO.id, { text: TODO.text, projectId: PROJECTS[0].id, classId: null, assignmentType: "", dueDate: TODO.dueDate, dueTime: null }, { signal: expect.any(AbortSignal) }));
});

it("assigns an ordinary task to a class with no synthetic due time", async () => {
  const onSave = vi.fn(async () => undefined);
  render(<TodoEditDialog todo={{ ...TODO, dueTime: null }} projects={PROJECTS} classes={[{ id: "math", name: "Math" }]} onSave={onSave} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: "math" } });
  fireEvent.change(screen.getByLabelText("Assignment type"), { target: { value: "Homework" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(TODO.id, { text: TODO.text, projectId: null, classId: "math", assignmentType: "Homework", dueDate: TODO.dueDate, dueTime: null }, { signal: expect.any(AbortSignal) }));
});
