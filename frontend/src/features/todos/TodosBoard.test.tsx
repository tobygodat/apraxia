// @vitest-environment happy-dom

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "../../types/domain";
import { buildTodoBoardModel } from "./todoBoardModel";
import { TodosBoard, type TodosBoardProps } from "./TodosBoard";
import { TodoComposerDialog } from "./TodoComposerDialog";

const TODO: Todo = {
  id: "todo-one",
  text: "Prepare review",
  completed: false,
  completedAt: null,
  dueDate: "2026-09-02",
  dueTime: "14:30:00",
  projectId: null,
  todayRank: null,
  createdAt: "2026-09-01T14:00:00.000000Z",
  updatedAt: "2026-09-01T14:00:00.000000Z",
};

afterEach(() => cleanup());

function props(overrides: Partial<TodosBoardProps> = {}): TodosBoardProps {
  return {
    model: buildTodoBoardModel([TODO], "2026-08-31", "2026-09-02"),
    onPreviousWeek: vi.fn(),
    onNextWeek: vi.fn(),
    onToday: vi.fn(),
    onRetry: vi.fn(),
    onAddTodo: vi.fn(),
    onToggleComplete: vi.fn(() => true),
    onEditTodo: vi.fn(),
    onDeleteTodo: vi.fn(() => true),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function AsyncMutationFocusHarness({
  completion,
  action = "delete",
  optimistic = false,
}: {
  readonly completion: Promise<"succeeded" | "failed">;
  readonly action?: "complete" | "delete";
  readonly optimistic?: boolean;
}) {
  const overdueTodo = { ...TODO, dueDate: "2026-09-01" };
  const [todos, setTodos] = useState<Todo[]>([overdueTodo]);
  const [pendingTodoIds, setPendingTodoIds] = useState<ReadonlySet<string>>(new Set());
  const [mutationResult, setMutationResult] = useState<
    TodosBoardProps["mutationResult"]
  >(null);
  const [composerOpen, setComposerOpen] = useState(false);

  function startMutation(todo: Todo) {
    setPendingTodoIds(new Set([todo.id]));
    if (optimistic) setTodos([]);
    void completion.then((status) => {
      setTodos(
        status === "failed"
          ? [todo]
          : action === "delete"
            ? []
            : [{ ...todo, completed: true, completedAt: "2026-09-02T15:00:00Z" }],
      );
      setPendingTodoIds(new Set());
      setMutationResult({ sequence: 1, todoId: todo.id, action, status });
    });
    return true;
  }

  return (
    <>
      <input aria-label="Another workspace control" />
      <button type="button" onClick={() => setComposerOpen(true)}>
        Open global Add
      </button>
      <TodosBoard
        {...props({
          model: buildTodoBoardModel(todos, "2026-08-31", "2026-09-02"),
          pendingTodoIds,
          mutationResult,
          onDeleteTodo: startMutation,
          onToggleComplete: startMutation,
        })}
      />
      <TodoComposerDialog
        open={composerOpen}
        projects={[]}
        onCreate={async () => undefined}
        onClose={() => setComposerOpen(false)}
      />
    </>
  );
}

function AsyncUndoFocusHarness({ completion }: { readonly completion: Promise<void> }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [showUndo, setShowUndo] = useState(true);
  const [pending, setPending] = useState(false);

  return (
    <>
      <input aria-label="Another workspace control" />
      <TodosBoard
        {...props({
          model: buildTodoBoardModel(todos, "2026-08-31", "2026-09-02"),
          undoNotice: showUndo
            ? {
                todoId: TODO.id,
                todoText: TODO.text,
                pending,
                onUndo: () => {
                  setPending(true);
                  void completion.then(() => {
                    setTodos([TODO]);
                    setShowUndo(false);
                  });
                },
                onDismiss: () => setShowUndo(false),
              }
            : null,
        })}
      />
    </>
  );
}

function FocusRecoveryHarness() {
  const [todos, setTodos] = useState<Todo[]>([
    { ...TODO, id: "first", text: "First overdue", dueDate: "2026-08-30" },
    { ...TODO, id: "second", text: "Second overdue", dueDate: "2026-09-01" },
  ]);
  const [mutationResult, setMutationResult] = useState<
    TodosBoardProps["mutationResult"]
  >(null);

  return (
    <TodosBoard
      {...props({
        model: buildTodoBoardModel(todos, "2026-08-31", "2026-09-02"),
        mutationResult,
        onDeleteTodo: (todo) => {
          setTodos((current) => current.filter(({ id }) => id !== todo.id));
          setMutationResult({
            sequence: 1,
            todoId: todo.id,
            action: "delete",
            status: "succeeded",
          });
          return true;
        },
      })}
    />
  );
}

function UndoFocusHarness() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [showUndo, setShowUndo] = useState(true);

  return (
    <TodosBoard
      {...props({
        model: buildTodoBoardModel(todos, "2026-08-31", "2026-09-02"),
        undoNotice: showUndo
          ? {
              todoId: TODO.id,
              todoText: TODO.text,
              onUndo: () => {
                setTodos([TODO]);
                setShowUndo(false);
              },
              onDismiss: () => setShowUndo(false),
            }
          : null,
      })}
    />
  );
}

function VisibleCompletionHarness() {
  const [todos, setTodos] = useState<Todo[]>([TODO]);
  const [mutationResult, setMutationResult] = useState<
    TodosBoardProps["mutationResult"]
  >(null);

  return (
    <>
      <button type="button" onClick={() => setTodos([])}>
        Replace board data
      </button>
      <TodosBoard
        {...props({
          model: buildTodoBoardModel(todos, "2026-08-31", "2026-09-02"),
          mutationResult,
          onToggleComplete: (todo) => {
            setTodos((current) =>
              current.map((candidate) =>
                candidate.id === todo.id
                  ? {
                      ...candidate,
                      completed: true,
                      completedAt: "2026-09-02T15:00:00.000000Z",
                    }
                  : candidate,
              ),
            );
            setMutationResult({
              sequence: 1,
              todoId: todo.id,
              action: "complete",
              status: "succeeded",
            });
            return true;
          },
        })}
      />
    </>
  );
}

function OptimisticDeleteFailureHarness() {
  const [todos, setTodos] = useState<Todo[]>([TODO]);
  const [pendingTodoIds, setPendingTodoIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [mutationResult, setMutationResult] = useState<
    TodosBoardProps["mutationResult"]
  >(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTodos([TODO]);
          setPendingTodoIds(new Set());
          setMutationResult({
            sequence: 1,
            todoId: TODO.id,
            action: "delete",
            status: "failed",
          });
        }}
      >
        Reject deletion
      </button>
      <TodosBoard
        {...props({
          model: buildTodoBoardModel(todos, "2026-08-31", "2026-09-02"),
          mutationResult,
          pendingTodoIds,
          onDeleteTodo: (todo) => {
            setPendingTodoIds(new Set([todo.id]));
            setTodos([]);
            return true;
          },
        })}
      />
    </>
  );
}

