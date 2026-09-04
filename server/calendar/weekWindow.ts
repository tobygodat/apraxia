import { Temporal } from "@js-temporal/polyfill";

import type { CalendarWeekRange } from "../../frontend/src/types/domain.js";

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
    super("Choose a valid Monday and named timezone.");
    this.name = "CalendarWeekRequestError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NAMED_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/;

function hasSupportedYear(year: number): boolean {
  return year >= 1 && year <= 9999;
}

/** Derive an exclusive civil-week window, never a fixed 168-hour duration. */
export function buildCalendarWeekWindow(monday: unknown, timezone: unknown): CalendarWeekWindow {
  try {
    if (
      typeof monday !== "string" || monday.length !== 10 || !DATE_PATTERN.test(monday) ||
      typeof timezone !== "string" || timezone.length > 255 ||
      timezone !== timezone.trim() || !NAMED_ZONE_PATTERN.test(timezone)
    ) {
      throw new CalendarWeekRequestError();
    }

    const firstDay = Temporal.PlainDate.from(monday, { overflow: "reject" });
    if (!hasSupportedYear(firstDay.year) || firstDay.dayOfWeek !== 1) {
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
      range: { monday: firstDay.toString(), sunday: lastDay.toString() },
      timezone,
      timeMin: start.toString(),
      timeMax: end.toString(),
      endDateExclusive: exclusiveEnd.toString(),
    };
  } catch {
    throw new CalendarWeekRequestError();
  }
}
