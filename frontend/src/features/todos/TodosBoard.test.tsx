// @vitest-environment happy-dom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "../../types/domain";
import { buildTodoBoardModel } from "./todoBoardModel";
import { TodosBoard, type TodosBoardProps } from "./TodosBoard";

const TODO: Todo = {
  id: "todo-one",
  text: "Prepare review",
  completed: false,
  completedAt: null,
  dueDate: "2026-09-02",
  dueTime: "14:30:00",
  projectId: "project-a",
  todayRank: null,
  createdAt: "2026-09-01T14:00:00.000000Z",
  updatedAt: "2026-09-01T14:00:00.000000Z",
};
const OVERDUE: Todo = { ...TODO, id: "todo-late", text: "Call the clinic", dueDate: "2026-08-30" };
const INBOX: Todo = {
  ...TODO,
  id: "todo-inbox",
  text: "Inbox note",
  dueDate: null,
  dueTime: null,
  projectId: null,
};

afterEach(() => cleanup());

function model(todos: readonly Todo[] = [TODO, OVERDUE, INBOX]) {
  return buildTodoBoardModel(todos, "2026-08-31", "2026-09-02");
}

function props(overrides: Partial<TodosBoardProps> = {}): TodosBoardProps {
  return {
    model: model(),
    projects: [{ id: "project-a", title: "Launch" }],
    onPreviousWeek: vi.fn(),
    onNextWeek: vi.fn(),
    onToday: vi.fn(),
    onRetry: vi.fn(),
    onAddTodo: vi.fn(),
    onToggleComplete: vi.fn(() => true),
    onEditTodo: vi.fn(),
    onDeleteTodo: vi.fn(() => true),
    onUndoDelete: vi.fn(),
    onDismissUndo: vi.fn(),
    ...overrides,
  };
}

/** Drives the board the way the controller does: pending, model change, then a settlement. */
function MutationHarness({
  status,
  optimistic = false,
}: {
  status: "succeeded" | "failed";
  optimistic?: boolean;
}) {
  const [todos, setTodos] = useState<Todo[]>([
    OVERDUE,
    { ...OVERDUE, id: "todo-next", text: "Next overdue", dueDate: "2026-08-31" },
  ]);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<TodosBoardProps["mutationResult"]>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTodos((current) =>
            status === "failed"
              ? [OVERDUE, ...current.filter((todo) => todo.id !== OVERDUE.id)]
              : current.filter((todo) => todo.id !== OVERDUE.id),
          );
          setPending(new Set());
          setResult({ sequence: 1, todoId: OVERDUE.id, action: "delete", status });
        }}
      >
        Settle
      </button>
      <TodosBoard
        {...props({
          model: model(todos),
          pendingTodoIds: pending,
          mutationResult: result,
          onDeleteTodo: (todo) => {
            setPending(new Set([todo.id]));
            if (optimistic)
              setTodos((current) => current.filter((candidate) => candidate.id !== todo.id));
            return true;
          },
        })}
      />
    </>
  );
}

