import { createClassPersistenceFixture } from './classPersistenceFixture';
import type { DriveService } from '../features/classes/driveService';
import { createFixturePdf } from './fixturePdf';
import { createFixtureAssignments } from "./ClassAssignmentsMock";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { WorkspaceRuntime } from "../apps/WorkspaceRuntime";
import { createFixtureCalendar } from "./workspaceFixtureCalendar";
import { createFixtureAppearance, createFixtureCover, delayedFixtureService } from "./workspaceFixtureSupport";
import "./workspaceFixture.css";
import type { TodoService } from "../features/todos/todoService";
import type { CollectionKind, CollectionService, ListOptions } from "../features/collections/collectionService";
import { addSqlDateDays, localToday } from "../features/todos/dateDomain";
import { sortTodayTodos } from "../features/todos/todayOrder";
import type { DeleteUndoToken, Idea, MediaItem, Project, SearchResult, TodayTodo, Todo } from "../types/domain";
import "../index.css";

// Separate Vite development entry. All identities and records below are fictional.
// Calendar and appearance use isolated tab storage; no credentials or network requests.
if (!import.meta.env.DEV) throw new Error("The QA fixture is development-only.");
const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") ?? "realistic";
const empty = scenario === "empty";
const long = scenario === "long" || scenario === "dense";
let driveConnected = params.get('drive') !== 'disconnected';
const driveService: DriveService = {
  status: async () => ({ connectionState: driveConnected ? 'connected' : 'disconnected' }),
  connect: async () => { throw new Error('Google consent is unavailable in the fictional fixture.'); },
  disconnect: async () => { driveConnected = false; },
  files: async folder => {
    if (params.get('drive') === 'error') throw new Error('Google Drive could not load. Try again.');
    return { files: folder === 'root' ? [{ id: 'math-notes', name: 'MATH3012 notes', folder: true, modifiedTime: null, size: null }] :
      [{ id: 'lecture-one', name: 'Lecture 1 - Counting.pdf', folder: false, modifiedTime: null, size: '1024' }], nextPage: null };
  },
  pickPdf: async () => ({ id: 'lecture-one', name: 'Lecture 1 - Counting.pdf', folder: false, modifiedTime: null, size: null }),
  pdf: async () => createFixturePdf(),
};
const now = new Date().toISOString();
const timezone = "America/New_York";
const today = localToday(timezone);
const userId = "11111111-1111-4111-8111-111111111111";
let sequence = 100;
const id = () => `22222222-2222-4222-8222-${String(sequence++).padStart(12, "0")}`;
const profile = { userId, timezone, createdAt: now, updatedAt: now };
const base = () => ({ id: id(), createdAt: now, updatedAt: now });
const longText = "Plan the studio gathering, including the guest list, accessible arrival directions, food preferences, and the quiet corner for anyone who needs a break";
let projects: Project[] = empty ? [] : [
  { ...base(), title: long ? longText : "Studio refresh", description: "Make room for reading, writing, and a friend stopping by.", status: "active" },
  { ...base(), title: "Autumn weekend away", description: "A small trip, with room to wander.", status: "someday" },
  { ...base(), title: "Summer reading", description: null, status: "completed" },
];
const projectId = projects[0]?.id ?? null;
const task = (text: string, offset: number | null, extra: Partial<Todo> = {}): Todo => ({
  ...base(), text, dueDate: offset === null ? null : addSqlDateDays(today, offset), dueTime: null,
  completed: false, completedAt: null, projectId: null, todayRank: null, ...extra,
});
let todos: Todo[] = empty ? [] : [
  task("Return the library books", -3), task("Send the venue confirmation", -1),
  task(long ? longText : "Compare the lighting options", 0, { projectId }),
  task("Pick up repaired headphones", 0, { dueTime: "17:00:00" }),
  task("Ask Sam about the reading group", null), task("Measure the shelves", 2, { projectId }),
  task("Choose a paint sample", 0, { projectId, completed: true, completedAt: now }),
];
let ideas: Idea[] = empty ? [] : [
  { ...base(), title: long ? longText : "A softer place to land", body: "A lamp near the reading chair. A tray by the door for keys. Fewer things that need a decision at the end of the day.", projectId },
  { ...base(), title: null, body: "Try a Sunday walk without a destination\nBring a notebook, leave enough time to stop.", projectId: null },
  { ...base(), title: "Dinner with friends", body: "Soup, fresh bread, and a shared playlist. Ask everyone to bring one song.", projectId: null },
];
let media: MediaItem[] = empty ? [] : [
  { ...base(), mediaType: "book", title: long ? longText : "A Field Guide to Getting Lost", creator: "Rebecca Solnit", releaseYear: 2005, status: "in_progress", rating: null, notes: "For slow mornings." },
  { ...base(), mediaType: "movie", title: "Perfect Days", creator: "Wim Wenders", releaseYear: 2023, status: "saved", rating: null, notes: null },
  { ...base(), mediaType: "book", title: "The Summer Book", creator: "Tove Jansson", releaseYear: 1972, status: "finished", rating: 5, notes: null },
];
const deleted = new Map<string, unknown>();
const token = "2026-09-04T12:00:00.123456Z" as DeleteUndoToken;
function check() { if (scenario === "error") throw new Error("This fictional connection is unavailable. Your input is still here."); }
function page<T>(rows: T[], options: ListOptions = {}) { check(); return rows.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50)); }
function find<T extends { id: string }>(rows: T[], rowId: string): T { const row = rows.find(r => r.id === rowId); if (!row) throw new Error("Record not found."); return row; }
function save<T extends { id: string }>(rows: T[], row: T): T { const index = rows.findIndex(r => r.id === row.id); if (index < 0) rows.unshift(row); else rows[index] = row; return row; }
function currentToday(date: string): TodayTodo[] {
  return sortTodayTodos(todos.filter(t => !t.completed && t.dueDate !== null && t.dueDate <= date).map(t => ({
    ...t, completed: false as const, completedAt: null, dueDate: t.dueDate!, isOverdue: t.dueDate! < date,
    isManuallyOrdered: t.todayRank !== null, projectTitle: projects.find(p => p.id === t.projectId)?.title ?? null,
  })));
}
const todoService: TodoService = {
  async loadWorkspace() { check(); return { profile, projects, todos: [...todos] }; },
  async loadToday(date) { check(); return currentToday(date); },
  async createTodo(input) { check(); const row = { ...task(input.text, null), ...input, dueDate: input.dueDate ?? null, dueTime: input.dueTime ?? null, projectId: input.projectId ?? null }; todos.push(row); return row; },
  async updateTodoDetails(rowId, input) { check(); return save(todos, { ...find(todos, rowId), ...input }); },
  async setTodoCompleted(rowId, completed) { check(); return save(todos, { ...find(todos, rowId), completed, completedAt: completed ? now : null }); },
  async softDeleteTodo(rowId) { check(); deleted.set(rowId, find(todos, rowId)); todos = todos.filter(t => t.id !== rowId); return token; },
  async restoreTodo(rowId) { const row = deleted.get(rowId) as Todo; if (!row) return false; todos.push(row); deleted.delete(rowId); return true; },
  async reorderToday(_date, ids) { return ids.map((rowId, index) => { const todayRank = (index + 1) * 1024; save(todos, { ...find(todos, rowId), todayRank }); return { todoId: rowId, todayRank }; }); },
};
const rowsFor = (kind: CollectionKind) => kind === "project" ? projects : kind === "idea" ? ideas : media;
const collectionService: CollectionService = {
  async listProjects(o = {}) { return page(projects.filter(p => !o.status || o.status === "all" || p.status === o.status), o); },
  async listIdeas(o = {}) { return page(ideas.filter(i => !o.projectId || i.projectId === o.projectId), o); },
  async listMedia(o = {}) { return page(media.filter(m => (!o.mediaType || o.mediaType === "all" || m.mediaType === o.mediaType) && (!o.status || o.status === "all" || m.status === o.status)), o); },
  async getProject(rowId) { return find(projects, rowId); }, async getIdea(rowId) { return find(ideas, rowId); },
  async getMedia(rowId) { return find(media, rowId); }, async getTodo(rowId) { return find(todos, rowId); },
  async saveProject(input, rowId) { check(); return save(projects, { ...(rowId ? find(projects, rowId) : base()), title: input.title, description: input.description ?? null, status: input.status ?? "active" }); },
  async saveIdea(input, rowId) { check(); return save(ideas, { ...(rowId ? find(ideas, rowId) : base()), title: input.title ?? null, body: input.body, projectId: input.projectId ?? null }); },
  async saveMedia(input, rowId) { check(); return save(media, { ...(rowId ? find(media, rowId) : base()), mediaType: input.mediaType, title: input.title, creator: input.creator ?? null, releaseYear: input.releaseYear ?? null, status: input.status ?? "saved", rating: input.rating ?? null, notes: input.notes ?? null }); },
  async softDelete(kind, rowId) { check(); deleted.set(rowId, find<Project | Idea | MediaItem>(rowsFor(kind), rowId)); projects = projects.filter(p => kind !== "project" || p.id !== rowId); ideas = ideas.filter(i => kind !== "idea" || i.id !== rowId); media = media.filter(m => kind !== "media" || m.id !== rowId); return token; },
  async restore(kind, rowId) { const row = deleted.get(rowId); if (!row) return false; if (kind === "project") projects.push(row as Project); else if (kind === "idea") ideas.push(row as Idea); else media.push(row as MediaItem); deleted.delete(rowId); return true; },
  async projectTodos(rowId, offset = 0) { return page(todos.filter(t => t.projectId === rowId).sort((a, b) => Number(a.completed) - Number(b.completed)), { offset }); },
  async search(query, offset = 0) {
    check(); const rows: SearchResult[] = [
      ...projects.map(p => ({ recordType: "project" as const, recordId: p.id, title: p.title, snippet: p.description ?? "", updatedAt: now, relevance: 1, totalCount: 0 })),
      ...ideas.map(i => ({ recordType: "idea" as const, recordId: i.id, title: i.title ?? i.body.split("\n")[0], snippet: i.body, updatedAt: now, relevance: 1, totalCount: 0 })),
      ...media.map(m => ({ recordType: "media" as const, recordId: m.id, title: m.title, snippet: m.creator ?? "", updatedAt: now, relevance: 1, totalCount: 0 })),
      ...todos.map(t => ({ recordType: "todo" as const, recordId: t.id, title: t.text, snippet: "", updatedAt: now, relevance: 1, totalCount: 0 })),
    ].filter(r => `${r.title} ${r.snippet}`.toLowerCase().includes(query.toLowerCase()));
    return rows.slice(offset, offset + 40).map(r => ({ ...r, totalCount: rows.length }));
  },
};
const storagePrefix = `orbitos:qa:workspace:v3:${scenario}:${today}`;
const calendarKey = `${storagePrefix}:calendar`;
const appearanceKey = `${storagePrefix}:appearance`;
const storage = {
  getItem: (key: string) => window.sessionStorage.getItem(key),
  setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
  removeItem: (key: string) => window.sessionStorage.removeItem(key),
};
const delay = scenario === "slow" ? 1500 : 180;
const cover = ["realistic", "dense", "portrait", "slow"].includes(scenario) ? createFixtureCover(scenario === "portrait") : null;
const calendarService = delayedFixtureService(createFixtureCalendar({ scenario, timezone, storage, storageKey: calendarKey }), delay);
const workspaceData = {
  ...createClassPersistenceFixture(empty),
  assignments: delayedFixtureService(createFixtureAssignments(empty), delay),
  homeAppearance: delayedFixtureService(createFixtureAppearance(storage, appearanceKey, cover), delay),
  profile: async () => profile,
  projects: async () => projects.map(({ id, title }) => ({ id, title })),
};
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
  return <details className="workspace-qa-tools">
    <summary>QA · {scenario}</summary>
    <p>Fictional data · production layout and navigation cache.</p>
    <label>Scenario <select value={scenario} onChange={event => {
      const url = new URL(window.location.href); url.searchParams.set("scenario", event.target.value); window.location.assign(url);
    }}>
      {["realistic", "calendar", "typical", "empty", "dense", "long", "portrait", "slow", "error", "disconnected"].map(value => <option key={value}>{value}</option>)}
    </select></label>
    <p>Calendar edits and page appearance survive reload in this tab. Tasks and collections reset on reload. No Google or database connection.</p>
    <p>Check event colors, overlap, adjacent 15-minute events, clipped titles and times, then expand/collapse the cover. Use Customize page to try your own image.</p>
    <button onClick={() => { storage.removeItem(calendarKey); storage.removeItem(appearanceKey); window.location.reload(); }}>Reset calendar and cover</button>
  </details>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><MemoryRouter initialEntries={[params.get("route") ?? "/"]}>
  <WorkspaceRuntime identity={{ userId, email: "alex@example.invalid", expiresAt: null }} signOutStatus="idle"
    onSignOut={async () => { window.alert("Fictional QA account signed out. No real session was changed."); }}
    todoService={runtimeTodos} collectionService={runtimeCollections} calendarService={calendarService} driveService={driveService}
    workspaceData={runtimeData} />
  <FixtureTools />
</MemoryRouter></StrictMode>);
