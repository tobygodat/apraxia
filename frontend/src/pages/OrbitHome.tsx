import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Todo } from "../types";
import "./OrbitHome.css";

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const monthDate = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });

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
  next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
  return next;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todoDueKey(todo: Todo) {
  return todo.due?.slice(0, 10) ?? null;
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d={direction === "left" ? "m12.5 5-5 5 5 5" : "m7.5 5 5 5-5 5"}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.5 10 3 3 6-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

export default function OrbitHome() {
  const today = startOfDay(new Date());
  const todayKey = dateKey(today);
  const currentWeekStart = startOfWeek(today);
  const [weekStart, setWeekStart] = useState(currentWeekStart);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loadingTodos, setLoadingTodos] = useState(true);
  const [newTask, setNewTask] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadTodos = useCallback(async () => {
    try {
      setTodos(await api.list<Todo>("todos"));
      setError("");
    } catch {
      setError("Today could not be loaded. Try again.");
    } finally {
      setLoadingTodos(false);
    }
  }, []);

  useEffect(() => {
    void loadTodos();
  }, [loadTodos]);

  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekEnd = weekDays[6];
  const hours = Array.from({ length: 16 }, (_, index) => index + 7);
  const timezone = new Intl.DateTimeFormat(undefined, { timeZoneName: "shortOffset" })
    .formatToParts(today)
    .find((part) => part.type === "timeZoneName")?.value ?? "local";
  const showingCurrentWeek = dateKey(weekStart) === dateKey(currentWeekStart);

  const todayTodos = todos
    .filter((todo) => {
      const due = todoDueKey(todo);
      return !Boolean(todo.done) && due !== null && due <= todayKey;
    })
    .sort((left, right) => {
      const dueOrder = (todoDueKey(left) ?? "").localeCompare(todoDueKey(right) ?? "");
      return dueOrder || left.created_at.localeCompare(right.created_at);
    });

  const toggle = async (todo: Todo) => {
    setTodos((items) => items.map((item) => (item.id === todo.id ? { ...item, done: 1 } : item)));
    try {
      await api.update<Todo>("todos", todo.id, { done: 1 });
    } catch {
      setTodos((items) => items.map((item) => (item.id === todo.id ? todo : item)));
      setError("The task could not be completed. Try again.");
    }
  };

  const addTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = newTask.trim();
    if (!text || submitting) return;

    setSubmitting(true);
    try {
      await api.create<Todo>("todos", { text, due: todayKey });
      setNewTask("");
      await loadTodos();
    } catch {
      setError("The task could not be added. Your text is still here so you can retry.");
    } finally {
      setSubmitting(false);
    }
  };

  const rangeLabel = `${monthDate.format(weekStart)} – ${monthDate.format(weekEnd)}`;

  return (
    <section className="home-page" aria-label="Home">
      <section className="week-calendar" aria-labelledby="calendar-heading">
        <header className="week-calendar__toolbar">
          <div>
            <h1 id="calendar-heading">Calendar</h1>
            <p>{rangeLabel}</p>
          </div>
          <div className="week-calendar__nav" aria-label="Calendar week navigation">
            <button type="button" aria-label="Previous week" onClick={() => setWeekStart((week) => addDays(week, -7))}>
              <ArrowIcon direction="left" />
            </button>
            <button type="button" disabled={showingCurrentWeek} onClick={() => setWeekStart(currentWeekStart)}>
              today
            </button>
            <button type="button" aria-label="Next week" onClick={() => setWeekStart((week) => addDays(week, 7))}>
              <ArrowIcon direction="right" />
            </button>
          </div>
        </header>

        <div className="week-calendar__surface">
          <div className="week-calendar__days">
            <div className="week-calendar__timezone">{timezone}</div>
            {weekDays.map((day) => {
              const isToday = dateKey(day) === todayKey;
              return (
                <div className={`week-calendar__day${isToday ? " week-calendar__day--today" : ""}`} key={dateKey(day)}>
                  <span>{weekday.format(day)}</span>
                  <strong>{day.getDate()}</strong>
                </div>
              );
            })}
          </div>

          <div className="week-calendar__all-day">
            <span>all-day</span>
            {weekDays.map((day) => <div key={dateKey(day)} />)}
          </div>

          <div className="week-calendar__scroll">
            <div className="week-calendar__grid" aria-label="Hourly calendar grid">
              {hours.map((hour) => (
                <div className="week-calendar__hour" key={hour}>
                  <span>{hour > 12 ? hour - 12 : hour} {hour >= 12 ? "PM" : "AM"}</span>
                  {weekDays.map((day) => (
                    <div
                      className={dateKey(day) === todayKey ? "week-calendar__cell week-calendar__cell--today" : "week-calendar__cell"}
                      key={`${dateKey(day)}-${hour}`}
                    />
                  ))}
                </div>
              ))}
              <div className="calendar-connect-state">
                <p>Google Calendar is not connected yet.</p>
                <span>The Calendar panel is ready for the read-only OAuth service.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="today-panel" aria-labelledby="today-heading">
        <header className="today-panel__header">
          <div>
            <h2 id="today-heading">Today</h2>
            <p>{shortDate.format(today)}</p>
          </div>
          <span aria-label={`${todayTodos.length} incomplete tasks`}>{todayTodos.length}</span>
        </header>

        {error && <p className="today-panel__error" role="alert">{error}</p>}

        <div className="today-panel__list" aria-live="polite">
          {loadingTodos && <p className="today-panel__status">Loading today…</p>}
          {!loadingTodos && todayTodos.length === 0 && (
            <p className="today-panel__status">Nothing due or overdue.</p>
          )}
          {todayTodos.map((todo) => {
            const due = todoDueKey(todo)!;
            const overdue = due < todayKey;
            return (
              <article className="today-task" key={todo.id}>
                <button type="button" className="today-task__check" aria-label={`Complete ${todo.text}`} onClick={() => void toggle(todo)}>
                  <CheckIcon />
                </button>
                <div>
                  <p>{todo.text}</p>
                  <span className={overdue ? "today-task__due today-task__due--overdue" : "today-task__due"}>
                    {overdue ? `overdue · ${shortDate.format(new Date(`${due}T00:00:00`))}` : "due today"}
                  </span>
                </div>
              </article>
            );
          })}
        </div>

        <form className="today-panel__add" onSubmit={(event) => void addTask(event)}>
          <label htmlFor="today-task-input" className="sr-only">Add a task due today</label>
          <input
            id="today-task-input"
            value={newTask}
            onChange={(event) => setNewTask(event.target.value)}
            placeholder="Add a task for today"
          />
          <button type="submit" disabled={!newTask.trim() || submitting}>
            {submitting ? "adding…" : "add"}
          </button>
        </form>
      </aside>
    </section>
  );
}
