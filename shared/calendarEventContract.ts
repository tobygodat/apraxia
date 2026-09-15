/**
 * Browser and server agree on these shapes. Validation is hand written so the
 * calendar editor chunk carries no schema library and no Temporal polyfill:
 * civil dates compare as strings and instants compare as epoch nanoseconds.
 */
export type EventParseResult<T> = { success: true; data: T } | { success: false };

type EventScope = "instance" | "series";

export interface EventValues {
  title: string;
  location: string;
  timeZone: string;
  timing:
    { kind: "all_day"; start: string; end: string } | { kind: "timed"; start: string; end: string };
  /** null preserves an existing rule, including unsupported Google recurrence rules. */
  recurrence: string[] | null;
}

export type EventCommand =
  | { action: "detail"; calendarId: string; eventId: string; scope: EventScope }
  | { action: "create"; calendarId: string; eventId: string; values: EventValues }
  | {
      action: "update";
      calendarId: string;
      eventId: string;
      scope: EventScope;
      etag: string;
      destinationCalendarId: string;
      values: EventValues;
    }
  | { action: "delete"; calendarId: string; eventId: string; scope: EventScope; etag: string };

export interface EventDetail {
  eventId: string;
  calendarId: string;
  etag: string;
  recurring: boolean;
  canMove: boolean;
  values: Omit<EventValues, "recurrence"> & { recurrence: string[] };
}
export interface EventMutationResult {
  saved: true;
  warning?: string;
}

const RRULE =
  /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;INTERVAL=([1-9]|[1-9]\d))?(;BYDAY=(MO,TU,WE,TH,FR))?(;(COUNT=[1-9]\d{0,3}|UNTIL=\d{8}(T\d{6}Z)?))?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;
// eslint-disable-next-line no-control-regex -- deliberately rejects control characters in untrusted provider input.
const UNSAFE = /[\s\u0000-\u001f\u007f]/u;
const failure = { success: false } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Rejects unknown keys the way the previous strict object schemas did. */
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function identifier(value: unknown): string | null {
  return typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 1024 &&
    !UNSAFE.test(value) &&
    value !== "." &&
    value !== ".."
    ? value
    : null;
}

function etagValue(value: unknown): string | null {
  return typeof value === "string" && value.length >= 1 && value.length <= 256 ? value : null;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
}

function daysInMonth(year: number, month: number): number {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function plainDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) ? value : null;
}

/** Epoch nanoseconds, so ordering never loses a fractional second to `Date`. */
function instantNanoseconds(value: unknown): bigint | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const parts = INSTANT.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, fraction, sign, offsetHour, offsetMinute] =
    parts;
  if (plainDate(`${year}-${month}-${day}`) === null) return null;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  let offsetMinutes = 0;
  if (sign !== undefined) {
    if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null;
    offsetMinutes = (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === "-" ? -1 : 1);
  }
  const epochMilliseconds = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (Number.isNaN(epochMilliseconds)) return null;
  return (
    (BigInt(epochMilliseconds) - BigInt(offsetMinutes) * 60_000n) * 1_000_000n +
    BigInt((fraction ?? "").padEnd(9, "0"))
  );
}

/** Numeric offsets are not IANA names and Google rejects them as a timeZone. */
function namedTimeZone(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    /^[+-]/.test(value)
  ) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    return null;
  }
  return value;
}

function parseTiming(value: unknown): EventValues["timing"] | null {
  if (!isRecord(value) || !onlyKeys(value, ["kind", "start", "end"])) return null;
  if (value.kind === "all_day") {
    const start = plainDate(value.start);
    const end = plainDate(value.end);
    return start !== null && end !== null && start < end ? { kind: "all_day", start, end } : null;
  }
  if (value.kind === "timed") {
    const start = instantNanoseconds(value.start);
    const end = instantNanoseconds(value.end);
    return start !== null && end !== null && start < end
      ? { kind: "timed", start: value.start as string, end: value.end as string }
      : null;
  }
  return null;
}

