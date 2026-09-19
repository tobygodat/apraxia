import { createClassPersistenceFixture } from "./classPersistenceFixture";
import type { DriveService } from "../features/classes/driveService";
import { createFixturePdf } from "./fixturePdf";
import { fixtureAssignmentTodos } from "./ClassAssignmentsMock";
import { createTodoAssignmentService } from "../features/classes/assignmentService";
import { summarizeClasses } from "../features/classes/classOverview";
import { isNoteSaved } from "../features/classes/noteService";
import { createCareerFixtureService } from "./careerFixture";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { WorkspaceRuntime } from "../apps/WorkspaceRuntime";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  WORKSPACE_PREFERENCES_STORAGE_KEY,
  WORKSPACE_THEME_PRESETS,
} from "../apps/workspacePreferences";
import { createFixtureCalendar } from "./workspaceFixtureCalendar";
import { loadPersonalSnapshot, snapshotTimezone } from "./personalSnapshot";
import {
  createFixtureAppearance,
  createFixtureCover,
  delayedFixtureService,
} from "./workspaceFixtureSupport";
import "./workspaceFixture.css";
import type { TodoService } from "../features/todos/todoService";
import type {
  CollectionKind,
  CollectionService,
  ListOptions,
} from "../features/collections/collectionService";
import { addSqlDateDays, localToday } from "../features/todos/dateDomain";
import { sortTodayTodos } from "../features/todos/todayOrder";
import type {
  DeleteUndoToken,
  Idea,
  Project,
  SearchResult,
  TodayTodo,
  Todo,
} from "../types/domain";
import "../index.css";

// Separate Vite development entry. All identities and records below are fictional,
// except the `personal` scenario, which seeds from a private gitignored snapshot.
// Calendar and appearance use isolated tab storage; no credentials or network requests.
if (!import.meta.env.DEV) throw new Error("The QA fixture is development-only.");
const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") ?? "realistic";
// `?theme=paper` (or `paper-light`) seeds the device preference the workspace
// reads, so a Paper surface can be inspected without opening Settings.
const theme = params.get("theme");
if (theme && (WORKSPACE_THEME_PRESETS as readonly string[]).includes(theme)) {
  window.localStorage.setItem(
    WORKSPACE_PREFERENCES_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_WORKSPACE_PREFERENCES, theme }),
  );
}
const empty = scenario === "empty";
const long = scenario === "long" || scenario === "dense";
let driveConnected = params.get("drive") !== "disconnected";
const driveService: DriveService = {
  status: async () => ({ connectionState: driveConnected ? "connected" : "disconnected" }),
  connect: async () => {
    throw new Error("Google consent is unavailable in the fictional fixture.");
  },
  disconnect: async () => {
    driveConnected = false;
  },
  files: async (folder) => {
    if (params.get("drive") === "error") throw new Error("Google Drive could not load. Try again.");
    return {
      files:
        folder === "root"
          ? [
              {
                id: "math-notes",
                name: "MATH3012 notes",
                folder: true,
                modifiedTime: null,
                size: null,
              },
            ]
          : [
              {
                id: "lecture-one",
                name: "Lecture 1 - Counting.pdf",
                folder: false,
                modifiedTime: null,
                size: "1024",
              },
            ],
      nextPage: null,
    };
  },
  pickPdf: async () => ({
    id: "lecture-one",
    name: "Lecture 1 - Counting.pdf",
    folder: false,
    modifiedTime: null,
    size: null,
  }),
  pdf: async () => createFixturePdf(),
};
const now = new Date().toISOString();
const timezone = (scenario === "personal" && snapshotTimezone()) || "America/New_York";
const today = localToday(timezone);
/** Null for every other scenario, and for `personal` before a snapshot exists. */
const personal = scenario === "personal" ? loadPersonalSnapshot(today) : null;
const userId = "11111111-1111-4111-8111-111111111111";
let sequence = 100;
const id = () => `22222222-2222-4222-8222-${String(sequence++).padStart(12, "0")}`;
let profile = { userId, timezone, createdAt: now, updatedAt: now };
const base = () => ({ id: id(), createdAt: now, updatedAt: now });
const longText =
  "Plan the studio gathering, including the guest list, accessible arrival directions, food preferences, and the quiet corner for anyone who needs a break";
