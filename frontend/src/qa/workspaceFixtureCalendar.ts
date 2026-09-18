import { Temporal } from "@js-temporal/polyfill";
import { normalizeGoogleEvent } from "../../../server/calendar/normalizeGoogleEvent";
import { eventCommandSchema, type EventDetail } from "../../../shared/calendarEventContract";
import { CalendarServiceError, type CalendarService } from "../features/calendar/calendarService";
import { addSqlDateDays } from "../features/todos/dateDomain";
import type { CalendarEvent, CalendarPreference } from "../types/domain";
import type { PersonalSnapshotEvent } from "./personalSnapshot";

export interface FixtureStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface StoredEvent {
  detail: EventDetail;
  color: string | null;
}
interface CalendarState {
  connected: boolean;
  preferences: CalendarPreference[];
  events: StoredEvent[];
  seededWeeks: string[];
}

export function createFixtureCalendar({
  scenario,
  timezone,
  storage,
  storageKey,
  weekEvents,
}: {
  /** The `personal` scenario's captured week, replayed in every week shown. */
  weekEvents?: PersonalSnapshotEvent[];
  scenario: string;
  timezone: string;
  storage?: FixtureStorage;
  storageKey: string;
}): CalendarService {
  const now = new Date().toISOString();
  const calendar = (
    calendarId: string,
    displayName: string,
    background: string | null,
    canEdit = true,
    isVisible = true,
  ): CalendarPreference => ({
    id: calendarId,
    calendarId,
    displayName,
    color: { background, foreground: null },
    canEdit,
    isVisible,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  });
  const saved = storage?.getItem(storageKey);
  let state: CalendarState = saved
    ? JSON.parse(saved)
    : {
        connected: scenario !== "disconnected",
        preferences: [
          calendar("personal", "Personal", "#039be5"),
          calendar("work", "Work and study", "#7986cb"),
          calendar("shared", "Shared calendar · view only", "#0b8043", false),
          calendar("uncolored", "Calendar without a color", null),
          calendar("hidden", "Hidden calendar", "#d50000", true, false),
        ],
        events: [],
        seededWeeks: [],
      };
  function commit(next: CalendarState) {
    storage?.setItem(storageKey, JSON.stringify(next));
    state = next;
  }
  function check(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (scenario === "error")
      throw new CalendarServiceError(
        "This fictional connection is unavailable. Try another QA scenario.",
        "calendar_unavailable",
      );
  }
  function requireEditable(calendarId: string) {
    if (!state.preferences.some((p) => p.calendarId === calendarId && p.canEdit)) {
      throw new CalendarServiceError(
        "You do not have permission to make this change on that calendar.",
        "calendar_readonly",
      );
    }
  }
  function seed(sunday: string) {
    if (state.seededWeeks.includes(sunday)) return;
    const events: StoredEvent[] = [];
    const instant = (day: number, minute: number) =>
      Temporal.PlainDate.from(sunday)
        .add({ days: (day + 1) % 7 })
        .toZonedDateTime({
          timeZone: timezone,
          plainTime: { hour: Math.floor(minute / 60), minute: minute % 60 },
        })
        .toInstant()
        .toString();
    const add = (
      key: string,
      calendarId: string,
      title: string,
      timing: EventDetail["values"]["timing"],
      color: string | null = null,
      recurring = false,
    ) =>
      events.push({
        color,
        detail: {
          calendarId,
          eventId: `${sunday}-${key}`,
          etag: `"seed-${sunday}-${key}"`,
          recurring,
          canMove: !recurring,
          values: {
            title,
            timing,
            timeZone: timezone,
            location: "Fictional campus · Room 204",
            // Deliberately not the editor's defaults, so a series that opens on
            // interval 1 and no end date is a visible regression.
            recurrence: recurring ? ["RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=12"] : [],
          },
        },
      });
    const timed = (
      key: string,
      day: number,
      start: number,
      end: number,
      title: string,
      calendarId = "work",
      color: string | null = null,
      recurring = false,
    ) =>
      add(
        key,
        calendarId,
        title,
        { kind: "timed", start: instant(day, start), end: instant(day, end) },
        color,
        recurring,
      );
    if (weekEvents) {
      // The fixture's own calendars stand in for the account's, by index.
      const calendars = ["personal", "work", "uncolored"];
      // Days from Sunday, unwrapped: an event may end on the next week's Sunday.
      const at = (days: number, minute: number) =>
        Temporal.PlainDate.from(sunday)
          .add({ days })
          .toZonedDateTime({
            timeZone: timezone,
            plainTime: { hour: Math.floor(minute / 60), minute: minute % 60 },
          })
          .toInstant()
          .toString();
      weekEvents.forEach((event, index) => {
        const calendarId = calendars[event.calendar % calendars.length];
        if (event.kind === "all_day")
          add(
            `snapshot-${index}`,
            calendarId,
            event.title,
            {
              kind: "all_day",
              start: addSqlDateDays(sunday, event.startDay),
              end: addSqlDateDays(sunday, event.endDay),
            },
            event.color,
          );
        else
          add(
            `snapshot-${index}`,
            calendarId,
            event.title,
            {
              kind: "timed",
              start: at(event.startDay, event.startMinute ?? 0),
              end: at(event.endDay, event.endMinute ?? 0),
            },
            event.color,
          );
      });
    } else if (scenario === "calendar") {
      add("open-day", "personal", "Campus open day and welcome activities", {
        kind: "all_day",
        start: addSqlDateDays(sunday, 1),
        end: addSqlDateDays(sunday, 2),
      });
      timed(
        "math",
        0,
        570,
        645,
        "MATH 2100 — Introduction to Discrete Mathematics",
        "work",
        "#0b8043",
      );
      timed("work-mon", 0, 660, 840, "Work", "work", "#d81b60");
      timed("physics-tue", 1, 570, 645, "PHYS 1200 — Mechanics and Motion", "work", "#0b8043");
      timed(
        "workshop",
        1,
        660,
        710,
        "MATH 2100 — Discrete Mathematics (Workshop)",
        "work",
        "#0b8043",
      );
      timed("check-in", 1, 720, 735, "Check-in", "personal", "#039be5");
      timed("design", 2, 600, 675, "Design seminar and project discussion", "work", "#8e24aa");
      timed("office", 2, 630, 690, "Office hours", "work", "#e4c441");
      timed("physics-thu", 3, 570, 645, "PHYS 1200 — Mechanics and Motion", "work", "#0b8043");
      timed("work-thu", 3, 660, 840, "Work", "work", "#d81b60");
      for (const event of events) {
        event.detail.values.location = event.detail.eventId.endsWith("math")
          ? "Science Hall 204"
          : event.detail.eventId.endsWith("workshop")
            ? "Learning Center"
            : event.detail.eventId.endsWith("check-in")
              ? "Library"
              : "";
      }
    } else if (scenario !== "empty") {
      // Expanded instances, as returned by the real week endpoint. Deliberately
      // mix calendar fills with per-event overrides from the same calendar.
      timed(
        "lecture",
        0,
        540,
        590,
        "Differential equations — methods, examples, and discussion",
        "work",
        null,
        true,
      );
      timed(
        "seminar",
        0,
        560,
        635,
        "Seminar: a long title sharing a narrow column",
        "work",
        "#d50000",
      );
      timed("office", 0, 570, 610, "Office hours", "work", "#f6bf26");
      timed("evening-session", 1, 1110, 1230, "Evening information session", "personal");
      add("evening-study", "personal", "Library study", {
        kind: "timed",
        start: instant(1, 1170),
        end: instant(2, 30),
      });
      timed("adjacent-a", 1, 600, 615, "15 minute check-in", "personal", "#33b679");
      timed("adjacent-b", 1, 615, 630, "Next appointment", "personal", "#8e24aa");
      timed("short", 1, 660, 665, "Five minute reminder", "personal");
      timed("thirty", 2, 540, 570, "Thirty minute meeting", "personal", "#3f51b5");
      timed("hour", 2, 570, 630, "One hour reading group", "work", "#f4511e");
      timed(
        "long",
        3,
        540,
        660,
        "Two hours to work through a longer problem set",
        "work",
        "#039be5",
      );
      timed("readonly", 4, 600, 650, "Shared seminar (view only)", "shared");
      timed("untitled", 4, 660, 705, "", "uncolored");
      timed("weekend", 5, 600, 690, "Weekend walk", "personal", "#e67c73");
      timed("sunday", 6, 780, 840, "Plan the week", "personal");
      timed("early", 3, 450, 495, "Early appointment crossing 8 AM", "personal");
      timed("hidden", 0, 720, 780, "Only shown when the hidden calendar is enabled", "hidden");
      add("overnight", "personal", "Late travel across midnight", {
        kind: "timed",
        start: instant(4, 1410),
        end: instant(5, 540),
      });
      add(
        "all-day",
        "work",
        "Project week — multi-day event with a long title",
        { kind: "all_day", start: addSqlDateDays(sunday, 1), end: addSqlDateDays(sunday, 5) },
        "#b39ddb",
      );
      add("all-day-overlap", "shared", "Shared deadline", {
        kind: "all_day",
        start: addSqlDateDays(sunday, 2),
        end: addSqlDateDays(sunday, 4),
      });
      add(
        "week-boundary",
        "personal",
        "Trip continuing from Saturday",
        { kind: "all_day", start: addSqlDateDays(sunday, -1), end: addSqlDateDays(sunday, 1) },
        "#f6bf26",
      );
      if (scenario === "dense")
        for (let day = 0; day < 7; day++)
          for (let i = 0; i < 8; i++) {
            timed(
              `dense-${day}-${i}`,
              day,
              720 + i * 25,
              765 + i * 25,
              `Overlapping session ${i + 1}: review notes, examples, and next steps`,
              i % 2 ? "personal" : "work",
              i % 3 ? "#8e24aa" : "#f6bf26",
            );
          }
    }
    commit({
      ...state,
      events: [...state.events, ...events],
      seededWeeks: [...state.seededWeeks, sunday],
    });
  }
  return {
    async status(signal) {
      check(signal);
      return state.connected
        ? {
            id: "fixture-connection",
            googleAccountId: null,
            displayEmail: "alex@example.invalid",
            connectionState: "connected",
            grantedScopes: [],
            lastSuccessfulRefreshAt: now,
            createdAt: now,
            updatedAt: now,
          }
        : null;
    },
    async calendars(signal) {
      check(signal);
      return structuredClone(state.preferences);
    },
    async setVisibility(id, isVisible) {
      check();
      commit({
        ...state,
        preferences: state.preferences.map((p) => (p.id === id ? { ...p, isVisible } : p)),
      });
    },
    async disconnect() {
      check();
      commit({ ...state, connected: false });
    },
    async connect() {
      check();
      commit({ ...state, connected: true });
      return "/qa/workspace.html?route=/settings&scenario=" + encodeURIComponent(scenario);
    },
    async week(sunday, signal) {
      check(signal);
      seed(sunday);
      const visibleCalendars = state.preferences
        .filter((p) => p.isVisible)
        .map((p) => ({ ...p, isVisible: true as const }));
      const endDate = addSqlDateDays(sunday, 7);
      const start = Temporal.PlainDate.from(sunday).toZonedDateTime(timezone).toInstant();
      const end = Temporal.PlainDate.from(endDate).toZonedDateTime(timezone).toInstant();
      const events: CalendarEvent[] = [];
      for (const { detail, color } of state.events) {
        const calendar = visibleCalendars.find((p) => p.calendarId === detail.calendarId);
        if (!calendar) continue;
        const timing = detail.values.timing;
        // Reuse the production normalization boundary, including per-event color
        // overrides, untitled events, exclusive dates, and source timezones.
        const normalized = normalizeGoogleEvent(
          {
            id: detail.eventId,
            summary: detail.values.title,
            location: detail.values.location,
            htmlLink: `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(detail.eventId)}`,
            ...(color ? { resolvedEventColor: { background: color } } : {}),
            ...(detail.recurring ? { recurringEventId: "fixture-series" } : {}),
            start:
              timing.kind === "all_day"
                ? { date: timing.start }
                : { dateTime: timing.start, timeZone: detail.values.timeZone },
            end:
              timing.kind === "all_day"
                ? { date: timing.end }
                : { dateTime: timing.end, timeZone: detail.values.timeZone },
          },
          calendar,
        );
        if (normalized.status !== "event") throw new Error("Invalid QA event seed.");
        const event = normalized.event;
        if (
          event.kind === "all_day"
            ? event.startDate < endDate && event.endDateExclusive > sunday
            : Temporal.Instant.compare(event.startAt, end) < 0 &&
              Temporal.Instant.compare(event.endAt, start) > 0
        )
          events.push(event);
      }
      return {
        range: { sunday, saturday: addSqlDateDays(sunday, 6) },
        timezone,
        visibleCalendars,
        events,
        partialErrors: [],
      };
    },
    async eventDetail(calendarId, eventId, _scope, signal) {
      check(signal);
      const event = state.events.find(
        (e) => e.detail.eventId === eventId && e.detail.calendarId === calendarId,
      );
      if (!event) throw new CalendarServiceError("Event not found.", "event_not_found");
      return structuredClone(event.detail);
    },
    async mutateEvent(input) {
      check();
      const command = eventCommandSchema.parse(input);
      if (command.action === "detail") throw new Error("Use eventDetail.");
      requireEditable(command.calendarId);
      const current = state.events.find(
        (e) => e.detail.eventId === command.eventId && e.detail.calendarId === command.calendarId,
      );
      if (command.action !== "create" && (!current || current.detail.etag !== command.etag)) {
        throw new CalendarServiceError(
          "This event changed. Close and refresh before editing again.",
          "event_conflict",
        );
      }
      if (
        (command.action !== "create" && command.scope === "series") ||
        (command.action !== "delete" && command.values.recurrence?.length)
      ) {
        throw new CalendarServiceError(
          "Recurring-series writes require authenticated Google verification; the fixture only edits individual instances.",
          "fixture_unsupported",
        );
      }
      if (command.action === "create" && current)
        throw new CalendarServiceError(
          "This event already exists. Refresh before retrying.",
          "event_conflict",
        );
      const events = state.events.filter((e) => e !== current);
      if (command.action !== "delete") {
        const calendarId =
          command.action === "create" ? command.calendarId : command.destinationCalendarId;
        requireEditable(calendarId);
        events.push({
          color: current?.color ?? null,
          detail: {
            eventId: command.eventId,
            calendarId,
            etag: `"${crypto.randomUUID()}"`,
            recurring: current?.detail.recurring ?? false,
            canMove: current?.detail.canMove ?? true,
            values: {
              ...command.values,
              recurrence: command.values.recurrence ?? current?.detail.values.recurrence ?? [],
            },
          },
        });
      }
      commit({ ...state, events });
      return { saved: true };
    },
  };
}
