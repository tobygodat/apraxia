// @vitest-environment happy-dom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TodayTodo } from "../../types/domain";
import { TodayList, type TodayListProps } from "./TodayList";
import type { TodayListControllerState } from "./todayListController";
import { buildTodayListModel } from "./todayListModel";

afterEach(() => cleanup());

function todo(
  id: string,
  overrides: Partial<TodayTodo> = {},
): TodayTodo {
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

function controllerState(
  todos: readonly TodayTodo[],
  overrides: Partial<TodayListControllerState> = {},
): TodayListControllerState {
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

function props(overrides: Partial<TodayListProps> = {}): TodayListProps {
  return {
    state: controllerState([
      todo("older", {
        text: "Call the clinic",
        dueDate: "2026-08-25",
        isOverdue: true,
        projectTitle: "Health",
      }),
      todo("today", {
        text: "Prepare review",
        dueTime: "14:30:00",
      }),
    ]),
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

function undoNotice(overrides: Partial<NonNullable<TodayListControllerState["undoNotice"]>> = {}) {
  return {
    todoId: "a-first",
    todoText: "First task",
    pending: false,
    error: null,
    ...overrides,
  };
}

function CompletionFocusHarness() {
  const [todos, setTodos] = useState([
    todo("a-first", { text: "First task" }),
    todo("b-second", { text: "Second task" }),
  ]);

  return (
    <TodayList
      {...props({
        state: controllerState(todos),
        onCompleteTodo: (todoId) => {
          setTodos((current) => current.filter(({ id }) => id !== todoId));
        },
      })}
    />
  );
}

describe("TodayList", () => {
  it("renders original past-due dates without an Overdue prefix or count", () => {
    render(<TodayList {...props()} />);

    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy();
    expect(screen.queryByText(/overdue/i)).toBeNull();
    const pastDate = screen.getByText("Tue, Aug 25");
    expect(pastDate.getAttribute("datetime")).toBe("2026-08-25");
    expect(pastDate.closest(".today-list-item--overdue")).toBeTruthy();
    expect(screen.getByText(/Due today ·/).closest(".today-list-item--overdue")).toBeNull();
    expect(screen.getByText(/Due today ·/)).toBeTruthy();
    expect(screen.getByText("2:30 PM").getAttribute("datetime")).toBe(
      "14:30:00",
    );
    expect(screen.getByText("Health")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Today tasks" })).toBeTruthy();
  });

  it("exposes completion, editing, rescheduling, deletion, and Add intents", () => {
    const callbacks = props();
    render(<TodayList {...callbacks} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Call the clinic/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Call the clinic" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Call the clinic" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(callbacks.onCompleteTodo).toHaveBeenCalledWith("older");
    expect(callbacks.onEditTodo).toHaveBeenCalledWith(
      expect.objectContaining({ id: "older" }),
      expect.any(Function),
    );
    expect(callbacks.onDeleteTodo).toHaveBeenCalledWith(
      expect.objectContaining({ id: "older" }),
    );
    expect(callbacks.onAddTodo).toHaveBeenCalledOnce();
  });

  it("provides keyboard Move up and Move down alternatives with boundaries", () => {
    const callbacks = props();
    render(<TodayList {...callbacks} />);

    const firstHandle = screen.getByRole("button", { name: "Reorder Call the clinic" });
    const lastHandle = screen.getByRole("button", { name: "Reorder Prepare review" });
    fireEvent.keyDown(firstHandle, { key: "ArrowUp" });
    fireEvent.keyDown(lastHandle, { key: "ArrowDown" });
    expect(callbacks.onMoveTodo).not.toHaveBeenCalled();
    fireEvent.keyDown(firstHandle, { key: "ArrowDown" });
    fireEvent.keyDown(lastHandle, { key: "ArrowUp" });

    expect(callbacks.onMoveTodo).toHaveBeenNthCalledWith(1, "older", "down");
    expect(callbacks.onMoveTodo).toHaveBeenNthCalledWith(2, "today", "up");
  });

  it("keeps the move control focused when its row reaches a boundary", () => {
    const first = todo("a-first", { text: "First task" });
    const second = todo("b-second", { text: "Second task" });
    let rerender!: ReturnType<typeof render>["rerender"];
    const callbacks = props({
      state: controllerState([first, second]),
      onMoveTodo: () => {
        rerender(
          <TodayList
            {...callbacks}
            state={controllerState([
              {
                ...second,
                todayRank: 1024,
                isManuallyOrdered: true,
              },
              {
                ...first,
                todayRank: 2048,
                isManuallyOrdered: true,
              },
            ])}
          />,
        );
      },
    });
    ({ rerender } = render(<TodayList {...callbacks} />));

    const moveUp = screen.getByRole("button", {
      name: "Reorder Second task",
    });
    moveUp.focus();
    fireEvent.keyDown(moveUp, { key: "ArrowUp" });

    const boundaryControl = screen.getByRole("button", {
      name: "Reorder Second task",
    });
    expect(boundaryControl.getAttribute("aria-disabled")).toBeNull();
    expect(document.activeElement).toBe(boundaryControl);
  });

  it("offers a stable focus fallback when future rescheduling removes its trigger", () => {
    const callbacks = props();
    const { rerender } = render(<TodayList {...callbacks} />);
    const reschedule = screen.getByRole("button", {
      name: "Edit Call the clinic",
    });
    reschedule.focus();
    fireEvent.click(reschedule);

    const returnFocus = vi.mocked(callbacks.onEditTodo).mock.calls[0]?.[1];
    rerender(
      <TodayList
        {...callbacks}
        state={controllerState([
          todo("today", { text: "Prepare review", dueTime: "14:30:00" }),
        ])}
      />,
    );
    returnFocus?.();

    expect(document.activeElement).toBe(
      screen.getByRole("checkbox", { name: /Prepare review/ }),
    );
  });

  it.each(["cancel", "success"] as const)(
    "returns focus to the invoking Edit control after %s when its row remains",
    (outcome) => {
      const callbacks = props();
      const { rerender } = render(<TodayList {...callbacks} />);
      const reschedule = screen.getByRole("button", {
        name: "Edit Call the clinic",
      });
      reschedule.focus();
      fireEvent.click(reschedule);

      const returnFocus = vi.mocked(callbacks.onEditTodo).mock.calls[0]?.[1];
      if (outcome === "success") {
        rerender(
          <TodayList
            {...callbacks}
            state={controllerState([
              todo("older", { text: "Call the clinic" }),
              todo("today", { text: "Prepare review", dueTime: "14:30:00" }),
            ])}
          />,
        );
      }
      reschedule.blur();
      returnFocus?.();

      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Edit Call the clinic" }),
      );
    },
  );

  it("recovers focus to the next task after immediate completion removal", () => {
    render(<CompletionFocusHarness />);
    const firstCheckbox = screen.getByRole("checkbox", { name: /First task/ });
    firstCheckbox.focus();
    fireEvent.click(firstCheckbox);

    expect(document.activeElement).toBe(
      screen.getByRole("checkbox", { name: /Second task/ }),
    );
  });

  it("keeps focus meaningful through pending completion and confirmed removal", () => {
    const first = todo("a-first", { text: "First task" });
    const second = todo("b-second", { text: "Second task" });
    let rerender!: ReturnType<typeof render>["rerender"];
    const callbacks = props({
      state: controllerState([first, second]),
      onCompleteTodo: () => {
        rerender(
          <TodayList
            {...callbacks}
            state={controllerState([second], {
              pendingMutation: { kind: "complete", todoId: first.id },
            })}
          />,
        );
      },
    });
    ({ rerender } = render(<TodayList {...callbacks} />));

    const firstCheckbox = screen.getByRole("checkbox", { name: /First task/ });
    firstCheckbox.focus();
    fireEvent.click(firstCheckbox);
    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Today task list" }),
    );

    rerender(<TodayList {...callbacks} state={controllerState([second])} />);
    expect(document.activeElement).toBe(
      screen.getByRole("checkbox", { name: /Second task/ }),
    );
  });

  it("returns focus to a restored task after pending completion rolls back", () => {
    const first = todo("a-first", { text: "First task" });
    const second = todo("b-second", { text: "Second task" });
    let rerender!: ReturnType<typeof render>["rerender"];
    const callbacks = props({
      state: controllerState([first, second]),
      onCompleteTodo: () => {
        rerender(
          <TodayList
            {...callbacks}
            state={controllerState([second], {
              pendingMutation: { kind: "complete", todoId: first.id },
            })}
          />,
        );
      },
    });
    ({ rerender } = render(<TodayList {...callbacks} />));

    const firstCheckbox = screen.getByRole("checkbox", { name: /First task/ });
    firstCheckbox.focus();
    fireEvent.click(firstCheckbox);
    rerender(
      <TodayList
        {...callbacks}
        state={controllerState([first, second], {
          mutationError: "The task is back in Today.",
        })}
      />,
    );

    expect(document.activeElement).toBe(
      screen.getByRole("checkbox", { name: /First task/ }),
    );
  });

  it.each(["success", "rollback"] as const)("recovers the owning Delete focus after %s", (outcome) => {
    const first = todo("a-first", { text: "First task" });
    const second = todo("b-second", { text: "Second task" });
    const callbacks = props({ state: controllerState([first, second]) });
    const { rerender } = render(<TodayList {...callbacks} />);
    const source = screen.getByRole("button", { name: "Delete First task" });
    source.focus();
    fireEvent.click(source);
    rerender(<TodayList {...callbacks} state={controllerState([second], {
      pendingMutation: { kind: "delete", todoId: first.id },
    })} />);
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Today task list" }));
    rerender(<TodayList {...callbacks} state={controllerState(
      outcome === "success" ? [second] : [first, second],
      outcome === "success" ? { undoNotice: undoNotice() } : { mutationError: "The task is back in Today." },
    )} />);
    expect(document.activeElement).toBe(outcome === "success"
      ? screen.getByRole("checkbox", { name: /Second task/ })
      : screen.getByRole("button", { name: "Delete First task" }));
  });

  it("focuses Add after deleting the final row without a pending render", () => {
    const first = todo("a-first", { text: "First task" });
    const callbacks = props({ state: controllerState([first]) });
    const { rerender } = render(<TodayList {...callbacks} />);
    const source = screen.getByRole("button", { name: "Delete First task" });
    source.focus();
    fireEvent.click(source);
    rerender(<TodayList {...callbacks} state={controllerState([], { undoNotice: undoNotice() })} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add task" }));
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it.each([
    ["complete", "success", "external"],
    ["complete", "rollback", "dialog"],
    ["delete", "success", "dialog"],
    ["delete", "rollback", "external"],
  ] as const)("does not steal focus from %s %s's newer %s interaction", (kind, outcome, destination) => {
    const first = todo("a-first", { text: "First task" });
    const second = todo("b-second", { text: "Second task" });
    const callbacks = props({ state: controllerState([first, second]) });
    const surface = (state: TodayListControllerState) => <>
      <button type="button">Global Add</button>
      <div role="dialog" aria-label="Another form"><input aria-label="Other draft" /></div>
      <TodayList {...callbacks} state={state} />
    </>;
    const { rerender } = render(surface(callbacks.state));
    const source = kind === "complete"
      ? screen.getByRole("checkbox", { name: /First task/ })
      : screen.getByRole("button", { name: "Delete First task" });
    source.focus();
    fireEvent.click(source);
    rerender(surface(controllerState([second], { pendingMutation: { kind, todoId: first.id } })));
    const newer = destination === "dialog"
      ? screen.getByRole("textbox", { name: "Other draft" })
      : screen.getByRole("button", { name: "Global Add" });
    newer.focus();
    rerender(surface(controllerState(outcome === "success" ? [second] : [first, second], {
      mutationError: outcome === "rollback" ? "The task is back in Today." : null,
      undoNotice: kind === "delete" && outcome === "success" ? undoNotice() : null,
    })));
    expect(document.activeElement).toBe(newer);
  });

  it.each(["complete", "delete"] as const)("relinquishes %s recovery even if newer focus is later lost", (kind) => {
    const first = todo("a-first", { text: "First task" });
    const second = todo("b-second", { text: "Second task" });
    const callbacks = props({ state: controllerState([first, second]) });
    const { rerender } = render(<TodayList {...callbacks} />);
    const source = kind === "complete"
      ? screen.getByRole("checkbox", { name: /First task/ })
      : screen.getByRole("button", { name: "Delete First task" });
    source.focus();
    fireEvent.click(source);
    rerender(<TodayList {...callbacks} state={controllerState([second], {
      pendingMutation: { kind, todoId: first.id },
    })} />);
    const newer = screen.getByRole("button", { name: "Add task" });
    newer.focus();
    newer.blur();
    rerender(<TodayList {...callbacks} state={controllerState([second])} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("locks only another deletion while a settled Undo notice is available", () => {
    const callbacks = props({ state: controllerState([
      todo("b-second", { text: "Second task" }),
      todo("c-third", { text: "Third task" }),
    ], { undoNotice: undoNotice() }) });
    render(<TodayList {...callbacks} />);
    const remove = screen.getByRole("button", { name: "Delete Second task" });
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(remove.getAttribute("aria-describedby")!)?.textContent)
      .toContain("Undo or dismiss before deleting another task.");
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole("checkbox", { name: /Second task/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Second task" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Second task" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(callbacks.onDeleteTodo).not.toHaveBeenCalled();
    expect(callbacks.onCompleteTodo).toHaveBeenCalledOnce();
    expect(callbacks.onEditTodo).toHaveBeenCalledOnce();
    expect(callbacks.onMoveTodo).toHaveBeenCalledOnce();
    expect(callbacks.onAddTodo).toHaveBeenCalledOnce();
  });

  it("waits for authoritative Undo restoration before moving focus to the restored row", () => {
    const second = todo("b-second", { text: "Second task" });
    const callbacks = props({ state: controllerState([second], { undoNotice: undoNotice() }) });
    const { rerender } = render(<TodayList {...callbacks} />);
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.focus();
    fireEvent.click(undo);
    expect(callbacks.onUndoDelete).toHaveBeenCalledOnce();
    rerender(<TodayList {...callbacks} state={controllerState([second], {
      pendingMutation: { kind: "restore", todoId: "a-first" },
      undoNotice: undoNotice({ pending: true }),
    })} />);
    const restoring = screen.getByRole("button", { name: "Restoring…" });
    expect(document.activeElement).toBe(restoring);
    expect(screen.queryByRole("checkbox", { name: /First task/ })).toBeNull();
    fireEvent.click(restoring);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss undo" }));
    expect(callbacks.onUndoDelete).toHaveBeenCalledOnce();
    expect(callbacks.onDismissUndo).not.toHaveBeenCalled();
    rerender(<TodayList {...callbacks} state={controllerState([
      todo("a-first", { text: "First task" }), second,
    ])} />);
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: /First task/ }));
  });

  it("keeps an Undo refresh failure retryable without moving focus or implying restoration in the list", () => {
    const second = todo("b-second", { text: "Second task" });
    const callbacks = props({ state: controllerState([second], { undoNotice: undoNotice() }) });
    const { rerender } = render(<TodayList {...callbacks} />);
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.focus();
    fireEvent.click(undo);
    const error = "The todo was restored, but Today could not refresh. Try Undo again to reload Today.";
    rerender(<TodayList {...callbacks} state={controllerState([second], {
      loadStatus: "error",
      undoNotice: undoNotice({ error }),
      announcement: { sequence: 1, message: error },
    })} />);
    expect(screen.getByRole("alert").textContent).toBe(error);
    expect(screen.getAllByText(error)).toHaveLength(1);
    expect(screen.queryByRole("checkbox", { name: /First task/ })).toBeNull();
    expect(document.activeElement).toBe(undo);
    expect(undo.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(undo);
    expect(callbacks.onUndoDelete).toHaveBeenCalledTimes(2);
  });

  it("does not steal newer focus when Undo finishes", () => {
    const second = todo("b-second", { text: "Second task" });
    const callbacks = props({ state: controllerState([second], { undoNotice: undoNotice() }) });
    const { rerender } = render(<TodayList {...callbacks} />);
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.focus();
    fireEvent.click(undo);
    rerender(<TodayList {...callbacks} state={controllerState([second], {
      pendingMutation: { kind: "restore", todoId: "a-first" },
      undoNotice: undoNotice({ pending: true }),
    })} />);
    const newer = screen.getByRole("button", { name: "Add task" });
    newer.focus();
    rerender(<TodayList {...callbacks} state={controllerState([
      todo("a-first", { text: "First task" }), second,
    ])} />);
    expect(document.activeElement).toBe(newer);
  });

  it.each([true, false])("returns focus after dismissing Undo when remaining rows exist: %s", (hasRows) => {
    const todos = hasRows ? [todo("b-second", { text: "Second task" })] : [];
    const callbacks = props({ state: controllerState(todos, { undoNotice: undoNotice() }) });
    const { rerender } = render(<TodayList {...callbacks} />);
    const dismiss = screen.getByRole("button", { name: "Dismiss undo" });
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(callbacks.onDismissUndo).toHaveBeenCalledOnce();
    rerender(<TodayList {...callbacks} state={controllerState(todos)} />);
    expect(document.activeElement).toBe(hasRows
      ? screen.getByRole("checkbox", { name: /Second task/ })
      : screen.getByRole("button", { name: "Add task" }));
  });

  it("keeps Undo outside the task scroller with a keyboard-reachable shortcut", () => {
    const manyTodos = Array.from({ length: 100 }, (_, index) => todo(`todo-${index}`));
    render(<TodayList {...props({ state: controllerState(manyTodos, { undoNotice: undoNotice() }) })} />);
    const scroller = screen.getByRole("region", { name: "Today task list" });
    const footer = screen.getByRole("group", { name: "Undo deletion" });
    expect(scroller.contains(footer)).toBe(false);
    expect(within(scroller).getAllByRole("listitem")).toHaveLength(100);
    const shortcut = screen.getByRole("link", { name: "Skip to Undo" });
    shortcut.focus();
    fireEvent.click(shortcut);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Undo" }));
  });

  it.each(["Edit"] as const)("provides a stable, non-stealing %s return-focus callback", (action) => {
    const callbacks = props();
    const { rerender } = render(<TodayList {...callbacks} />);
    const source = screen.getByRole("button", { name: `${action} Call the clinic` });
    expect(source.id).not.toBe("");
    source.focus();
    fireEvent.click(source);
    const callback = vi.mocked(callbacks.onEditTodo).mock.calls[0]?.[1];
    const newer = screen.getByRole("button", { name: "Add task" });
    newer.focus();
    newer.blur();
    rerender(<TodayList {...callbacks} state={controllerState([
      todo("today", { text: "Prepare review" }),
    ])} />);
    callback?.();
    expect(document.activeElement).toBe(document.body);
  });

  it("restores Edit focus after its modal closes, but never while that modal still owns focus", () => {
    const callbacks = props();
    render(<TodayList {...callbacks} />);
    const edit = screen.getByRole("button", { name: "Edit Call the clinic" });
    edit.focus();
    fireEvent.click(edit);
    const returnFocus = vi.mocked(callbacks.onEditTodo).mock.calls[0]?.[1];
    const modal = render(<div role="dialog" aria-label="Edit task"><input aria-label="Task draft" /></div>);
    const field = screen.getByRole("textbox", { name: "Task draft" });
    field.focus();
    returnFocus?.();
    expect(document.activeElement).toBe(field);
    modal.unmount();
    returnFocus?.();
    expect(document.activeElement).toBe(edit);
  });

  it("converts pointer drag position into an explicit before or after placement", () => {
    const callbacks = props();
    render(<TodayList {...callbacks} />);
    const rows = screen.getAllByRole("listitem");
    const dataTransfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: vi.fn(),
    };
    vi.spyOn(rows[1]!, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 100,
      height: 100,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.dragStart(rows[0]!, { dataTransfer });
    const dragOverEvent = new Event("dragover", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperties(dragOverEvent, {
      clientY: { value: 80 },
      dataTransfer: { value: dataTransfer },
    });
    fireEvent(rows[1]!, dragOverEvent);
    fireEvent.drop(rows[1]!, { clientY: 80, dataTransfer });

    expect(callbacks.onPlaceTodo).toHaveBeenCalledWith(
      "older",
      "today",
      "after",
    );
    expect(dataTransfer.setData).toHaveBeenCalledExactlyOnceWith("text/plain", "orbitos-today-reorder");
    expect(JSON.stringify(dataTransfer.setData.mock.calls)).not.toContain("older");
  });

  it("exports no record identifier or task text during drag and ignores external payload identities", () => {
    const sourceId = "7c630b57-bd92-4cc3-b349-530de6f28c7a";
    const targetId = "91fcb3b3-a344-4d47-a3a8-7f7b4f5dd27a";
    const callbacks = props({ state: controllerState([
      todo(sourceId, { text: "Private task text" }),
      todo(targetId, { text: "Another private task" }),
    ]) });
    render(<TodayList {...callbacks} />);
    const rows = screen.getAllByRole("listitem");
    const dataTransfer = { effectAllowed: "none", setData: vi.fn(), getData: vi.fn(() => sourceId) };
    fireEvent.drop(rows[1]!, { dataTransfer });
    expect(callbacks.onPlaceTodo).not.toHaveBeenCalled();
    expect(dataTransfer.getData).not.toHaveBeenCalled();
    fireEvent.dragStart(rows[0]!, { dataTransfer });
    expect(dataTransfer.setData.mock.calls).toEqual([["text/plain", "orbitos-today-reorder"]]);
    const exported = JSON.stringify(dataTransfer.setData.mock.calls);
    expect(exported).not.toContain(sourceId);
    expect(exported).not.toContain(targetId);
    expect(exported).not.toContain("Private task text");
    fireEvent.drop(rows[1]!, { dataTransfer });
    expect(callbacks.onPlaceTodo).toHaveBeenCalledExactlyOnceWith(sourceId, targetId, "before");
  });

  it("keeps controls focusable but guards duplicate actions while a write is pending", () => {
    const callbacks = props({
      state: controllerState(
        [
          todo("a-only", { text: "Only task" }),
          todo("b-next", { text: "Next task" }),
        ],
        { pendingMutation: { kind: "reorder", todoId: "a-only" } },
      ),
    });
    render(<TodayList {...callbacks} />);

    const moveDown = screen.getByRole("button", {
      name: "Reorder Only task",
    });
    expect(moveDown.getAttribute("aria-disabled")).toBe("true");
    moveDown.focus();
    fireEvent.keyDown(moveDown, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("checkbox", { name: /Only task/ }));

    expect(document.activeElement).toBe(moveDown);
    expect(callbacks.onMoveTodo).not.toHaveBeenCalled();
    expect(callbacks.onCompleteTodo).not.toHaveBeenCalled();
  });

  it("shows a neutral updating state instead of a confirmed empty state mid-write", () => {
    const callbacks = props({
      state: controllerState([], {
        pendingMutation: { kind: "complete", todoId: "last-task" },
      }),
    });
    render(<TodayList {...callbacks} />);

    expect(screen.getByRole("status").textContent).toContain("Updating Today");
    expect(screen.queryByText("Nothing is due yet.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a task" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add task" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("preserves retryable errors and announces repeated reorder outcomes", () => {
    const callbacks = props({
      state: controllerState([], {
        loadStatus: "error",
        loadError: "Today could not be loaded. Try again.",
        mutationError: "That order was not saved.",
        announcement: { sequence: 2, message: "Task returned to its previous position." },
      }),
    });
    render(<TodayList {...callbacks} />);

    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.queryByText("Nothing is due yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText("Task returned to its previous position.")).toBeNull();
  });

  it("re-mounts identical success announcements when their sequence changes", () => {
    const callbacks = props({
      state: controllerState([], {
        announcement: { sequence: 1, message: "Order saved." },
      }),
    });
    const { rerender } = render(<TodayList {...callbacks} />);
    const firstAnnouncement = screen.getByText("Order saved.");

    rerender(
      <TodayList
        {...callbacks}
        state={controllerState([], {
          announcement: { sequence: 2, message: "Order saved." },
        })}
      />,
    );

    expect(screen.getByText("Order saved.")).not.toBe(firstAnnouncement);
  });

  it("does not truncate a long accumulated Today list", () => {
    const manyTodos = Array.from({ length: 100 }, (_, index) =>
      todo(`todo-${index}`, { text: `Accumulated task ${index + 1}` }),
    );
    render(<TodayList {...props({ state: controllerState(manyTodos) })} />);

    const list = screen.getByRole("list", { name: "Today tasks" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(100);
    expect(screen.getByText("Accumulated task 100")).toBeTruthy();
  });
});

it("shows class and assignment type alongside the original red past-due date", () => {
  render(<TodayList {...props({ state: controllerState([todo("assignment", { classId: "math", className: "Math", assignmentType: "Homework", dueDate: "2026-08-25", isOverdue: true })]) })} />);
  expect(screen.getByText("Math · Homework").className).toBe("todo-source-chip");
  expect(screen.getByText("Math · Homework").closest("li")?.className).toContain("overdue");
});