let projects: Project[] = personal
  ? personal.projects
  : empty
    ? []
    : [
        {
          ...base(),
          title: long ? longText : "Studio refresh",
          description: "Make room for reading, writing, and a friend stopping by.",
          status: "active",
        },
        {
          ...base(),
          title: "Autumn weekend away",
          description: "A small trip, with room to wander.",
          status: "someday",
        },
        { ...base(), title: "Summer reading", description: null, status: "completed" },
        { ...base(), title: "Old apartment move", description: null, status: "archived" },
      ];
const projectId = projects[0]?.id ?? null;
/** A completion instant on a date relative to the fixture's today, at local midday. */
const completedOn = (offset: number) => `${addSqlDateDays(today, offset)}T16:00:00.000000Z`;
const task = (text: string, offset: number | null, extra: Partial<Todo> = {}): Todo => ({
  ...base(),
  text,
  dueDate: offset === null ? null : addSqlDateDays(today, offset),
  dueTime: null,
  completed: false,
  completedAt: null,
  projectId: null,
  todayRank: null,
  ...extra,
});
let todos: Todo[] = personal
  ? personal.todos
  : empty
    ? []
    : [
        ...fixtureAssignmentTodos(),
        // Open past-due tasks join Today; the completed task stays on its original date.
        task("Return the library books", -3),
        task("Send the venue confirmation", -1),
        // Completions spread across this week and the last one.
        task("Renew the library card", -8, { completed: true, completedAt: completedOn(-9) }),
        task("Draft the guest list", -2, {
          projectId,
          completed: true,
          completedAt: completedOn(-2),
        }),
        task("Sort the reading pile", -1, { completed: true, completedAt: completedOn(-1) }),
        ...(scenario === "dense"
          ? Array.from({ length: 12 }, (_, index) =>
              task(`Review reading note ${index + 1}`, -(index + 1)),
            )
          : []),
        task(long ? longText : "Compare the lighting options", 0, { projectId }),
        task("Pick up repaired headphones", 0, { dueTime: "17:00:00" }),
        task("Ask Sam about the reading group", null),
        task("Measure the shelves", 2, { projectId }),
        task("Turn in the problem set", 0, {
          recurrence: { freq: "weekly", interval: 1, until: null },
        }),
        task("Choose a paint sample", 0, {
          projectId,
          completed: true,
          completedAt: completedOn(0),
        }),
      ];
let ideas: Idea[] = personal
  ? personal.ideas
  : empty
    ? []
    : [
        {
          ...base(),
          title: long ? longText : "A softer place to land",
          body: "A lamp near the reading chair. A tray by the door for keys. Fewer things that need a decision at the end of the day.",
          projectId,
        },
        {
          ...base(),
          title: null,
          body: "Try a Sunday walk without a destination\nBring a notebook, leave enough time to stop.",
          projectId: null,
        },
        {
          ...base(),
          title: "Dinner with friends",
          body: "Soup, fresh bread, and a shared playlist. Ask everyone to bring one song.",
          projectId: null,
        },
      ];