function PendingAdjacentHarness() {
  const [todos, setTodos] = useState<Todo[]>([
    { ...TODO, id: "first", text: "First overdue", dueDate: "2026-08-30" },
    { ...TODO, id: "second", text: "Second overdue", dueDate: "2026-09-01" },
  ]);

  return (
    <TodosBoard
      {...props({
        model: buildTodoBoardModel(todos, "2026-08-31", "2026-09-02"),
        pendingTodoIds: new Set(["second"]),
        onDeleteTodo: (todo) => {
          setTodos((current) => current.filter(({ id }) => id !== todo.id));
          return true;
        },
      })}
    />
  );
}

describe("TodosBoard", () => {
  it("renders Inbox, Today, and the current-week remainder without filler copy", () => {
    render(<TodosBoard {...props()} />);

    expect(screen.getByRole("heading", { name: "Inbox" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Overdue" })).toBeNull();
    expect(screen.getByRole("heading", { name: /· Today$/ })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(6);
    expect(screen.queryByText(/no tasks planned/i)).toBeNull();
    expect(screen.queryByText("Workspace")).toBeNull();
    expect(screen.getByText("1 task")).toBeTruthy();
    expect(
      screen.getByRole("region", { name: "Tasks by date" }).getAttribute("tabindex"),
    ).toBe("0");
  });

  it("routes week navigation and date-prefilled Add actions", () => {
    const callbacks = props();
    render(<TodosBoard {...callbacks} />);

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(callbacks.onPreviousWeek).toHaveBeenCalledOnce();
    expect(callbacks.onNextWeek).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("button", { name: "Today" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Add task to Inbox" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Add task to .*Today$/ }),
    );

    expect(callbacks.onAddTodo).toHaveBeenNthCalledWith(1, null);
    expect(callbacks.onAddTodo).toHaveBeenNthCalledWith(2, "2026-09-02");
  });

  it("exposes complete, edit, and soft-delete intents and locks a pending row", () => {
    const callbacks = props({ pendingTodoIds: new Set([TODO.id]) });
    const { rerender } = render(<TodosBoard {...callbacks} />);

    const card = screen.getByRole("article", { name: TODO.text });
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect((within(card).getByRole("checkbox") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (
        within(card).getByRole("button", {
          name: `Edit ${TODO.text}`,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    rerender(<TodosBoard {...callbacks} pendingTodoIds={new Set()} />);
    const readyCard = screen.getByRole("article", { name: TODO.text });
    fireEvent.click(within(readyCard).getByRole("checkbox"));
    fireEvent.click(within(readyCard).getByRole("button", { name: `Edit ${TODO.text}` }));
    fireEvent.click(within(readyCard).getByRole("button", { name: `Delete ${TODO.text}` }));

    expect(callbacks.onToggleComplete).toHaveBeenCalledWith(TODO);
    expect(callbacks.onEditTodo).toHaveBeenCalledWith(TODO);
    expect(callbacks.onDeleteTodo).toHaveBeenCalledWith(TODO);
    expect(
      within(readyCard).getByText("2:30 PM").getAttribute("datetime"),
    ).toBe("14:30:00");
  });

  it("names each completion control and preserves overdue/project context", () => {
    const projectId = "55555555-5555-4555-8555-555555555555";
    const overdue = {
      ...TODO,
      dueDate: "2026-09-01",
      projectId,
    };
    render(
      <TodosBoard
        {...props({
          model: buildTodoBoardModel(
            [overdue],
            "2026-08-31",
            "2026-09-02",
          ),
          projects: [{ id: projectId, title: "Launch" }],
        })}
      />,
    );

    expect(
      screen.getByRole("checkbox", {
        name: `Mark as complete ${TODO.text}`,
      }),
    ).toBeTruthy();
    const dueDate = document.querySelector('time[datetime="2026-09-01"]');
    expect(dueDate?.textContent).toContain("Sep 1");
    expect(dueDate?.classList.contains("todos-board-card__due--past")).toBe(true);
    expect(within(screen.getByRole("region", { name: /· Today$/ })).getByText(TODO.text)).toBeTruthy();
    expect(screen.getByText("Launch")).toBeTruthy();
  });

  it("uses mutually exclusive loading and retryable error states", () => {
    const callbacks = props({
      loadState: { status: "loading" },
    });
    const { rerender } = render(<TodosBoard {...callbacks} />);

    expect(screen.getByRole("status").textContent).toContain("Loading tasks");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Next week" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    rerender(
      <TodosBoard
        {...callbacks}
        loadState={{
          status: "error",
          kind: "load_failed",
        }}
      />,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Tasks could not be loaded.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
  });

  it("moves focus to the next task and announces a removed focused row", () => {
    render(<FocusRecoveryHarness />);

    const firstCard = screen.getByRole("article", { name: "First overdue" });
    const deleteButton = within(firstCard).getByRole("button", {
      name: "Delete First overdue",
    });
    deleteButton.focus();
    fireEvent.click(deleteButton);

    const remainingCard = screen.getByRole("article", {
      name: "Second overdue",
    });
    expect(document.activeElement).toBe(within(remainingCard).getByRole("checkbox"));
    expect(screen.getByText("First overdue deleted. Undo is available.")).toBeTruthy();
  });

  it.each(["complete", "delete"] as const)(
    "preserves a newer external focus when an async %s settles",
    async (action) => {
      const completion = deferred<"succeeded" | "failed">();
      render(<AsyncMutationFocusHarness action={action} completion={completion.promise} />);
      const source = action === "complete"
        ? screen.getByRole("checkbox", { name: `Mark as complete ${TODO.text}` })
        : screen.getByRole("button", { name: `Delete ${TODO.text}` });
      source.focus();
      fireEvent.click(source);

      const external = screen.getByRole("textbox", { name: "Another workspace control" });
      external.focus();
      await act(async () => {
        completion.resolve("succeeded");
        await completion.promise;
      });

      expect(screen.queryByRole("article", { name: TODO.text })).toBeNull();
      expect(document.activeElement).toBe(external);
      expect(screen.getByText(
        action === "complete" ? `${TODO.text} completed.` : `${TODO.text} deleted. Undo is available.`,
      )).toBeTruthy();
    },
  );

  it("never pulls focus behind a newer global Add dialog after async deletion", async () => {
    const completion = deferred<"succeeded" | "failed">();
    render(<AsyncMutationFocusHarness completion={completion.promise} />);
    const source = screen.getByRole("button", { name: `Delete ${TODO.text}` });
    source.focus();
    fireEvent.click(source);

    const opener = screen.getByRole("button", { name: "Open global Add" });
    opener.focus();
    fireEvent.click(opener);
    const taskField = screen.getByRole("textbox", { name: "Task" });
    expect(document.activeElement).toBe(taskField);

    await act(async () => {
      completion.resolve("succeeded");
      await completion.promise;
    });

    expect(screen.getByRole("dialog", { name: "Add a task" })).toBeTruthy();
    expect(document.activeElement).toBe(taskField);
  });

  it("does not reclaim focus after optimistic fallback gives way to a newer interaction", async () => {
    const completion = deferred<"succeeded" | "failed">();
    render(<AsyncMutationFocusHarness completion={completion.promise} optimistic />);
    const source = screen.getByRole("button", { name: `Delete ${TODO.text}` });
    source.focus();
    fireEvent.click(source);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Add task to .*Today$/ }));

    const external = screen.getByRole("textbox", { name: "Another workspace control" });
    external.focus();
    await act(async () => {
      completion.resolve("failed");
      await completion.promise;
    });

    expect(screen.getByRole("article", { name: TODO.text })).toBeTruthy();
    expect(document.activeElement).toBe(external);
    expect(screen.queryByText(/deleted\. Undo is available/)).toBeNull();
  });

  it("exposes an actionable Undo surface and safe mutation feedback", () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <TodosBoard
        {...props({
          mutationError: "completion_failed",
          undoNotice: {
            todoId: TODO.id,
            todoText: "Prepare review",
            error: "Restore failed. Try Undo again.",
            onUndo,
            onDismiss,
          },
        })}
      />,
    );

    expect(screen.getByText(/prior state remains/i)).toBeTruthy();
    expect(
      screen.getByText("Prepare review deleted. Undo is available."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not arm stale recovery for a mutation that did not start", () => {
    const callbacks = props({ onDeleteTodo: vi.fn(() => false) });
    const { rerender } = render(<TodosBoard {...callbacks} />);
    fireEvent.click(
      screen.getByRole("button", { name: `Delete ${TODO.text}` }),
    );

    rerender(
      <TodosBoard
        {...callbacks}
        model={buildTodoBoardModel([], "2026-08-31", "2026-09-02")}
      />,
    );

    expect(screen.queryByText(/deleted\. Undo is available/)).toBeNull();
  });

  it("ignores an old failed settlement when the same deletion is retried", () => {
    const priorFailure = {
      sequence: 4,
      todoId: TODO.id,
      action: "delete" as const,
      status: "failed" as const,
    };
    const callbacks = props({ mutationResult: priorFailure });
    const { rerender } = render(<TodosBoard {...callbacks} />);
    fireEvent.click(
      screen.getByRole("button", { name: `Delete ${TODO.text}` }),
    );

    rerender(
      <TodosBoard
        {...callbacks}
        model={buildTodoBoardModel([], "2026-08-31", "2026-09-02")}
        mutationResult={{
          sequence: 5,
          todoId: TODO.id,
          action: "delete",
          status: "succeeded",
        }}
      />,
    );

    expect(
      screen.getByText(`${TODO.text} deleted. Undo is available.`),
    ).toBeTruthy();
  });

  it("does not announce optimistic success and restores focus after rollback", () => {
    render(<OptimisticDeleteFailureHarness />);
    const deleteButton = screen.getByRole("button", {
      name: `Delete ${TODO.text}`,
    });
    deleteButton.focus();
    fireEvent.click(deleteButton);

    expect(screen.queryByText(/deleted\. Undo is available/)).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Add task to .*Today$/ }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject deletion" }));
    const restoredCard = screen.getByRole("article", { name: TODO.text });
    expect(document.activeElement).toBe(
      within(restoredCard).getByRole("checkbox"),
    );
    expect(screen.queryByText(/deleted\. Undo is available/)).toBeNull();
  });

  it("gives a fresh failure precedence over optimistic removal", () => {
    const callbacks = props();
    const { rerender } = render(<TodosBoard {...callbacks} />);
    fireEvent.click(
      screen.getByRole("button", { name: `Delete ${TODO.text}` }),
    );

    rerender(
      <TodosBoard
        {...callbacks}
        model={buildTodoBoardModel([], "2026-08-31", "2026-09-02")}
        mutationResult={{
          sequence: 1,
          todoId: TODO.id,
          action: "delete",
          status: "failed",
        }}
        mutationError="delete_failed"
      />,
    );

    expect(screen.queryByText(/deleted\. Undo is available/)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("could not be deleted");
  });

  it("skips a disabled adjacent task when recovering focus", () => {
    render(<PendingAdjacentHarness />);
    const firstCard = screen.getByRole("article", { name: "First overdue" });
    const deleteButton = within(firstCard).getByRole("button", {
      name: "Delete First overdue",
    });
    deleteButton.focus();
    fireEvent.click(deleteButton);

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Add task to .*Today$/ }),
    );
  });

  it("settles recovery when completion leaves the row visible", () => {
    render(<VisibleCompletionHarness />);
    const checkbox = screen.getByRole("checkbox");
    checkbox.focus();
    fireEvent.click(checkbox);

    const firstAnnouncement = screen.getByText(`${TODO.text} completed.`);
    expect(document.activeElement).toBe(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: "Replace board data" }));
    expect(screen.getByText(`${TODO.text} completed.`)).toBe(firstAnnouncement);
  });

  it("restores focus to an undone todo and announces the result", () => {
    render(<UndoFocusHarness />);
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.focus();
    fireEvent.click(undo);

    const restoredCard = screen.getByRole("article", { name: TODO.text });
    expect(document.activeElement).toBe(
      within(restoredCard).getByRole("checkbox"),
    );
    expect(screen.getByText(`${TODO.text} restored.`)).toBeTruthy();
  });

  it("preserves a newer external focus when async Undo succeeds", async () => {
    const completion = deferred<void>();
    render(<AsyncUndoFocusHarness completion={completion.promise} />);
    const undo = screen.getByRole("button", { name: "Undo" });
    undo.focus();
    fireEvent.click(undo);

    const external = screen.getByRole("textbox", { name: "Another workspace control" });
    external.focus();
    await act(async () => {
      completion.resolve();
      await completion.promise;
    });

    expect(screen.getByRole("article", { name: TODO.text })).toBeTruthy();
    expect(document.activeElement).toBe(external);
    expect(screen.getByText(`${TODO.text} restored.`)).toBeTruthy();
  });

  it("returns focus to the board when Undo is dismissed", () => {
    render(<UndoFocusHarness />);
    const dismiss = screen.getByRole("button", { name: "Dismiss undo" });
    dismiss.focus();
    fireEvent.click(dismiss);

    expect(document.activeElement).toBe(
      screen.getByRole("region", { name: "Tasks by date" }),
    );
    expect(screen.getByText("Undo dismissed.")).toBeTruthy();
  });

  it("keeps pending Undo focusable and guards duplicate restoration", () => {
    const onUndo = vi.fn();
    render(
      <TodosBoard
        {...props({
          undoNotice: {
            todoId: TODO.id,
            todoText: TODO.text,
            pending: true,
            onUndo,
            onDismiss: vi.fn(),
          },
        })}
      />,
    );

    const undo = screen.getByRole("button", { name: "Restoring…" });
    expect((undo as HTMLButtonElement).disabled).toBe(false);
    expect(undo.getAttribute("aria-disabled")).toBe("true");
    undo.focus();
    fireEvent.click(undo);
    expect(onUndo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(undo);
  });
});
