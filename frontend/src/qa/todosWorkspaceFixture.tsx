import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  addSqlDateDays,
  asSqlDate,
  compareSqlDates,
  localToday,
} from "../features/todos/dateDomain";
import { TodayPanel } from "../features/todos/TodayPanel";
import { assignTodayRanks, sortTodayTodos } from "../features/todos/todayOrder";
import type { TodoService } from "../features/todos/todoService";
import { TodosWorkspace } from "../features/todos/TodosWorkspace";
import type { DeleteUndoToken, LocalDate, TodayTodo, Todo } from "../types/domain";
import "../index.css";
import "./todosWorkspaceFixture.css";

// A deliberately separate Vite-development entry, never imported by App.tsx.
// No Supabase credentials or real account data are read by this visual fixture.
if (!import.meta.env.DEV) throw new Error("The QA fixture is development-only.");

const today = localToday("America/New_York");
const userId = "11111111-1111-4111-8111-111111111111";
const project = { id: "22222222-2222-4222-8222-222222222222", title: "Studio refresh" };
const now = new Date().toISOString();
const profile = { userId, timezone: "America/New_York", createdAt: now, updatedAt: now };
const parameters = new URLSearchParams(window.location.search);
const scenario = parameters.get("scenario") ?? "default";
const isTodayFixture = window.location.pathname.endsWith("/today-panel.html");
const fixturePath = isTodayFixture ? "/qa/today-panel.html" : "/qa/todos-workspace.html";
const scenarioQuery = `?scenario=${encodeURIComponent(scenario)}`;
let nextId = 10;
const uuid = () => `33333333-3333-4333-8333-${String(nextId++).padStart(12, "0")}`;
const task = (text: string, offset: number | null, extra: Partial<Todo> = {}): Todo => ({
  id: uuid(),
  text,
  completed: false,
  completedAt: null,
  dueDate: offset === null ? null : addSqlDateDays(today, offset),
  dueTime: null,
  projectId: null,
  todayRank: null,
  createdAt: now,
  updatedAt: now,
  ...extra,
});
let todos: Todo[] =
  scenario === "empty"
    ? []
    : [
        task("Compare desk measurements", null, { projectId: project.id }),
        task("Ask Mia about the reading group", null),
        task("Return the library books", -4),
        task("Send the venue confirmation", -1, { dueTime: "14:30:00" }),
        task("Review the lighting options", 0, { projectId: project.id }),
        task("Pick up the repaired headphones", 0, { dueTime: "17:00:00" }),
        task("Book a quiet afternoon to read", 1),
        task("Plan next week’s groceries", 3),
        task("Turn in the problem set", 0, {
          recurrence: { freq: "weekly", interval: 1, until: null },
        }),
      ];
if (scenario === "dense") {
  todos.push(
    ...Array.from({ length: 100 }, (_, index) =>
      task(
        index % 7 === 0
          ? `A longer task title to check wrapping, readable actions, and the original due date — item ${index + 1}`
          : `Example accumulated task ${index + 1}`,
        -((index % 20) + 1),
      ),
    ),
  );
}
const deleted = new Map<string, { todo: Todo; token: DeleteUndoToken }>();
let failNextLoad = scenario === "error";