const deleted = new Map<string, unknown>();
const token = "2026-09-04T12:00:00.123456Z" as DeleteUndoToken;
function check() {
  if (scenario === "error")
    throw new Error("This fictional connection is unavailable. Your input is still here.");
}
function page<T>(rows: T[], options: ListOptions = {}) {
  check();
  return rows.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50));
}
function find<T extends { id: string }>(rows: T[], rowId: string): T {
  const row = rows.find((r) => r.id === rowId);
  if (!row) throw new Error("Record not found.");
  return row;
}
function save<T extends { id: string }>(rows: T[], row: T): T {
  const index = rows.findIndex((r) => r.id === row.id);
  if (index < 0) rows.unshift(row);
  else rows[index] = row;
  return row;
}
function currentToday(date: string): TodayTodo[] {
  return sortTodayTodos(
    todos
      .filter((t) => !t.completed && t.dueDate !== null && t.dueDate <= date)
      .map((t) => ({
        ...t,
        completed: false as const,
        completedAt: null,
        dueDate: t.dueDate!,
        isOverdue: t.dueDate! < date,
        isManuallyOrdered: t.todayRank !== null,
        projectTitle: projects.find((p) => p.id === t.projectId)?.title ?? null,
      })),
  );
}
const classFixture = createClassPersistenceFixture(
  empty,
  scenario === "dense",
  personal ? { owner: userId, classes: personal.classes, notes: personal.notes } : undefined,
);
async function withClassName<T extends Todo>(todo: T): Promise<T> {
  const classes = await classFixture.classes.list(userId, new AbortController().signal);
  return { ...todo, className: classes.find((course) => course.id === todo.classId)?.name ?? null };
}
const todoService: TodoService = {
  async loadWorkspace(options) {
    check();
    return {
      profile,
      classes: await classFixture.classes.list(userId, options.signal),
      projects,
      todos: await Promise.all(
        todos
          .filter((todo) => !options.classId || todo.classId === options.classId)
          .map(withClassName),
      ),
    };
  },
  async loadToday(date) {
    check();
    return Promise.all(currentToday(date).map(withClassName));
  },
  async createTodo(input) {
    check();
    const existing = todos.find((todo) => todo.id === input.id);
    if (existing) return existing;
    const row = {
      ...task(input.text, null),
      ...input,
      dueDate: input.dueDate ?? null,
      dueTime: input.dueTime ?? null,
      projectId: input.projectId ?? null,
    };
    const saved = await withClassName(row);
    todos.push(saved);
    return saved;
  },
  async updateTodoDetails(rowId, input) {
    check();
    return save(todos, await withClassName({ ...find(todos, rowId), ...input }));
  },
  async setTodoCompleted(rowId, completed) {
    check();
    // The whole-workspace fixture exercises layout, not the repeat loop; the
    // Tasks fixture is where a completion produces the next occurrence.
    const todo = save(todos, {
      ...find(todos, rowId),
      completed,
      completedAt: completed ? now : null,
    });
    return { todo, spawned: null, withdrawn: null };
  },
  async softDeleteTodo(rowId) {
    check();
    deleted.set(rowId, find(todos, rowId));
    todos = todos.filter((t) => t.id !== rowId);
    return token;
  },
  async restoreTodo(rowId) {
    const row = deleted.get(rowId) as Todo;
    if (!row) return false;
    todos.push(row);
    deleted.delete(rowId);
    return true;
  },
  async reorderToday(_date, ids) {
    return ids.map((rowId, index) => {
      const todayRank = (index + 1) * 1024;
      save(todos, { ...find(todos, rowId), todayRank });
      return { todoId: rowId, todayRank };
    });
  },
};
const rowsFor = (kind: CollectionKind) => (kind === "project" ? projects : ideas);
const collectionService: CollectionService = {
  async listProjects(o = {}) {
    return page(
      projects.filter((p) =>
        o.status === undefined
          ? p.status !== "archived"
          : o.status === "all" || p.status === o.status,
      ),
      o,
    );
  },
  async listIdeas(o = {}) {
    return page(
      ideas.filter((i) => !o.projectId || i.projectId === o.projectId),
      o,
    );
  },
  async getProject(rowId) {
    return find(projects, rowId);
  },
  async getIdea(rowId) {
    return find(ideas, rowId);
  },
  async getTodo(rowId) {
    return find(todos, rowId);
  },
  async saveProject(input, rowId) {
    check();
    return save(projects, {
      ...(rowId ? find(projects, rowId) : base()),
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "active",
    });
  },
  async saveIdea(input, rowId) {
    check();
    return save(ideas, {
      ...(rowId ? find(ideas, rowId) : base()),
      title: input.title ?? null,
      body: input.body,
      projectId: input.projectId ?? null,
    });
  },
  async softDelete(kind, rowId) {
    check();
    deleted.set(rowId, find<Project | Idea>(rowsFor(kind), rowId));
    projects = projects.filter((p) => kind !== "project" || p.id !== rowId);
    ideas = ideas.filter((i) => kind !== "idea" || i.id !== rowId);
    return token;
  },
  async restore(kind, rowId) {
    const row = deleted.get(rowId);
    if (!row) return false;
    if (kind === "project") projects.push(row as Project);
    else ideas.push(row as Idea);
    deleted.delete(rowId);
    return true;
  },
  async projectTodos(rowId, offset = 0) {
    return page(
      todos
        .filter((t) => t.projectId === rowId)
        .sort((a, b) => Number(a.completed) - Number(b.completed)),
      { offset },
    );
  },
  // A substring stub, not the search_records RPC: it proves the result list
  // renders every kind, never what the database matches. See docs/CLOUD_DEVELOPMENT.md.
  async search(query, offset = 0) {
    check();
    const signal = new AbortController().signal;
    const courses = await classFixture.classes.list(userId, signal);
    const notes = (
      await Promise.all(courses.map((course) => classFixture.notes.list(userId, course.id, signal)))
    ).flat();
    const rows: SearchResult[] = [
      ...projects.map((p) => ({
        recordType: "project" as const,
        recordId: p.id,
        parentId: null,
        title: p.title,
        snippet: p.description ?? "",
        updatedAt: now,
        relevance: 1,
        totalCount: 0,
      })),
      ...ideas.map((i) => ({
        recordType: "idea" as const,
        recordId: i.id,
        parentId: null,
        title: i.title ?? i.body.slice(0, 160),
        // Like search_records: an idea with no title of its own is named by the
        // opening of its body, and the snippet carries only what is left of it.
        snippet: i.title ? i.body : i.body.slice(160).trim(),
        updatedAt: now,
        relevance: 1,
        totalCount: 0,
      })),
      ...todos.map((t) => ({
        recordType: t.classId ? ("assignment" as const) : ("todo" as const),
        recordId: t.id,
        parentId: t.classId ?? null,
        title: t.text,
        snippet: "",
        updatedAt: now,
        relevance: 1,
        totalCount: 0,
      })),
      ...courses.map((c) => ({
        recordType: "class" as const,
        recordId: c.id,
        parentId: null,
        title: c.name ?? c.id,
        snippet: c.name ? c.id : "",
        updatedAt: now,
        relevance: 1,
        totalCount: 0,
      })),
      ...notes.map((n) => ({
        recordType: "class_note" as const,
        recordId: n.id,
        parentId: n.course_id,
        title: n.name,
        snippet: "",
        updatedAt: now,
        relevance: 1,
        totalCount: 0,
      })),
    ].filter((r) =>
      `${r.title} ${r.snippet} ${r.parentId ?? ""}`.toLowerCase().includes(query.toLowerCase()),
    );
    return rows.slice(offset, offset + 40).map((r) => ({ ...r, totalCount: rows.length }));
  },
};
const storagePrefix = `apraxia:qa:workspace:v3:${scenario}:${today}`;
const calendarKey = `${storagePrefix}:calendar`;
const appearanceKey = `${storagePrefix}:appearance`;
const storage = {
  getItem: (key: string) => window.sessionStorage.getItem(key),
  setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
  removeItem: (key: string) => window.sessionStorage.removeItem(key),
};
const delay = scenario === "slow" ? 1500 : 180;
const cover = ["realistic", "personal", "dense", "portrait", "slow"].includes(scenario)
  ? createFixtureCover(scenario === "portrait")
  : null;
