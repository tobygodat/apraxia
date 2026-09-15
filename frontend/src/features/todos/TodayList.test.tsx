// @vitest-environment happy-dom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TodayTodo } from "../../types/domain";
import { TodayList, type TodayListProps } from "./TodayList";
import { buildTodayListModel } from "./todayListModel";
import type { TodayListViewState } from "./todoViews";

afterEach(() => cleanup());

function todo(id: string, overrides: Partial<TodayTodo> = {}): TodayTodo {
  const todayRank = overrides.todayRank ?? null;
  return {
    id,
    text: id,
    completed: false,
    completedAt: null,
    dueDate: "2026-09-02",
    dueTime: null,
    projectId: null,
    projectTitle: null,
    todayRank,
    isOverdue: false,
    isManuallyOrdered: todayRank !== null,
    createdAt: "2026-09-01T12:00:00.000000Z",
    updatedAt: "2026-09-01T12:00:00.000000Z",
    ...overrides,
  };
}

function state(
  todos: readonly TodayTodo[],
  overrides: Partial<TodayListViewState> = {},
): TodayListViewState {
  return {
    loadStatus: "ready",
    model: buildTodayListModel(todos, "2026-09-02"),
    loadError: null,
    mutationError: null,
    pendingMutation: null,
    undoNotice: null,
    announcement: { sequence: 0, message: "" },
    ...overrides,
  };
}

const ROWS = [
  todo("older", {
    text: "Call the clinic",
    dueDate: "2026-08-25",
    isOverdue: true,
    projectTitle: "Health",
  }),
  todo("today", { text: "Prepare review", dueTime: "14:30:00" }),
];

function props(overrides: Partial<TodayListProps> = {}): TodayListProps {
  return {
    state: state(ROWS),
    onRetry: vi.fn(),
    onAddTodo: vi.fn(),
    onCompleteTodo: vi.fn(),
    onEditTodo: vi.fn(),
    onDeleteTodo: vi.fn(),
    onUndoDelete: vi.fn(),
    onDismissUndo: vi.fn(),
    onMoveTodo: vi.fn(),
    onPlaceTodo: vi.fn(),
    ...overrides,
  };
}

function CompletionHarness() {
  const [todos, setTodos] = useState([
    todo("a-first", { text: "First task" }),
    todo("b-second", { text: "Second task" }),
  ]);
  return (
    <TodayList
      {...props({
        state: state(todos),
        onCompleteTodo: (id) => setTodos((current) => current.filter((row) => row.id !== id)),
      })}
    />
  );
}