function parseRecurrence(value: unknown): { value: string[] | null } | null {
  if (value === null) return { value: null };
  if (!Array.isArray(value) || value.length > 1) return null;
  return value.every((rule) => typeof rule === "string" && RRULE.test(rule))
    ? { value: [...(value as string[])] }
    : null;
}

function parseEventValues(input: unknown): EventParseResult<EventValues> {
  if (
    !isRecord(input) ||
    !onlyKeys(input, ["title", "location", "timeZone", "timing", "recurrence"])
  ) {
    return failure;
  }
  const title = boundedText(input.title, 1024);
  const location = boundedText(input.location, 4096);
  const timeZone = namedTimeZone(input.timeZone);
  const timing = parseTiming(input.timing);
  const recurrence = parseRecurrence(input.recurrence);
  if (
    title === null ||
    location === null ||
    timeZone === null ||
    timing === null ||
    recurrence === null
  ) {
    return failure;
  }
  return {
    success: true,
    data: { title, location, timeZone, timing, recurrence: recurrence.value },
  };
}

function parseScope(value: unknown): EventScope | null {
  return value === "instance" || value === "series" ? value : null;
}

function parseEventCommand(input: unknown): EventParseResult<EventCommand> {
  if (!isRecord(input)) return failure;
  const calendarId = identifier(input.calendarId);
  if (calendarId === null) return failure;

  if (input.action === "detail") {
    if (!onlyKeys(input, ["action", "calendarId", "eventId", "scope"])) return failure;
    const eventId = identifier(input.eventId);
    const scope = parseScope(input.scope);
    return eventId !== null && scope !== null
      ? { success: true, data: { action: "detail", calendarId, eventId, scope } }
      : failure;
  }

  if (input.action === "create") {
    if (!onlyKeys(input, ["action", "calendarId", "eventId", "values"])) return failure;
    const values = parseEventValues(input.values);
    return typeof input.eventId === "string" &&
      /^[a-v0-9]{32}$/.test(input.eventId) &&
      values.success
      ? {
          success: true,
          data: { action: "create", calendarId, eventId: input.eventId, values: values.data },
        }
      : failure;
  }

  if (input.action === "update") {
    if (
      !onlyKeys(input, [
        "action",
        "calendarId",
        "eventId",
        "scope",
        "etag",
        "destinationCalendarId",
        "values",
      ])
    ) {
      return failure;
    }
    const eventId = identifier(input.eventId);
    const scope = parseScope(input.scope);
    const tag = etagValue(input.etag);
    const destinationCalendarId = identifier(input.destinationCalendarId);
    const values = parseEventValues(input.values);
    return eventId !== null &&
      scope !== null &&
      tag !== null &&
      destinationCalendarId !== null &&
      values.success
      ? {
          success: true,
          data: {
            action: "update",
            calendarId,
            eventId,
            scope,
            etag: tag,
            destinationCalendarId,
            values: values.data,
          },
        }
      : failure;
  }

  if (input.action === "delete") {
    if (!onlyKeys(input, ["action", "calendarId", "eventId", "scope", "etag"])) return failure;
    const eventId = identifier(input.eventId);
    const scope = parseScope(input.scope);
    const tag = etagValue(input.etag);
    return eventId !== null && scope !== null && tag !== null
      ? { success: true, data: { action: "delete", calendarId, eventId, scope, etag: tag } }
      : failure;
  }

  return failure;
}

/** Kept as schema-shaped objects so existing call sites read unchanged. */
export const eventValuesSchema = { safeParse: parseEventValues };
export const eventCommandSchema = {
  safeParse: parseEventCommand,
  parse(input: unknown): EventCommand {
    const result = parseEventCommand(input);
    if (!result.success) throw new Error("This calendar command is not valid.");
    return result.data;
  },
};