const calendarService = delayedFixtureService(
  createFixtureCalendar({
    scenario,
    timezone,
    storage,
    storageKey: calendarKey,
    weekEvents: personal?.events,
  }),
  delay,
);
const workspaceData = {
  ...classFixture,
  assignments: delayedFixtureService(createTodoAssignmentService(todoService), delay),
  classOverview: delayedFixtureService(
    {
      list: async (owner: string, signal: AbortSignal) => {
        check();
        const courses = await classFixture.classes.list(owner, signal);
        const noteCounts: Record<string, number> = {};
        for (const course of courses)
          noteCounts[course.id] = (await classFixture.notes.list(owner, course.id, signal)).filter(
            isNoteSaved,
          ).length;
        return summarizeClasses(
          todos
            .filter((todo) => todo.classId)
            .map((todo) => ({
              id: todo.id,
              classId: todo.classId!,
              title: todo.text,
              due: todo.dueDate,
              done: todo.completed,
            })),
          noteCounts,
        );
      },
    },
    delay,
  ),
  homeAppearance: delayedFixtureService(
    createFixtureAppearance(storage, appearanceKey, cover),
    delay,
  ),
  profile: async () => profile,
  projects: async () => projects.map(({ id, title }) => ({ id, title })),
  setTimezone: async (_userId: string, nextTimezone: string) => {
    check();
    profile = { ...profile, timezone: nextTimezone, updatedAt: new Date().toISOString() };
    return profile;
  },
};
const careerService = delayedFixtureService(createCareerFixtureService(today, scenario), delay);
const runtimeTodos = delayedFixtureService(todoService, delay);
const runtimeCollections = delayedFixtureService(collectionService, delay);
const runtimeData = delayedFixtureService(workspaceData, delay);