describe("TodayList", () => {
  it("renders original past-due dates in red without an Overdue prefix or count", () => {
    render(<TodayList {...props()} />);
    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy();
    expect(screen.queryByText(/overdue/i)).toBeNull();
    const items = screen.getAllByRole("listitem");
    const pastDate = within(items[0]!).getByText("Tue, Aug 25");
    expect(pastDate.getAttribute("datetime")).toBe("2026-08-25");
    expect(items[0]!.className).toContain("today-list-item--overdue");
    expect(items[1]!.className).not.toContain("today-list-item--overdue");
    expect(within(items[0]!).getByText("Health").className).toBe("todo-source-chip");
    expect(within(items[1]!).getByText("Due today · Wed, Sep 2")).toBeTruthy();
    expect(within(items[1]!).getByText("2:30 PM")).toBeTruthy();
  });

  it("exposes completion, editing, deletion, and Add intents", () => {
    const callbacks = props();
    render(<TodayList {...callbacks} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Call the clinic/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Call the clinic" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Call the clinic" }));
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(callbacks.onCompleteTodo).toHaveBeenCalledWith("older");
    expect(callbacks.onEditTodo).toHaveBeenCalledWith(expect.objectContaining({ id: "older" }));
    expect(callbacks.onDeleteTodo).toHaveBeenCalledWith(expect.objectContaining({ id: "older" }));
    expect(callbacks.onAddTodo).toHaveBeenCalledOnce();
  });

  it("provides keyboard reorder with boundaries and keeps the handle focused", () => {
    const callbacks = props();
    render(<TodayList {...callbacks} />);
    const first = screen.getByRole("button", { name: "Reorder Call the clinic" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Prepare review" }), {
      key: "ArrowDown",
    });
    expect(callbacks.onMoveTodo).toHaveBeenCalledTimes(1);
    expect(callbacks.onMoveTodo).toHaveBeenCalledWith("older", "down");
    expect(document.activeElement).toBe(first);
  });

  it("converts pointer drop position into a before/after placement without exporting identities", () => {
    const callbacks = props();
    render(<TodayList {...callbacks} />);
    const [source, target] = screen.getAllByRole("listitem");
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(source!, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "orbitos-today-reorder");
    vi.spyOn(target!, "getBoundingClientRect").mockReturnValue({ top: 100, height: 40 } as DOMRect);
    // The pointer (clientY 0 here) is above the row's midpoint: place before.
    fireEvent.dragOver(target!, { dataTransfer });
    expect(target!.className).toContain("today-list-item--drop-before");
    fireEvent.drop(target!, { dataTransfer });
    expect(callbacks.onPlaceTodo).toHaveBeenCalledWith("older", "today", "before");
    expect(target!.className).not.toContain("drop-before");
  });

  it("hides reorder handles and overdue framing for Tomorrow", () => {
    const onDayChange = vi.fn();
    render(
      <TodayList
        {...props({
          day: "Tomorrow",
          onDayChange,
          state: state([todo("t", { text: "Later", dueDate: "2026-09-02" })]),
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: /Reorder/ })).toBeNull();
    expect(screen.getByText("1 due tomorrow")).toBeTruthy();
    expect(screen.getByText("Due tomorrow · Wed, Sep 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onDayChange).toHaveBeenCalledWith("Today");
    expect(screen.getByRole("button", { name: "Tomorrow" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("keeps controls focusable but guards duplicate actions while a write is pending", () => {
    const callbacks = props({
      state: state(ROWS, { pendingMutation: { kind: "complete", todoId: "today" } }),
    });
    render(<TodayList {...callbacks} />);
    expect(
      screen
        .getByRole("region", { name: "Today task list" })
        .closest("section")
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: /Call the clinic/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Call the clinic" }));
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Prepare review" }), {
      key: "ArrowUp",
    });
    expect(callbacks.onCompleteTodo).not.toHaveBeenCalled();
    expect(callbacks.onDeleteTodo).not.toHaveBeenCalled();
    expect(callbacks.onAddTodo).not.toHaveBeenCalled();
    expect(callbacks.onMoveTodo).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add task" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("locks only another deletion while a settled Undo notice is available", () => {
    const callbacks = props({
      state: state(ROWS, {
        undoNotice: { todoId: "x", todoText: "Gone", pending: false, error: null },
      }),
    });
    render(<TodayList {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Call the clinic" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Call the clinic/ }));
    expect(callbacks.onDeleteTodo).not.toHaveBeenCalled();
    expect(callbacks.onCompleteTodo).toHaveBeenCalledWith("older");
    expect(
      screen.getByText("Gone deleted. Undo or dismiss before deleting another task."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Skip to Undo" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss undo" }));
    expect(callbacks.onUndoDelete).toHaveBeenCalledOnce();
    expect(callbacks.onDismissUndo).toHaveBeenCalledOnce();
  });

  it("shows retryable load errors, mutation errors, and a neutral updating state", () => {
    const callbacks = props({
      state: state([], { loadStatus: "error", loadError: "Today could not be loaded. Try again." }),
    });
    const view = render(<TodayList {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
    view.rerender(
      <TodayList
        {...callbacks}
        state={state([], {
          pendingMutation: { kind: "delete", todoId: "x" },
          mutationError: "That order was not saved.",
        })}
      />,
    );
    expect(screen.getByText("Updating Today…")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("That order was not saved.");
    view.rerender(<TodayList {...callbacks} state={state([])} />);
    expect(screen.getByText("Nothing is due yet.")).toBeTruthy();
  });

  it("re-mounts identical announcements when their sequence changes and mutes them behind errors", () => {
    const callbacks = props({
      state: state(ROWS, { announcement: { sequence: 1, message: "Saved." } }),
    });
    const view = render(<TodayList {...callbacks} />);
    const first = screen.getByText("Saved.");
    view.rerender(
      <TodayList
        {...callbacks}
        state={state(ROWS, { announcement: { sequence: 2, message: "Saved." } })}
      />,
    );
    expect(screen.getByText("Saved.")).not.toBe(first);
    view.rerender(
      <TodayList
        {...callbacks}
        state={state(ROWS, {
          announcement: { sequence: 3, message: "Saved." },
          mutationError: "Nope.",
        })}
      />,
    );
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("recovers focus to the next task after a completion removes the focused row", () => {
    render(<CompletionHarness />);
    const first = screen.getByRole("checkbox", { name: "Mark First task complete" });
    first.focus();
    fireEvent.click(first);
    expect(document.activeElement).toBe(
      screen.getByRole("checkbox", { name: "Mark Second task complete" }),
    );
  });
});

it("shows class and assignment type alongside the original red past-due date", () => {
  render(
    <TodayList
      {...props({
        state: state([
          todo("assignment", {
            classId: "math",
            className: "Math",
            assignmentType: "Homework",
            dueDate: "2026-08-25",
            isOverdue: true,
          }),
        ]),
      })}
    />,
  );
  expect(screen.getByText("Math · Homework").className).toBe("todo-source-chip");
  expect(screen.getByText("Math · Homework").closest("li")?.className).toContain("overdue");
});