describe("TodosBoard", () => {
  it("renders Inbox, Overdue, and the current-week remainder with task context", () => {
    render(<TodosBoard {...props()} />);
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings.slice(0, 3)).toEqual(["Inbox", "Overdue", expect.stringContaining("· Today")]);
    // The current week starts at today (Wednesday): Wed through Sun.
    expect(headings).toHaveLength(2 + 5);
    const overdue = screen.getByRole("region", { name: "Overdue" });
    expect(within(overdue).getByText("Due Aug 30")).toBeTruthy();
    expect(within(overdue).getByText("2:30 PM")).toBeTruthy();
    expect(within(overdue).getByText("Launch")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Mark as complete Call the clinic" })).toBeTruthy();
    expect(screen.queryByText(/nothing due/i)).toBeNull();
  });

  it("routes week navigation, retry, and date-prefilled Add actions", () => {
    const callbacks = props({ loadStatus: "error" });
    render(<TodosBoard {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getByRole("button", { name: "Add task to Inbox" }));
    fireEvent.click(screen.getByRole("button", { name: /Add task to .*Today/ }));
    expect(callbacks.onPreviousWeek).toHaveBeenCalledOnce();
    expect(callbacks.onNextWeek).toHaveBeenCalledOnce();
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
    expect(callbacks.onAddTodo).toHaveBeenNthCalledWith(1, null);
    expect(callbacks.onAddTodo).toHaveBeenNthCalledWith(2, "2026-09-02");
    expect(screen.getByRole("alert").textContent).toContain("Tasks could not be loaded");
    expect(screen.getByRole("button", { name: "Today" }).hasAttribute("disabled")).toBe(true);
  });

  it("exposes complete, edit, and delete intents and locks a pending row", () => {
    const callbacks = props({ pendingTodoIds: new Set([INBOX.id]) });
    render(<TodosBoard {...callbacks} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark as complete Prepare review" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Prepare review" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Prepare review" }));
    expect(callbacks.onToggleComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: TODO.id }),
    );
    expect(callbacks.onEditTodo).toHaveBeenCalledWith(expect.objectContaining({ id: TODO.id }));
    expect(callbacks.onDeleteTodo).toHaveBeenCalledWith(expect.objectContaining({ id: TODO.id }));
    const inbox = screen.getByRole("checkbox", {
      name: "Mark as complete Inbox note",
    }) as HTMLInputElement;
    expect(inbox.disabled).toBe(true);
    expect(inbox.closest("article")?.getAttribute("aria-busy")).toBe("true");
  });

  it("shows loading, mutation errors, and the announcement live region", () => {
    const view = render(
      <TodosBoard
        {...props({
          loadStatus: "loading",
          announcement: { sequence: 1, message: "Prepare review completed." },
        })}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Loading tasks");
    expect(screen.getByText("Prepare review completed.")).toBeTruthy();
    view.rerender(
      <TodosBoard
        {...props({
          mutationError: "completion_failed",
          announcement: { sequence: 2, message: "hidden" },
        })}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("completion change was not saved");
    expect(screen.queryByText("hidden")).toBeNull();
  });

  it("offers an Undo surface that guards duplicate restoration while pending", () => {
    const callbacks = props({
      undoNotice: { todoId: TODO.id, todoText: TODO.text, pending: false, error: null },
    });
    const view = render(<TodosBoard {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss undo" }));
    expect(callbacks.onUndoDelete).toHaveBeenCalledOnce();
    expect(callbacks.onDismissUndo).toHaveBeenCalledOnce();
    view.rerender(
      <TodosBoard
        {...callbacks}
        undoNotice={{
          todoId: TODO.id,
          todoText: TODO.text,
          pending: true,
          error: "Try Undo again.",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restoring…" }));
    expect(callbacks.onUndoDelete).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert").textContent).toBe("Try Undo again.");
  });

  it("moves focus to the adjacent task once a deletion settles", () => {
    render(<MutationHarness status="succeeded" />);
    const remove = screen.getByRole("button", { name: "Delete Call the clinic" });
    remove.focus();
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: "Settle" }));
    expect(document.activeElement).toBe(
      screen.getByRole("checkbox", { name: "Mark as complete Next overdue" }),
    );
  });

  it("returns focus to a row restored by a failed optimistic deletion", () => {
    render(<MutationHarness status="failed" optimistic />);
    const remove = screen.getByRole("button", { name: "Delete Call the clinic" });
    remove.focus();
    fireEvent.click(remove);
    expect(screen.queryByText("Call the clinic")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Settle" }));
    expect(document.activeElement).toBe(
      screen.getByRole("checkbox", { name: "Mark as complete Call the clinic" }),
    );
  });

  it("never steals focus from a newer control while a mutation settles", () => {
    render(
      <>
        <input aria-label="Elsewhere" />
        <MutationHarness status="succeeded" />
      </>,
    );
    const remove = screen.getByRole("button", { name: "Delete Call the clinic" });
    remove.focus();
    fireEvent.click(remove);
    screen.getByLabelText("Elsewhere").focus();
    fireEvent.click(screen.getByRole("button", { name: "Settle" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Elsewhere"));
  });
});
