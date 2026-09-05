import type { EventDetail } from "../../../shared/calendarEventContract";
import type { CalendarEvent } from "../types/domain";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Temporal } from "@js-temporal/polyfill";
import { MainWorkspace } from "../apps/MainWorkspace";
import type { TodoService } from "../features/todos/todoService";
import type { CalendarService } from "../features/calendar/calendarService";
import type { CollectionKind, CollectionService, ListOptions } from "../features/collections/collectionService";
import { addSqlDateDays, localToday } from "../features/todos/dateDomain";
import { sortTodayTodos } from "../features/todos/todayOrder";
import type { CalendarPreference, DeleteUndoToken, Idea, MediaItem, Project, SearchResult, TodayTodo, Todo } from "../types/domain";
import "../index.css";

// Separate Vite development entry. All identities and records below are fictional.
// Nothing reads credentials, sends requests, or persists outside this page lifetime.
if (!import.meta.env.DEV) throw new Error("The QA fixture is development-only.");
const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") ?? "typical";
const empty = scenario === "empty";
const long = scenario === "long";
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
let connected = scenario !== "disconnected";
let preferences: CalendarPreference[] = [{ ...base(), calendarId: "personal", displayName: long ? longText : "Personal", color: { background: "#91b0d7", foreground: "#ffffff" }, isVisible: true, canEdit: true, lastSeenAt: now }, { ...base(), calendarId: "work", displayName: "Work", color: { background: "#c5b293", foreground: "#ffffff" }, isVisible: true, canEdit: true, lastSeenAt: now }];
const fixtureEvents = new Map<string, EventDetail>();
const seededWeeks = new Set<string>();
const calendarService: CalendarService = {
  async eventDetail(calendarId, eventId) {
    check(); const detail = fixtureEvents.get(eventId);
    if (!detail || detail.calendarId !== calendarId) throw new Error('Event not found.');
    return structuredClone(detail);
  },
  async mutateEvent(command) {
    check();
    if (command.action === 'delete') fixtureEvents.delete(command.eventId);
    else {
      const current = fixtureEvents.get(command.eventId);
      const recurrence = command.values.recurrence ?? current?.values.recurrence ?? [];
      fixtureEvents.set(command.eventId, { eventId: command.eventId, calendarId: command.action === 'create' ? command.calendarId : command.destinationCalendarId,
        etag: id(), recurring: recurrence.length > 0, canMove: true, values: { ...command.values, recurrence } });
    }
    return { saved: true };
  },
  async status() { check(); return connected ? { ...base(), googleAccountId: null, displayEmail: "alex@example.invalid", connectionState: "connected", grantedScopes: [], lastSuccessfulRefreshAt: now } : null; },
  async calendars() { return preferences; }, async setVisibility(rowId, isVisible) { preferences = preferences.map(p => p.id === rowId ? { ...p, isVisible } : p); },
  async disconnect() { connected = false; }, async connect() { connected = true; return window.location.href; },
  async week(monday) {
    check(); const instant = (day: number, hour: number, minute = 0) => Temporal.PlainDate.from(monday).add({ days: day }).toZonedDateTime({ timeZone: timezone, plainTime: { hour, minute } }).toInstant().toString();
    const common = { calendarId: "personal", calendarColor: preferences[0].color, googleEventUrl: "https://calendar.google.com" };
    const model = { range: { monday, sunday: addSqlDateDays(monday, 6) }, timezone, visibleCalendars: preferences.filter(p => p.isVisible).map(p => ({ ...p, isVisible: true as const })), partialErrors: [], events: empty || !preferences[0].isVisible ? [] : [
      { ...common, kind: "all_day", eventId: "trip", title: "Studio open week", startDate: monday, endDateExclusive: addSqlDateDays(monday, 3) },
      ...[{ day: 0, start: 9, end: 10, title: "Weekly planning" }, { day: 1, start: 10, end: 12, title: "A morning to write" }, { day: 1, start: 11, end: 12, title: "Coffee with Sam" }, { day: 3, start: 13, end: 14, title: "Lunch at the park" }, { day: 4, start: 9, end: 10, title: long ? longText : "Reading group" }].map((e, i) => ({ ...common, kind: "timed" as const, eventId: String(i), title: e.title, startAt: instant(e.day, e.start), endAt: instant(e.day, e.end), startTimeZone: timezone, endTimeZone: timezone })),
    ] };
    if (!seededWeeks.has(monday)) {
      seededWeeks.add(monday);
      for (const original of model.events) {
        const event = original as CalendarEvent;
        const eventId = monday + event.eventId;
        fixtureEvents.set(eventId, { eventId, calendarId: event.calendarId, etag: id(), canMove: true, recurring: false,
          values: { title: event.title, location: '', timeZone: timezone, recurrence: [], timing: event.kind === 'all_day'
            ? { kind: 'all_day', start: event.startDate, end: event.endDateExclusive }
            : { kind: 'timed', start: event.startAt, end: event.endAt } } });
      }
    }
    const events: CalendarEvent[] = [...fixtureEvents.values()].filter(event => preferences.some(p => p.calendarId === event.calendarId && p.isVisible)).map(event => {
      const p = preferences.find(p => p.calendarId === event.calendarId)!;
      const common = { eventId: event.eventId, calendarId: event.calendarId, calendarColor: p.color, googleEventUrl: 'https://calendar.google.com', title: event.values.title || '(No title)' };
      return event.values.timing.kind === 'all_day'
        ? { ...common, kind: 'all_day', startDate: event.values.timing.start, endDateExclusive: event.values.timing.end }
        : { ...common, kind: 'timed', startAt: event.values.timing.start, endAt: event.values.timing.end, startTimeZone: timezone, endTimeZone: timezone };
    });
    return { ...model, events };
  },
};
createRoot(document.getElementById("root")!).render(<StrictMode><MemoryRouter initialEntries={[params.get("route") ?? "/"]}>
  <MainWorkspace identity={{ userId, email: "alex@example.invalid", expiresAt: null }} signOutStatus="idle"
    onSignOut={async () => { window.alert("Fictional QA account signed out. No real session was changed."); }}
    todoService={todoService} collectionService={collectionService} calendarService={calendarService}
    workspaceData={{ profile: async () => profile, projects: async () => projects.map(({ id, title }) => ({ id, title })) }} />
</MemoryRouter></StrictMode>);
