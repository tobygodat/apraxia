import { Temporal } from "@js-temporal/polyfill";

import type {
  CalendarEvent,
  VisibleCalendarMetadata,
} from "../../frontend/src/types/domain.js";

export type GoogleEventNormalizationResult =
  | { status: "event"; event: CalendarEvent }
  | { status: "cancelled" }
  | { status: "invalid"; code: "invalid_event" };

const LOCAL_DATE = /^(?!0000)\d{4}-\d{2}-\d{2}$/;
// Temporal also accepts ISO extensions that are not Google's RFC 3339 wire form.
// Exclude leap seconds rather than letting Temporal silently constrain them to 59.
const DATE_TIME =
  /^(?!0000)\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?(?:[Zz]|[+-]\d{2}:\d{2})?$/;
const OFFSET_SUFFIX = /(?:[Zz]|[+-]\d{2}:\d{2})$/;
const NAMED_TIME_ZONE = /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/;
const EVENT_QUERY_KEYS = new Set(["eid", "ctz", "authuser", "hl", "pli"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

function isNamedTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !NAMED_TIME_ZONE.test(value)) return false;
  // The grammar excludes numeric offsets, which Google does not accept as an
  // IANA timeZone. Temporal validates actual names and supported IANA aliases.
  Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value);
  return true;
}

function safeGoogleEventLink(value: unknown): value is string {
  if (typeof value !== "string" || /[\s\\\u0000-\u001f\u007f]/u.test(value)) {
    return false;
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["calendar.google.com", "www.google.com"].includes(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== ""
  ) {
    return false;
  }

  // Only event-detail routes are navigable. Generic Google routes, Calendar's
  // composer, and redirect parameters are deliberately outside this allowlist.
  const queryEvent = /^\/calendar\/(?:u\/\d+\/)?event$/.test(url.pathname);
  const pathEvent = /^\/calendar\/(?:u\/\d+\/)?r\/eventedit\/[A-Za-z0-9_-]+$/.test(
    url.pathname,
  );
  if (!queryEvent && !pathEvent) return false;
  if (queryEvent && !isIdentifier(url.searchParams.get("eid"))) return false;
  const seen = new Set<string>();
  for (const [key] of url.searchParams) {
    if (!EVENT_QUERY_KEYS.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

interface TimedBoundary {
  timestamp: string;
  timeZone: string | null;
  instant: Temporal.Instant;
}

function hasSupportedInstantYear(instant: Temporal.Instant): boolean {
  const year = instant.toZonedDateTimeISO("UTC").year;
  return year >= 1 && year <= 9999;
}

function timedBoundary(raw: Record<string, unknown>): TimedBoundary | null {
  if (
    raw.date !== undefined ||
    typeof raw.dateTime !== "string" ||
    !DATE_TIME.test(raw.dateTime)
  ) {
    return null;
  }
  let timeZone: string | null = null;
  if (raw.timeZone !== undefined) {
    if (!isNamedTimeZone(raw.timeZone)) return null;
    timeZone = raw.timeZone;
  }

  if (OFFSET_SUFFIX.test(raw.dateTime)) {
    // An explicit offset identifies the instant even if Google also supplies a
    // custom display timezone. Preserve both, without rounding or rewriting.
    const instant = Temporal.Instant.from(raw.dateTime);
    if (!hasSupportedInstantYear(instant)) return null;
    return {
      timestamp: raw.dateTime,
      timeZone,
      instant,
    };
  }
  if (timeZone === null) return null;
  const local = Temporal.PlainDateTime.from(raw.dateTime, { overflow: "reject" });
  const zoned = local.toZonedDateTime(timeZone, { disambiguation: "reject" });
  // Appending the resolved offset preserves even trailing fractional digits.
  // Historical sub-minute IANA offsets cannot be represented as RFC 3339.
  if (!/^[+-]\d{2}:\d{2}$/.test(zoned.offset)) return null;
  const instant = zoned.toInstant();
  if (!hasSupportedInstantYear(instant)) return null;
  return {
    timestamp: `${raw.dateTime}${zoned.offset}`,
    timeZone,
    instant,
  };
}

/**
 * Projects a Google event instance into the browser-safe Calendar contract.
 * No upstream bodies/errors escape this boundary, including thrown parsers.
 */
export function normalizeGoogleEvent(
  raw: unknown,
  calendar: VisibleCalendarMetadata,
): GoogleEventNormalizationResult {
  const invalid = { status: "invalid", code: "invalid_event" } as const;
  try {
    if (!isRecord(raw)) return invalid;
    // Deleted instances may have no title, dates, or link at all.
    if (raw.status === "cancelled") return { status: "cancelled" };
    if (
      (raw.status !== undefined &&
        raw.status !== "confirmed" &&
        raw.status !== "tentative") ||
      !isIdentifier(raw.id) ||
      (raw.summary !== undefined && typeof raw.summary !== "string") ||
      !safeGoogleEventLink(raw.htmlLink) ||
      !isRecord(raw.start) ||
      !isRecord(raw.end) ||
      raw.recurrence !== undefined ||
      (raw.recurringEventId !== undefined && !isIdentifier(raw.recurringEventId))
    ) {
      return invalid;
    }
    // The read transport resolves colorId through Google's event palette.
    const eventColor = isRecord(raw.resolvedEventColor) && typeof raw.resolvedEventColor.background === "string" &&
      /^#[\da-f]{6}$/i.test(raw.resolvedEventColor.background) ? raw.resolvedEventColor.background : null;
    const base = {
      eventId: raw.id,
      calendarId: calendar.calendarId,
      title:
        typeof raw.summary === "string" && raw.summary.trim() !== ""
          ? raw.summary
          : "(No title)",
      calendarColor: {
        background: eventColor ?? calendar.color.background,
        foreground: eventColor ? null : calendar.color.foreground,
      },
      googleEventUrl: raw.htmlLink,
    };

    if (raw.start.date !== undefined || raw.end.date !== undefined) {
      if (
        typeof raw.start.date !== "string" ||
        typeof raw.end.date !== "string" ||
        !LOCAL_DATE.test(raw.start.date) ||
        !LOCAL_DATE.test(raw.end.date) ||
        raw.start.dateTime !== undefined ||
        raw.end.dateTime !== undefined ||
        (raw.start.timeZone !== undefined && !isNamedTimeZone(raw.start.timeZone)) ||
        (raw.end.timeZone !== undefined && !isNamedTimeZone(raw.end.timeZone))
      ) {
        return invalid;
      }
      const start = Temporal.PlainDate.from(raw.start.date, { overflow: "reject" });
      const end = Temporal.PlainDate.from(raw.end.date, { overflow: "reject" });
      if (Temporal.PlainDate.compare(start, end) >= 0) return invalid;
      return {
        status: "event",
        event: {
          ...base,
          kind: "all_day",
          startDate: raw.start.date,
          endDateExclusive: raw.end.date,
        },
      };
    }

    const start = timedBoundary(raw.start);
    const end = timedBoundary(raw.end);
    if (
      start === null ||
      end === null ||
      Temporal.Instant.compare(start.instant, end.instant) >= 0
    ) {
      return invalid;
    }
    return {
      status: "event",
      event: {
        ...base,
        kind: "timed",
        startAt: start.timestamp,
        endAt: end.timestamp,
        startTimeZone: start.timeZone,
        endTimeZone: end.timeZone,
      },
    };
  } catch {
    return invalid;
  }
}
