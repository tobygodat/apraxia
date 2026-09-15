import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Todo } from "../types";
import "./Todos.css";
import { ArrowIcon, PlusIcon, CheckIcon } from "../components/icons";

const dateLabel = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const weekdayLabel = new Intl.DateTimeFormat(undefined, { weekday: "long" });

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const daysSinceMonday = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - daysSinceMonday);
  return next;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dueKey(todo: Todo) {
  return todo.due?.slice(0, 10) || null;
}

function isSameDay(left: Date, right: Date) {
  return dateKey(left) === dateKey(right);
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.2 5.5h11.6l1.2 8.8a1.5 1.5 0 0 1-1.5 1.7h-11A1.5 1.5 0 0 1 3 14.3l1.2-8.8Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M3.5 12h3.2l1.1 1.5h4.4l1.1-1.5h3.2"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect
        x="3.5"
        y="4.5"
        width="13"
        height="12"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M6.5 3v3M13.5 3v3M3.5 8h13"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.5 6.5h11M8 3.5h4l1 3H7l1-3ZM6.5 6.5l.7 10h5.6l.7-10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function Todos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [visibleWeekStart, setVisibleWeekStart] = useState(() => startOfWeek(new Date()));
  const [composerKey, setComposerKey] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setTodos(await api.list<Todo>("todos"));
      setError("");
    } catch {
      setError("Todos could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = startOfDay(new Date());
  const currentWeekStart = startOfWeek(today);
  const showingCurrentWeek = isSameDay(visibleWeekStart, currentWeekStart);
  const firstVisibleDay = showingCurrentWeek ? today : visibleWeekStart;
  const weekEnd = addDays(visibleWeekStart, 6);
  const visibleDates: Date[] = [];

  for (let day = firstVisibleDay; day <= weekEnd; day = addDays(day, 1)) {
    visibleDates.push(day);
  }

  const openComposer = (key: string) => {
    setComposerKey(key);
    setText("");
    setError("");
  };

  const closeComposer = () => {
    setComposerKey(null);
    setText("");
  };

  const add = async (event: FormEvent<HTMLFormElement>, due: string | null) => {
    event.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText || submitting) return;

    setSubmitting(true);
    try {
      await api.create<Todo>("todos", { text: trimmedText, due });
      closeComposer();
      await load();
    } catch {
      setError("The task could not be added. Your text is still here so you can retry.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = async (todo: Todo) => {
    try {
      await api.update<Todo>("todos", todo.id, { done: todo.done ? 0 : 1 });
      await load();
    } catch {
      setError("The task could not be updated. Try again.");
    }
  };

  const remove = async (id: number) => {
    try {
      await api.remove("todos", id);
      await load();
    } catch {
      setError("The task could not be deleted. Try again.");
    }
  };

  const todayKey = dateKey(today);
  const overdueTodos = todos
    .filter((todo) => {
      const due = dueKey(todo);
      return !todo.done && due !== null && due < todayKey;
    })
    .sort((left, right) => (dueKey(left) ?? "").localeCompare(dueKey(right) ?? ""));

  const columns = [
    {
      key: "inbox",
      kind: "inbox" as const,
      date: null,
      due: null,
      allowAdd: true,
      todos: todos.filter((todo) => dueKey(todo) === null),
    },
    {
      key: "overdue",
      kind: "overdue" as const,
      date: null,
      due: null,
      allowAdd: false,
      todos: overdueTodos,
    },
    ...visibleDates.map((date) => ({
      key: dateKey(date),
      kind: "date" as const,
      date,
      due: dateKey(date),
      allowAdd: true,
      todos: todos.filter((todo) => {
        const due = dueKey(todo);
        return due === dateKey(date) && (Boolean(todo.done) || due >= todayKey);
      }),
    })),
  ];

  const columnTitle = (column: (typeof columns)[number]) => {
    if (column.kind === "inbox") return "Inbox";
    if (column.kind === "overdue") return "Overdue";
    const date = column.date;
    if (!date) return "";
    if (isSameDay(date, today)) return `${dateLabel.format(date)} · Today`;
    if (isSameDay(date, addDays(today, 1))) return `${dateLabel.format(date)} · Tomorrow`;
    return `${dateLabel.format(date)} · ${weekdayLabel.format(date)}`;
  };

  return (
    <section className="todo-board-page" aria-labelledby="todos-heading">
      <header className="todo-board-toolbar">
        <h1 id="todos-heading">/todos/</h1>
        <div className="todo-board-nav" aria-label="Week navigation">
          <button
            className="todo-nav-button todo-nav-button--icon"
            type="button"
            aria-label="Previous week"
            title="Previous week"
            onClick={() => setVisibleWeekStart((week) => addDays(week, -7))}
          >
            <ArrowIcon direction="left" />
          </button>
          <button
            className="todo-nav-button todo-nav-button--today"
            type="button"
            onClick={() => setVisibleWeekStart(currentWeekStart)}
            disabled={showingCurrentWeek}
          >
            today
          </button>
          <button
            className="todo-nav-button todo-nav-button--icon"
            type="button"
            aria-label="Next week"
            title="Next week"
            onClick={() => setVisibleWeekStart((week) => addDays(week, 7))}
          >
            <ArrowIcon direction="right" />
          </button>
        </div>
      </header>

      {error && (
        <p className="todo-board-error" role="alert">
          {error}
        </p>
      )}

      <div className="todo-board-scroll" aria-label="Tasks by date">
        <div className="todo-board">
          {columns.map((column) => (
            <section
              className={`todo-column todo-column--${column.kind}${column.date && isSameDay(column.date, today) ? " todo-column--today" : ""}`}
              key={column.key}
              aria-labelledby={`column-${column.key}`}
            >
              <h2 className="todo-column__heading" id={`column-${column.key}`}>
                <span>{columnTitle(column)}</span>
                <span className="todo-column__count" aria-label={`${column.todos.length} tasks`}>
                  {column.todos.length}
                </span>
              </h2>

              <div className="todo-column__tasks">
                {loading && (
                  <div className="todo-card todo-card--loading" aria-label="Loading tasks" />
                )}
                {column.todos.map((todo) => (
                  <article
                    className={`todo-card${todo.done ? " todo-card--done" : ""}`}
                    key={todo.id}
                  >
                    <label className="todo-check">
                      <input
                        type="checkbox"
                        checked={Boolean(todo.done)}
                        onChange={() => void toggle(todo)}
                      />
                      <span className="todo-check__mark" aria-hidden="true">
                        <CheckIcon />
                      </span>
                      <span className="sr-only">
                        {todo.done ? "Mark as incomplete" : "Mark as complete"}
                      </span>
                    </label>
                    <div className="todo-card__content">
                      <p className="todo-card__title">{todo.text}</p>
                      <span className="todo-card__meta">
                        {dueKey(todo) ? <CalendarIcon /> : <InboxIcon />}
                        {dueKey(todo)
                          ? `${dueKey(todo)! < todayKey ? "overdue · " : ""}${dateLabel.format(new Date(`${dueKey(todo)}T00:00:00`))}`
                          : "Inbox"}
                      </span>
                    </div>
                    <button
                      className="todo-card__delete"
                      type="button"
                      aria-label={`Delete ${todo.text}`}
                      title="Delete task"
                      onClick={() => void remove(todo.id)}
                    >
                      <TrashIcon />
                    </button>
                  </article>
                ))}
              </div>

              {column.allowAdd && composerKey === column.key ? (
                <form className="todo-composer" onSubmit={(event) => void add(event, column.due)}>
                  <input
                    className="todo-composer__input"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="task name"
                    aria-label="Task name"
                    autoFocus
                  />
                  <div className="todo-composer__chips" aria-label="Task details">
                    {column.kind === "inbox" && (
                      <span className="todo-chip">
                        <InboxIcon />
                        Inbox
                      </span>
                    )}
                    {column.date && (
                      <span className="todo-chip todo-chip--date">
                        <CalendarIcon />
                        {isSameDay(column.date, today) ? "Today" : dateLabel.format(column.date)}
                      </span>
                    )}
                  </div>
                  <div className="todo-composer__actions">
                    <button className="todo-composer__cancel" type="button" onClick={closeComposer}>
                      cancel
                    </button>
                    <button
                      className="todo-composer__submit"
                      type="submit"
                      disabled={!text.trim() || submitting}
                    >
                      {submitting ? "adding…" : "add task"}
                    </button>
                  </div>
                </form>
              ) : column.allowAdd ? (
                <button
                  className="todo-add-button"
                  type="button"
                  onClick={() => openComposer(column.key)}
                >
                  <span className="todo-add-button__icon">
                    <PlusIcon />
                  </span>
                  add task
                </button>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
