// @vitest-environment happy-dom

import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NewTodoInput, ProjectSummary } from "../../types/domain";
import {
  TodoComposerDialog,
  type TodoComposerDialogProps,
} from "./TodoComposerDialog";

const projects: readonly ProjectSummary[] = [
  { id: "5f8d7f2f-6807-4612-b7ee-6ddab6f8b476", title: "Home" },
  { id: "a8a06b7e-f0be-4f5d-b9a3-a4d263bc7371", title: "Launch" },
];

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

function Harness({
  onCreate,
  initialDueDate,
}: Pick<TodoComposerDialogProps, "onCreate" | "initialDueDate">) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Open composer
      </button>
      <TodoComposerDialog
        initialDueDate={initialDueDate}
        onClose={() => setOpen(false)}
        onCreate={onCreate}
        open={open}
        projects={projects}
      />
    </>
  );
}

function openComposer() {
  const opener = screen.getByRole("button", { name: "Open composer" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("TodoComposerDialog", () => {
  it("opens as a named modal and focuses the task field", () => {
    render(<Harness onCreate={vi.fn()} />);

    openComposer();

    expect(
      screen
        .getByRole("dialog", { name: "Add a task" })
        .getAttribute("aria-modal"),
    ).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Task" }),
    );
  });

  it("submits browser-safe values, closes, and restores focus", async () => {
    const onCreate = vi.fn<(input: NewTodoInput) => Promise<void>>(() =>
      Promise.resolve(),
    );
    render(
      <Harness initialDueDate="2026-09-03" onCreate={onCreate} />,
    );
    const opener = openComposer();

    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "  Send the brief  " },
    });
    fireEvent.change(screen.getByLabelText("Due time"), {
      target: { value: "09:30" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
      target: { value: projects[1].id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        {
          text: "Send the brief",
          dueDate: "2026-09-03",
          dueTime: "09:30",
          projectId: projects[1].id,
        },
        { signal: expect.any(AbortSignal) },
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(document.activeElement).toBe(opener);
  });

  it("cancels without creating and restores focus", () => {
    const onCreate = vi.fn();
    render(<Harness onCreate={onCreate} />);
    const opener = openComposer();

    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Keep this local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
  });

  it("closes with Escape and restores focus", () => {
    render(<Harness onCreate={vi.fn()} />);
    const opener = openComposer();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("shows inline errors and guards a time without a date", async () => {
    const onCreate = vi.fn();
    render(<Harness onCreate={onCreate} />);
    openComposer();

    fireEvent.change(screen.getByLabelText("Due time"), {
      target: { value: "14:15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(await screen.findByText("Enter a task.")).not.toBeNull();
    expect(
      screen.getByText("Add a due date before adding a due time."),
    ).not.toBeNull();
    expect((screen.getByLabelText("Due time") as HTMLInputElement).value).toBe(
      "14:15",
    );
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Task" }),
    );
    const taskField = screen.getByRole("textbox", { name: "Task" });
    const describedErrorId = taskField.getAttribute("aria-describedby");
    expect(describedErrorId).not.toBeNull();
    expect(document.getElementById(describedErrorId!)?.textContent).toBe(
      "Enter a task.",
    );

    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-09-03" },
    });
    expect(
      screen.queryByText("Add a due date before adding a due time."),
    ).toBeNull();
    expect(screen.getByLabelText("Due time").getAttribute("aria-invalid")).toBe(
      "false",
    );
    expect((screen.getByLabelText("Due time") as HTMLInputElement).value).toBe(
      "14:15",
    );
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("preserves exact values after a failed save and hides raw errors", async () => {
    const onCreate = vi.fn(() =>
      Promise.reject(new Error("postgres connection refused: secret detail")),
    );
    render(<Harness onCreate={onCreate} />);
    openComposer();

    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "  Call Sam 📞  " },
    });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-09-04" },
    });
    fireEvent.change(screen.getByLabelText("Due time"), {
      target: { value: "16:45" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
      target: { value: projects[0].id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(
      await screen.findByText(
        "We couldn’t add this task. Your details are still here—try again.",
      ),
    ).not.toBeNull();
    expect(
      (screen.getByRole("textbox", { name: "Task" }) as HTMLInputElement)
        .value,
    ).toBe("  Call Sam 📞  ");
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe(
      "2026-09-04",
    );
    expect((screen.getByLabelText("Due time") as HTMLInputElement).value).toBe(
      "16:45",
    );
    expect(
      (screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement)
        .value,
    ).toBe(projects[0].id);
    expect(screen.queryByText(/postgres|secret detail/i)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Add task" })
        .getAttribute("aria-disabled"),
    ).toBe("false");
    expect(
      (screen.getByRole("textbox", { name: "Task" }) as HTMLInputElement)
        .disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("allows only one create request while a save is pending", async () => {
    let finishCreate: (() => void) | undefined;
    const onCreate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCreate = resolve;
        }),
    );
    render(<Harness onCreate={onCreate} />);
    openComposer();
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Single request" },
    });
    const form = screen.getByRole("textbox", { name: "Task" }).closest("form");

    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("button", { name: "Adding…" })
        .getAttribute("aria-disabled"),
    ).toBe("true");

    finishCreate?.();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("locks editing and dismissal while creation is pending", async () => {
    let receivedSignal: AbortSignal | undefined;
    let finishCreate: (() => void) | undefined;
    const onCreate = vi.fn(
      (
        _input: NewTodoInput,
        options: { readonly signal: AbortSignal },
      ) => {
        receivedSignal = options.signal;
        return new Promise<void>((resolve) => {
          finishCreate = resolve;
        });
      },
    );
    render(<Harness onCreate={onCreate} />);
    const opener = openComposer();
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Cancelable request" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(receivedSignal?.aborted).toBe(false);
    expect(
      (screen.getByRole("textbox", { name: "Task" }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect((screen.getByLabelText("Due date") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText("Due time") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement)
        .disabled,
    ).toBe(true);

    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Adding…" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(cancel);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "Add a task" })).toBeTruthy();
    expect(receivedSignal?.aborted).toBe(false);

    finishCreate?.();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(receivedSignal?.aborted).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("ignores a late successful create after unmount even when the provider ignores abort", async () => {
    let finishCreate!: () => void;
    let receivedSignal: AbortSignal | undefined;
    const pendingCreate = new Promise<void>((resolve) => {
      finishCreate = resolve;
    });
    const onCreate = vi.fn<TodoComposerDialogProps["onCreate"]>(
      (_input, { signal }) => {
        receivedSignal = signal;
        return pendingCreate;
      },
    );
    const onClose = vi.fn();
    const { unmount } = render(
      <TodoComposerDialog open projects={projects} onCreate={onCreate} onClose={onClose} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Abandoned create" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(onCreate).toHaveBeenCalledOnce();

    unmount();
    expect(receivedSignal?.aborted).toBe(true);
    await act(async () => {
      finishCreate();
      await pendingCreate;
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

it("switches between project and class, keeping assignment type class-only", async () => {
  const onCreate = vi.fn(async () => undefined);
  render(<TodoComposerDialog open projects={projects} classes={[{ id: "math", name: "Math" }]} initialProjectId={projects[0].id} initialDueDate="2020-03-08" onCreate={onCreate} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Worksheet" } });
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: "math" } });
  expect((screen.getByLabelText("Project") as HTMLSelectElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("Assignment type"), { target: { value: "Quiz" } });
  fireEvent.change(screen.getByLabelText("Project"), { target: { value: projects[0].id } });
  expect((screen.getByLabelText("Class") as HTMLSelectElement).value).toBe("");
  expect(screen.queryByLabelText("Assignment type")).toBeNull();
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: "math" } });
  expect((screen.getByLabelText("Assignment type") as HTMLSelectElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("Assignment type"), { target: { value: "Reading" } });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ text: "Worksheet", projectId: null, classId: "math", assignmentType: "Reading", dueDate: "2020-03-08", dueTime: null }, { signal: expect.any(AbortSignal) }));
});
