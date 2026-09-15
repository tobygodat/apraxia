import type { CalendarWeekRange } from "../../frontend/src/types/domain.js";
import { requireTemporal } from "./temporal.js";

export interface CalendarWeekWindow {
  readonly range: CalendarWeekRange;
  readonly timezone: string;
  readonly timeMin: string;
  readonly timeMax: string;
  readonly endDateExclusive: string;
}

/** Never retain or echo date/timezone input or a parser's diagnostic message. */
export class CalendarWeekRequestError extends Error {
  constructor() {
    super("Choose a valid Sunday and named timezone.");
    this.name = "CalendarWeekRequestError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NAMED_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/;

function hasSupportedYear(year: number): boolean {
  return year >= 1 && year <= 9999;
}

/**
 * Civil-date check that needs no timezone database and no polyfill, so a
 * malformed request line is rejected before any Temporal load.
 */
export function assertCalendarWeekSunday(sunday: unknown): string {
  if (typeof sunday !== "string" || sunday.length !== 10 || !DATE_PATTERN.test(sunday)) {
    throw new CalendarWeekRequestError();
  }
  const year = Number(sunday.slice(0, 4));
  const month = Number(sunday.slice(5, 7));
  const day = Number(sunday.slice(8, 10));
  const civil = new Date(Date.UTC(2000, month - 1, day));
  civil.setUTCFullYear(year);
  if (
    !hasSupportedYear(year) ||
    civil.getUTCMonth() !== month - 1 ||
    civil.getUTCDate() !== day ||
    civil.getUTCDay() !== 0
  ) {
    throw new CalendarWeekRequestError();
  }
  return sunday;
}

/**
 * Derive an exclusive civil-week window, never a fixed 168-hour duration.
 * Requires `loadTemporal()` to have been awaited on this request path.
 */
export function buildCalendarWeekWindow(sunday: unknown, timezone: unknown): CalendarWeekWindow {
  try {
    if (
      typeof sunday !== "string" ||
      sunday.length !== 10 ||
      !DATE_PATTERN.test(sunday) ||
      typeof timezone !== "string" ||
      timezone.length > 255 ||
      timezone !== timezone.trim() ||
      !NAMED_ZONE_PATTERN.test(timezone)
    ) {
      throw new CalendarWeekRequestError();
    }

    const Temporal = requireTemporal();
    const firstDay = Temporal.PlainDate.from(sunday, { overflow: "reject" });
    if (!hasSupportedYear(firstDay.year) || firstDay.dayOfWeek !== 7) {
      throw new CalendarWeekRequestError();
    }
    const lastDay = firstDay.add({ days: 6 });
    const exclusiveEnd = firstDay.add({ days: 7 });
    if (!hasSupportedYear(lastDay.year) || !hasSupportedYear(exclusiveEnd.year)) {
      throw new CalendarWeekRequestError();
    }

    // Omitting plainTime selects the first valid local time, including a
    // midnight gap or overlap. Zone validity is checked by Temporal itself.
    const start = firstDay.toZonedDateTime({ timeZone: timezone }).toInstant();
    const end = exclusiveEnd.toZonedDateTime({ timeZone: timezone }).toInstant();
    if (
      !hasSupportedYear(start.toZonedDateTimeISO("UTC").year) ||
      !hasSupportedYear(end.toZonedDateTimeISO("UTC").year) ||
      Temporal.Instant.compare(start, end) >= 0
    ) {
      throw new CalendarWeekRequestError();
    }

    return {
      range: { sunday: firstDay.toString(), saturday: lastDay.toString() },
      timezone,
      timeMin: start.toString(),
      timeMax: end.toString(),
      endDateExclusive: exclusiveEnd.toString(),
    };
  } catch {
    throw new CalendarWeekRequestError();
  }
}
