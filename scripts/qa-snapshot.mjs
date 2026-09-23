// Writes a private reproduction of the account's workspace for the QA fixture's
// `personal` scenario. Read-only: every request is a GET against the personal
// agent API. The output is gitignored and must never be committed; it holds no
// token, owner id, or Google event URL.
//
//   npm run qa:snapshot
//
// Connection settings come from the environment or `.env.muse.local`
// (APRAXIA_BASE_URL, APRAXIA_AGENT_TOKEN); see docs/AGENT_API.md.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "frontend/qa/local/workspace-snapshot.json");
const envFile = resolve(root, ".env.muse.local");
if (!process.env.APRAXIA_AGENT_TOKEN && existsSync(envFile)) process.loadEnvFile(envFile);

const baseUrl = process.env.APRAXIA_BASE_URL?.replace(/\/$/, "");
const token = process.env.APRAXIA_AGENT_TOKEN;
if (!baseUrl || !token) {
  console.error(
    "Set APRAXIA_BASE_URL and APRAXIA_AGENT_TOKEN, or create .env.muse.local (docs/AGENT_API.md).",
  );
  process.exit(1);
}

async function get(path) {
  const response = await fetch(`${baseUrl}/api/agent/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`GET ${path.split("?")[0]} failed with ${response.status}.`);
  return response.json();
}

async function list(bucket) {
  const items = [];
  for (let offset = 0; offset !== null;) {
    const page = await get(`${bucket}?limit=100&offset=${offset}`);
    items.push(...page.items);
    offset = page.next_offset;
  }
  return items.filter((item) => !item.deleted_at);
}

const DAY_MS = 86_400_000;
const sqlDate = (date) => date.toISOString().slice(0, 10);

/** Wall-clock date and minute of an instant in `timeZone`. */
function wallClock(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const dayOffset = (date, sunday) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${sunday}T00:00:00Z`)) / DAY_MS);

const [todos, projects, ideas, classes] = await Promise.all(
  ["todos", "projects", "ideas", "classes"].map(list),
);

// The week on screen today, Sunday-first as the calendar API expects. The
// account's timezone is only known from a reply, so a UTC guess goes first and
// is corrected when the local date falls in a different week.
const sundayOf = (date) =>
  sqlDate(
    new Date(Date.parse(`${date}T00:00:00Z`) - new Date(`${date}T00:00:00Z`).getUTCDay() * DAY_MS),
  );
let sunday = sundayOf(sqlDate(new Date()));
let week = await get(`events?sunday=${sunday}`);
const timezone = week.timezone;
const capturedOn = wallClock(Date.now(), timezone).date;
if (sundayOf(capturedOn) !== sunday) {
  sunday = sundayOf(capturedOn);
  week = await get(`events?sunday=${sunday}`);
}

const calendarIds = [...new Set(week.events.map((event) => event.calendarId))];
const events = week.events.map((event) => {
  const common = {
    title: event.title ?? "",
    color: event.calendarColor?.background ?? null,
    // An index, not the Google calendar id: the fixture has its own calendars.
    calendar: calendarIds.indexOf(event.calendarId),
  };
  if (event.startAt.length === 10)
    return {
      ...common,
      kind: "all_day",
      startDay: dayOffset(event.startAt, sunday),
      endDay: dayOffset(event.endAt, sunday),
    };
  const start = wallClock(event.startAt, timezone);
  const end = wallClock(event.endAt, timezone);
  return {
    ...common,
    kind: "timed",
    startDay: dayOffset(start.date, sunday),
    startMinute: start.minute,
    endDay: dayOffset(end.date, sunday),
    endMinute: end.minute,
  };
});

const snapshot = {
  version: 1,
  capturedOn,
  timezone,
  projects: projects.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })),
  ideas: ideas.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })),
  classes: classes.map((row) => ({ id: row.id, name: row.name })),
  todos: todos.map((row) => ({
    id: row.id,
    text: row.text,
    completed: row.completed,
    completedAt: row.completed_at,
    dueDate: row.due_date,
    dueTime: row.due_time,
    classId: row.class_id,
    assignmentType: row.assignment_type ?? "",
    projectId: row.project_id,
    todayRank: row.today_rank,
    recurrence: row.recurrence_freq
      ? {
          freq: row.recurrence_freq,
          interval: row.recurrence_interval ?? 1,
          until: row.recurrence_until,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })),
  events,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(
  `Wrote ${todos.length} tasks, ${projects.length} projects, ${ideas.length} ideas, ` +
    `${classes.length} classes, ${events.length} events ` +
    `(captured ${capturedOn}) to frontend/qa/local/workspace-snapshot.json`,
);
