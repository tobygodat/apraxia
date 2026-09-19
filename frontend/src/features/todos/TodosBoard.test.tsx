// @vitest-environment happy-dom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "../../types/domain";
import { buildTodoBoardModel } from "./todoBoardModel";
import { TodosBoard, type TodosBoardProps } from "./TodosBoard";
import { ColdLoadGate } from "../../apps/coldLoad";

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
  return buildTodoBoardModel(todos, "2026-08-30", "2026-09-02");
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
  it("runs Sunday to Saturday, then the overdue pile, then Inbox", () => {
    render(<TodosBoard {...props()} />);
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    // The week reads in calendar order; today is marked where it falls. The
    // grid's own heading opens the list, and the two piles close it.
    // Each day heading prints "Sun 30" and carries the whole date for a screen
    // reader, since two letters and a number do not read as a day out loud.
    expect(headings).toEqual([
      "This week",
      "Sun 30Sunday, August 30",
      "Mon 31Monday, August 31",
      "Tue 1Tuesday, September 1",
      "Wed 2Wednesday, September 2 · Today",
      "Thu 3Thursday, September 3 · Tomorrow",
      "Fri 4Friday, September 4",
      "Sat 5Saturday, September 5",
      "Overdue",
      "Inbox",
    ]);
    const today = screen.getByRole("region", { name: /· Today$/ });
    // The marker is CSS-only, so the class is what a test can hold onto.
    expect(today.classList.contains("todos-board-column--today")).toBe(true);
    expect(within(today).getByText(TODO.text)).toBeTruthy();
    expect(within(today).getByText("2:30 PM")).toBeTruthy();
    expect(within(today).getByText("Launch").className).toBe("todo-source-chip");
    // The overdue row is in the pile and nowhere else, with the day it was due
    // and how late it is.
    const overdue = screen.getByRole("region", { name: "Overdue" });
    expect(within(overdue).getByText("Was due Sun, Aug 30").getAttribute("datetime")).toBe(
      "2026-08-30",
    );
    expect(within(overdue).getByText("3 days late")).toBeTruthy();
    expect(within(today).queryByText(OVERDUE.text)).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Mark as complete Call the clinic" })).toBeTruthy();
    // Five of the seven days hold nothing, and each says so.
    expect(screen.getAllByText("Nothing due.")).toHaveLength(6);
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
    expect(screen.getByRole("button", { name: "This week" }).hasAttribute("disabled")).toBe(true);
  });

  it("exposes complete, edit, and delete intents and locks a pending row", () => {
    const callbacks = props({ pendingTodoIds: new Set([INBOX.id]) });
    render(<TodosBoard {...callbacks} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark as complete Prepare review" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Prepare review" }));
    // A row in the week grid carries "edit" alone; deleting is offered in the
    // two piles, where a task has already fallen out of the week.
    expect(screen.queryByRole("button", { name: "Delete Prepare review" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete Call the clinic" }));
    expect(callbacks.onToggleComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: TODO.id }),
    );
    expect(callbacks.onEditTodo).toHaveBeenCalledWith(expect.objectContaining({ id: TODO.id }));
    expect(callbacks.onDeleteTodo).toHaveBeenCalledWith(
      expect.objectContaining({ id: OVERDUE.id }),
    );
    const inbox = screen.getByRole("checkbox", {
      name: "Mark as complete Inbox note",
    }) as HTMLInputElement;
    expect(inbox.disabled).toBe(true);
    expect(inbox.closest("article")?.getAttribute("aria-busy")).toBe("true");
  });

  it("stays cold-load pending until the board has loaded, then reveals", async () => {
    const { container, rerender } = render(
      <ColdLoadGate>
        <TodosBoard {...props({ loadStatus: "loading", loaded: false })} />
      </ColdLoadGate>,
    );
    expect(container.querySelector(".cold-load")?.getAttribute("data-cold")).toBe("true");
    rerender(
      <ColdLoadGate>
        <TodosBoard {...props({ loadStatus: "ready", loaded: true })} />
      </ColdLoadGate>,
    );
    // The gate defers its reveal to a rAF/timeout check that pending is still zero.
    await waitFor(() =>
      expect(container.querySelector(".cold-load")?.getAttribute("data-cold")).toBeNull(),
    );
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
    view.rerender(<TodosBoard {...props({ loadStatus: "loading", loaded: true })} />);
    expect(screen.queryByText("Loading tasks…")).toBeNull();
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

  it("refuses a second delete while an Undo notice is open, and says so", () => {
    const callbacks = props({
      undoNotice: { todoId: TODO.id, todoText: TODO.text, pending: false, error: null },
    });
    render(<TodosBoard {...callbacks} />);

    const remove = screen.getByRole("button", { name: "Delete Call the clinic" });
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(remove);
    expect(callbacks.onDeleteTodo).not.toHaveBeenCalled();

    const describedBy = remove.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain(
      "Undo or dismiss before deleting another task",
    );
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

it("filters all sources across Inbox and date columns and labels source chips", () => {
  const rows = [
    { ...TODO, projectId: null },
    { ...TODO, id: "project", text: "Project task", projectId: "p" },
    {
      ...TODO,
      id: "class",
      text: "Worksheet",
      projectId: null,
      classId: "math",
      className: "Math",
      assignmentType: "Quiz",
      dueDate: "2026-09-01",
    },
    {
      ...TODO,
      id: "inbox",
      text: "Reading",
      projectId: null,
      classId: "math",
      className: "Math",
      assignmentType: "Reading",
      dueDate: null,
      dueTime: null,
    },
  ];
  render(
    <TodosBoard
      {...props({
        projects: [{ id: "p", title: "Studio" }],
        model: buildTodoBoardModel(rows, "2026-08-30", "2026-09-02"),
      })}
    />,
  );
  expect(screen.getByText("Math · Quiz").className).toBe("todo-source-chip");
  expect(screen.getByText("Studio").className).toBe("todo-source-chip");
  const cases = [
    ["Classes", ["Worksheet", "Reading"]],
    ["Projects", ["Project task"]],
    ["Personal", [TODO.text]],
    ["All", rows.map((row) => row.text)],
  ] as const;
  const sources = within(screen.getByRole("navigation", { name: "Task source" }));
  for (const [source, visible] of cases) {
    fireEvent.click(sources.getByRole("button", { name: source }));
    expect(sources.getByRole("button", { name: source }).getAttribute("aria-pressed")).toBe("true");
    for (const row of rows) {
      expect(Boolean(screen.queryByText(row.text, { exact: true }))).toBe(
        (visible as readonly string[]).includes(row.text),
      );
    }
  }
  // The worksheet is a day past due, so it reads in the pile with its own date.
  expect(screen.getByText("Was due Tue, Sep 1")).toBeTruthy();
});

describe("TodosBoard one-tap move to today", () => {
  const LATER: Todo = { ...TODO, id: "todo-later", text: "Later this week", dueDate: "2026-09-05" };

  it("offers the move in the two piles only, and dates the task today", () => {
    const callbacks = props({
      model: model([TODO, OVERDUE, LATER, INBOX]),
      onRescheduleTodo: vi.fn(),
    });
    render(<TodosBoard {...callbacks} />);

    // Overdue and Inbox rows have fallen out of the week, so they carry it; a
    // row still sitting in a day column does not.
    for (const text of [OVERDUE.text, INBOX.text]) {
      expect(screen.getByLabelText(`Move ${text} to today`)).toBeTruthy();
    }
    for (const text of [TODO.text, LATER.text]) {
      expect(screen.queryByLabelText(`Move ${text} to today`)).toBeNull();
    }

    fireEvent.click(screen.getByLabelText(`Move ${OVERDUE.text} to today`));
    expect(callbacks.onRescheduleTodo).toHaveBeenCalledWith(
      expect.objectContaining({ id: OVERDUE.id }),
      "2026-09-02",
    );
  });

  it("hides the action on completed rows and while the row has a write in flight", () => {
    render(
      <TodosBoard
        {...props({
          model: model([{ ...OVERDUE, completed: true }, INBOX]),
          pendingTodoIds: new Set([INBOX.id]),
          onRescheduleTodo: vi.fn(),
        })}
      />,
    );

    expect(screen.queryByLabelText(`Move ${OVERDUE.text} to today`)).toBeNull();
    expect(screen.getByLabelText<HTMLButtonElement>(`Move ${INBOX.text} to today`).disabled).toBe(
      true,
    );
  });

  it("leaves the action out entirely when the board cannot reschedule", () => {
    render(<TodosBoard {...props()} />);
    expect(screen.queryByLabelText(`Move ${OVERDUE.text} to today`)).toBeNull();
  });

  /** Mirrors the controller: pending plus an optimistic move, then a settlement. */
  function DeferHarness({ status }: { status: "succeeded" | "failed" }) {
    const original = [
      OVERDUE,
      { ...OVERDUE, id: "todo-next", text: "Next overdue", dueDate: "2026-08-31" },
    ];
    const [todos, setTodos] = useState<Todo[]>(original);
    const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
    return (
      <>
        <button
          type="button"
          onClick={() => {
            if (status === "failed") setTodos(original);
            setPending(new Set());
          }}
        >
          Settle
        </button>
        <TodosBoard
          {...props({
            model: buildTodoBoardModel(todos, "2026-08-30", "2026-09-02"),
            pendingTodoIds: pending,
          })}
          onRescheduleTodo={(todo, dueDate) => {
            setPending(new Set([todo.id]));
            setTodos((current) =>
              current.map((candidate) =>
                candidate.id === todo.id ? { ...candidate, dueDate } : candidate,
              ),
            );
          }}
        />
      </>
    );
  }

  function deferOverdue() {
    const action = screen.getByLabelText<HTMLButtonElement>(`Move ${OVERDUE.text} to today`);
    action.focus();
    fireEvent.click(action);
  }

  it("hands keyboard focus to the next row once the rescheduled row leaves the column", () => {
    render(<DeferHarness status="succeeded" />);
    deferOverdue();
    const nextRow = screen.getByText("Next overdue").closest("article")!;
    expect(nextRow.contains(document.activeElement)).toBe(true);

    fireEvent.click(screen.getByText("Settle"));
    expect(nextRow.contains(document.activeElement)).toBe(true);
  });

  it("returns focus to the row when the reschedule rolls back", () => {
    render(<DeferHarness status="failed" />);
    deferOverdue();
    expect(
      screen.getByText("Next overdue").closest("article")!.contains(document.activeElement),
    ).toBe(true);

    fireEvent.click(screen.getByText("Settle"));
    const restored = screen.getByText(OVERDUE.text).closest("article")!;
    expect(restored.contains(document.activeElement)).toBe(true);
  });
});

describe("TodosBoard overdue count", () => {
  it("counts the open past-due pile and follows the source filter", () => {
    render(<TodosBoard {...props()} />);

    expect(screen.getByText("1 overdue")).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Task source" })).getByRole("button", {
        name: "Classes",
      }),
    );
    expect(screen.queryByText(/overdue$/)).toBeNull();
  });

  it("says nothing when nothing is overdue", () => {
    render(<TodosBoard {...props({ model: model([TODO, INBOX]) })} />);
    expect(screen.queryByText(/overdue$/)).toBeNull();
  });
});

describe("TodosBoard drag to reschedule", () => {
  function dataTransferStub() {
    const store = new Map<string, string>();
    return {
      types: [] as string[],
      effectAllowed: "none",
      dropEffect: "none",
      setData(type: string, value: string) {
        store.set(type, value);
        if (!this.types.includes(type)) this.types.push(type);
      },
      getData(type: string) {
        return store.get(type) ?? "";
      },
    };
  }

  it("reschedules a row dropped onto a different day column", () => {
    const callbacks = props({ onRescheduleTodo: vi.fn() });
    render(<TodosBoard {...callbacks} />);
    const row = screen.getByText(TODO.text).closest("article")!;
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(row, { dataTransfer });
    const targetHeading = screen.getAllByRole("heading", { level: 2 })[1]!;
    const targetColumn = targetHeading.closest("section")!;
    fireEvent.dragOver(targetColumn, { dataTransfer });
    fireEvent.drop(targetColumn, { dataTransfer });
    expect(callbacks.onRescheduleTodo).toHaveBeenCalledOnce();
    const [droppedTodo, dueDate] = (callbacks.onRescheduleTodo as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(droppedTodo.id).toBe(TODO.id);
    expect(dueDate).not.toBeNull();
    expect(dueDate).not.toBe(TODO.dueDate);
  });

  it("reschedules a row dropped onto the Inbox as null", () => {
    const callbacks = props({ onRescheduleTodo: vi.fn() });
    render(<TodosBoard {...callbacks} />);
    const row = screen.getByText(TODO.text).closest("article")!;
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(row, { dataTransfer });
    const inboxSection = screen.getByRole("heading", { name: "Inbox" }).closest("section")!;
    fireEvent.dragOver(inboxSection, { dataTransfer });
    fireEvent.drop(inboxSection, { dataTransfer });
    expect(callbacks.onRescheduleTodo).toHaveBeenCalledWith(
      expect.objectContaining({ id: TODO.id }),
      null,
    );
  });

  it("does not reschedule when dropped on the same column", () => {
    const callbacks = props({ onRescheduleTodo: vi.fn() });
    render(<TodosBoard {...callbacks} />);
    const row = screen.getByText(TODO.text).closest("article")!;
    const dataTransfer = dataTransferStub();
    fireEvent.dragStart(row, { dataTransfer });
    const ownColumn = row.closest("section")!;
    fireEvent.dragOver(ownColumn, { dataTransfer });
    fireEvent.drop(ownColumn, { dataTransfer });
    expect(callbacks.onRescheduleTodo).not.toHaveBeenCalled();
  });

  it("does not reschedule an overdue row dropped back onto its own pile, but does onto a day", () => {
    const callbacks = props({ onRescheduleTodo: vi.fn() });
    render(<TodosBoard {...callbacks} />);
    const row = screen.getByText(OVERDUE.text).closest("article")!;
    const pile = screen.getByRole("region", { name: "Overdue" });
    let dataTransfer = dataTransferStub();
    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.dragOver(pile, { dataTransfer });
    fireEvent.drop(pile, { dataTransfer });
    expect(callbacks.onRescheduleTodo).not.toHaveBeenCalled();

    dataTransfer = dataTransferStub();
    fireEvent.dragStart(row, { dataTransfer });
    const friday = screen.getByRole("region", { name: "Friday, September 4" });
    fireEvent.dragOver(friday, { dataTransfer });
    fireEvent.drop(friday, { dataTransfer });
    expect(callbacks.onRescheduleTodo).toHaveBeenCalledOnce();
    const [droppedTodo, dueDate] = (callbacks.onRescheduleTodo as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(droppedTodo.id).toBe(OVERDUE.id);
    expect(dueDate).toBe("2026-09-04");
  });
});

it("returns the board to its first column when the visible week changes", () => {
  const boardProps = props();
  const { rerender } = render(<TodosBoard {...boardProps} />);
  const region = screen.getByRole("region", { name: "Tasks by date" });

  region.scrollLeft = 900;
  expect(region.scrollLeft).toBe(900);

  // A narrow window scrolls the week sideways. Stepping to another week has to
  // return to its first day rather than leaving the user where they were.
  rerender(
    <TodosBoard
      {...boardProps}
      model={buildTodoBoardModel([TODO, OVERDUE, INBOX], "2026-09-06", "2026-09-02")}
    />,
  );

  expect(screen.getAllByRole("heading", { level: 2 })[1]?.textContent).toContain(
    "Sunday, September 6",
  );
  expect(region.scrollLeft).toBe(0);
});

describe("TodosBoard repeat marker", () => {
  const REPEATING: Todo = {
    ...TODO,
    id: "todo-repeating",
    text: "Problem set",
    recurrence: { freq: "weekly", interval: 2, until: null },
  };

  it("marks a repeating task and leaves an ordinary one unmarked", () => {
    render(
      <ColdLoadGate>
        <TodosBoard {...props({ model: model([TODO, REPEATING]) })} />
      </ColdLoadGate>,
    );
    const repeating = screen.getByRole("article", { name: REPEATING.text });
    expect(within(repeating).getByText("Every 2 weeks")).toBeTruthy();
    // The glyph carries no meaning on its own, so the row spells the rule out.
    expect(within(repeating).getByText("Repeats every 2 weeks.")).toBeTruthy();
    expect(
      within(screen.getByRole("article", { name: TODO.text })).queryByText(/repeats/i),
    ).toBeNull();
  });
});