function requireActive(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}
async function prepareLoad(signal: AbortSignal) {
  // Let StrictMode abandon its first mount without consuming the deliberate
  // error scenario before the live request observes it.
  await Promise.resolve();
  requireActive(signal);
  if (failNextLoad) {
    failNextLoad = false;
    throw new Error("Deliberate local fixture failure.");
  }
}
function todayRows(localDate: LocalDate): TodayTodo[] {
  const validDate = asSqlDate(localDate);
  return sortTodayTodos(
    todos.flatMap((todo): TodayTodo[] => {
      if (
        todo.completed ||
        todo.completedAt !== null ||
        todo.dueDate === null ||
        compareSqlDates(todo.dueDate, validDate) > 0
      )
        return [];
      return [
        {
          ...todo,
          completed: false,
          completedAt: null,
          dueDate: todo.dueDate,
          isOverdue: compareSqlDates(todo.dueDate, validDate) < 0,
          isManuallyOrdered: todo.todayRank !== null,
          projectTitle: todo.projectId === project.id ? project.title : null,
        },
      ];
    }),
  );
}
function update(todoId: string, values: Partial<Todo>, signal: AbortSignal): Todo {
  requireActive(signal);
  const current = todos.find((todo) => todo.id === todoId);
  if (!current) throw new Error("Fixture row not found.");
  const saved = { ...current, ...values, updatedAt: new Date().toISOString() };
  todos = todos.map((todo) => (todo.id === todoId ? saved : todo));
  return saved;
}
const service: TodoService = {
  async loadWorkspace({ signal }) {
    await prepareLoad(signal);
    return {
      profile,
      classes: [],
      projects: [project],
      todos: [...todos],
    };
  },
  async createTodo(input, { signal }) {
    requireActive(signal);
    const saved = task(input.text, null, {
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
      projectId: input.projectId ?? null,
    });
    todos = [...todos, saved];
    return saved;
  },
  async updateTodoDetails(todoId, input, { signal }) {
    return update(todoId, input, signal);
  },
  async setTodoCompleted(todoId, completed, { signal }) {
    return update(
      todoId,
      { completed, completedAt: completed ? new Date().toISOString() : null },
      signal,
    );
  },
  async softDeleteTodo(todoId, { signal }) {
    requireActive(signal);
    const todo = todos.find((candidate) => candidate.id === todoId);
    if (!todo) throw new Error("Fixture row not found.");
    const token = new Date().toISOString() as DeleteUndoToken;
    deleted.set(todoId, { todo, token });
    todos = todos.filter((candidate) => candidate.id !== todoId);
    return token;
  },
  async restoreTodo(todoId, token, { signal }) {
    requireActive(signal);
    const entry = deleted.get(todoId);
    if (!entry || entry.token !== token) return false;
    todos = [...todos, entry.todo];
    deleted.delete(todoId);
    return true;
  },
  async loadToday(localDate, { signal }) {
    await prepareLoad(signal);
    return todayRows(localDate);
  },
  async reorderToday(localDate, orderedTodoIds, { signal }) {
    requireActive(signal);
    const eligibleIds = new Set(todayRows(localDate).map((todo) => todo.id));
    if (
      eligibleIds.size !== orderedTodoIds.length ||
      orderedTodoIds.some((todoId) => !eligibleIds.has(todoId))
    ) {
      throw new Error("Fixture reorder requires every currently eligible todo.");
    }
    // Validate the entire order before replacing any records, and retain ranks
    // in the fictional store so a controller refresh verifies persistence.
    const ranks = assignTodayRanks(orderedTodoIds);
    const updatedAt = new Date().toISOString();
    todos = todos.map((todo) =>
      ranks.has(todo.id) ? { ...todo, todayRank: ranks.get(todo.id)!, updatedAt } : todo,
    );
    return orderedTodoIds.map((todoId) => ({ todoId, todayRank: ranks.get(todoId)! }));
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <header className="qa-fixture-banner">
      <p className="qa-fixture-note">
        Local QA fixture · fictional data · changes reset on reload · no account connection
      </p>
      <div className="qa-fixture-navigation">
        <nav aria-label="QA previews">
          <a
            href={`/qa/todos-workspace.html${scenarioQuery}`}
            aria-current={!isTodayFixture ? "page" : undefined}
          >
            Todos
          </a>
          <a
            href={`/qa/today-panel.html${scenarioQuery}`}
            aria-current={isTodayFixture ? "page" : undefined}
          >
            Today panel
          </a>
        </nav>
        <nav aria-label="QA scenarios">
          {["default", "empty", "dense", "error"].map((option) => (
            <a
              key={option}
              href={`${fixturePath}?scenario=${option}`}
              aria-current={scenario === option ? "true" : undefined}
            >
              {option === "default"
                ? "Default"
                : option === "empty"
                  ? "Empty"
                  : option === "dense"
                    ? "Dense"
                    : "Load error"}
            </a>
          ))}
        </nav>
      </div>
    </header>
    {isTodayFixture ? (
      <main className="qa-today-stage" aria-label="Today panel preview">
        <div className="qa-today-panel">
          <TodayPanel
            service={service}
            workspaceSessionKey="local-qa-today-fixture"
            profile={profile}
            projects={[project]}
          />
        </div>
      </main>
    ) : (
      <MemoryRouter initialEntries={["/todos"]}>
        <TodosWorkspace
          service={service}
          workspaceSessionKey="local-qa-fixture"
          identity={{ userId, email: "fixture@example.invalid", expiresAt: 1_900_000_000 }}
          signOutStatus="idle"
          onSignOut={async () => undefined}
        />
      </MemoryRouter>
    )}
  </StrictMode>,
);