function FixtureTools() {
  const location = useLocation();
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("route", location.pathname);
    window.history.replaceState(null, "", url);
  }, [location.pathname]);
  return (
    <details className="workspace-qa-tools">
      <summary>QA · {scenario}</summary>
      <p>
        {scenario !== "personal"
          ? "Fictional data · production layout and navigation cache."
          : personal
            ? `Private snapshot captured ${personal.capturedOn}, re-dated to this week. Refresh it with npm run qa:snapshot.`
            : "No snapshot on this machine, so this is the realistic seed. Run npm run qa:snapshot."}
      </p>
      <label>
        Scenario{" "}
        <select
          value={scenario}
          onChange={(event) => {
            const url = new URL(window.location.href);
            url.searchParams.set("scenario", event.target.value);
            window.location.assign(url);
          }}
        >
          {[
            "realistic",
            "personal",
            "calendar",
            "typical",
            "empty",
            "dense",
            "long",
            "portrait",
            "slow",
            "error",
            "disconnected",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <p>
        Calendar edits and page appearance survive reload in this tab. Tasks and collections reset
        on reload. No Google or database connection.
      </p>
      <p>
        Check event colors, overlap, adjacent 15-minute events, clipped titles and times, then
        expand/collapse the cover. Use Customize page to try your own image.
      </p>
      <button
        onClick={() => {
          storage.removeItem(calendarKey);
          storage.removeItem(appearanceKey);
          window.location.reload();
        }}
      >
        Reset calendar and cover
      </button>
    </details>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MemoryRouter initialEntries={[params.get("route") ?? "/"]}>
      <WorkspaceRuntime
        identity={{ userId, email: "alex@example.invalid", expiresAt: null }}
        signOutStatus="idle"
        onSignOut={async () => {
          window.alert("Fictional QA account signed out. No real session was changed.");
        }}
        todoService={runtimeTodos}
        collectionService={runtimeCollections}
        calendarService={calendarService}
        careerService={careerService}
        driveService={driveService}
        workspaceData={runtimeData}
      />
      <FixtureTools />
    </MemoryRouter>
  </StrictMode>,
);
