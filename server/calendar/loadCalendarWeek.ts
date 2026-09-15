import type {
  CalendarEvent,
  CalendarPartialError,
  CalendarPreference,
  VisibleCalendarMetadata,
  WeekViewModel,
} from "../../frontend/src/types/domain.js";
import type { normalizeGoogleEvent } from "./normalizeGoogleEvent.js";
import { loadTemporal } from "./temporal.js";
import {
  buildCalendarWeekWindow,
  CalendarWeekRequestError,
  type CalendarWeekWindow,
} from "./weekWindow.js";

export const CALENDAR_PAGE_SIZE = 250;
const CALENDAR_MAX_PAGES = 100;
const CALENDAR_CONCURRENCY = 3;
export const CALENDAR_LOAD_TIMEOUT_MS = 20_000;
/** Request only display data; descriptions and attendee data are not needed. */
export const CALENDAR_EVENT_FIELDS =
  "nextPageToken,items(id,status,summary,location,colorId,eventLabelId,htmlLink,start(date,dateTime,timeZone),end(date,dateTime,timeZone),recurrence,recurringEventId)";

/** Supplied by the lazily loaded Temporal polyfill and event normalizer. */
type InstantCompare = (left: string, right: string) => number;
type NormalizeEvent = typeof normalizeGoogleEvent;

export type CalendarSelection = Pick<
  CalendarPreference,
  "calendarId" | "displayName" | "color" | "isVisible"
> & {
  /** Fresh Google Calendar metadata, loaded server-side, not a browser choice. */
  readonly timeZone: string;
  readonly canEdit?: boolean;
};

export interface CalendarEventPageRequest {
  readonly calendarId: string;
  readonly timeMin: string;
  readonly timeMax: string;
  readonly timeZone: string;
  readonly maxResults: typeof CALENDAR_PAGE_SIZE;
  readonly singleEvents: true;
  readonly showDeleted: false;
  readonly orderBy: "startTime";
  readonly fields: typeof CALENDAR_EVENT_FIELDS;
  readonly pageToken?: string;
}

/** A server-owned read transport. Credentials stay inside its closure. */
export type FetchCalendarEventPage = (
  request: CalendarEventPageRequest,
  options: { readonly signal: AbortSignal },
) => Promise<unknown>;

export class CalendarProviderError extends Error {
  constructor(readonly code: "reconnect_required" | "calendar_unavailable") {
    super("Calendar could not be loaded.");
    this.name = "CalendarProviderError";
  }
}

class IncompleteCalendarError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abortError(): DOMException {
  return new DOMException("Calendar request cancelled.", "AbortError");
}

function checkActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** Observe late settlements as well as cancellation, even for an ignoring transport. */
function awaitActive<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(abortError());
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted) cancel();
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted) cancel();
        else reject(error);
      },
    );
  });
}

interface CalendarToLoad {
  readonly metadata: VisibleCalendarMetadata;
  readonly sourceWindow: CalendarWeekWindow | null;
}

function visibleSelections(
  values: readonly CalendarSelection[],
  sunday: unknown,
): CalendarToLoad[] {
  if (!Array.isArray(values)) throw new CalendarWeekRequestError();
  const ids = new Set<string>();
  const result: CalendarToLoad[] = [];
  const color = (value: unknown): value is string | null =>
    value === null || (typeof value === "string" && /^#[\da-f]{6}$/i.test(value));

  for (const value of values) {
    if (
      !record(value) ||
      typeof value.calendarId !== "string" ||
      value.calendarId.trim().length === 0 ||
      // eslint-disable-next-line no-control-regex -- deliberately rejects control characters in untrusted provider input.
      /[\u0000-\u001f\u007f]/.test(value.calendarId) ||
      typeof value.displayName !== "string" ||
      value.displayName.trim().length === 0 ||
      typeof value.isVisible !== "boolean" ||
      !record(value.color) ||
      !color(value.color.background) ||
      !color(value.color.foreground) ||
      ids.has(value.calendarId)
    ) {
      throw new CalendarWeekRequestError();
    }
    ids.add(value.calendarId);
    if (!value.isVisible) continue;
    let sourceWindow: CalendarWeekWindow | null = null;
    try {
      sourceWindow = buildCalendarWeekWindow(sunday, value.timeZone);
    } catch {
      /* Invalid upstream metadata fails this calendar, never its peers. */
    }
    result.push({
      metadata: {
        calendarId: value.calendarId,
        displayName: value.displayName,
        color: { background: value.color.background, foreground: value.color.foreground },
        isVisible: true,
      },
      sourceWindow,
    });
  }
  return result;
}

function readPage(value: unknown): { items: readonly unknown[]; nextPageToken?: string } {
  if (!record(value) || (value.items !== undefined && !Array.isArray(value.items))) {
    throw new IncompleteCalendarError();
  }
  const items: readonly unknown[] = value.items ?? [];
  if (
    items.length > CALENDAR_PAGE_SIZE ||
    (value.nextPageToken !== undefined &&
      (typeof value.nextPageToken !== "string" || value.nextPageToken.trim().length === 0))
  ) {
    throw new IncompleteCalendarError();
  }
  // Sparse arrays cannot come from JSON and should not become false empty rows.
  for (let index = 0; index < items.length; index += 1) {
    if (!(index in items)) throw new IncompleteCalendarError();
  }
  return { items, nextPageToken: value.nextPageToken as string | undefined };
}

function overlapsWeek(
  event: CalendarEvent,
  window: CalendarWeekWindow,
  compare: InstantCompare,
): boolean {
  if (event.kind === "all_day") {
    return (
      event.startDate < window.endDateExclusive && event.endDateExclusive > window.range.sunday
    );
  }
  return compare(event.startAt, window.timeMax) < 0 && compare(event.endAt, window.timeMin) > 0;
}

type FailureCode =
  | "calendar_unavailable"
  | "reconnect_required"
  | "calendar_incomplete"
  | "calendar_invalid_events"
  | "calendar_timeout";

function partialError(calendar: VisibleCalendarMetadata, code: FailureCode): CalendarPartialError {
  const messages: Record<FailureCode, string> = {
    calendar_unavailable: "This calendar could not be loaded. Try again.",
    reconnect_required: "Reconnect Google Calendar to load this calendar.",
    calendar_incomplete: "This calendar could not be fully loaded. Try again.",
    calendar_invalid_events: "Some events could not be displayed. Try loading this calendar again.",
    calendar_timeout: "This calendar took too long to load. Try again.",
  };
  return {
    calendarId: calendar.calendarId,
    calendarDisplayName: calendar.displayName,
    code,
    userMessage: messages[code],
    retryable: code !== "reconnect_required",
  };
}

interface CalendarResult {
  readonly events: readonly CalendarEvent[];
  readonly error?: CalendarPartialError;
}

async function collectCalendar(
  calendar: VisibleCalendarMetadata,
  window: CalendarWeekWindow,
  sourceWindow: CalendarWeekWindow,
  fetchPage: FetchCalendarEventPage,
  signal: AbortSignal,
  compare: InstantCompare,
  normalize: NormalizeEvent,
): Promise<CalendarResult> {
  const events: CalendarEvent[] = [];
  const eventIds = new Set<string>();
  const pageTokens = new Set<string>();
  let pageToken: string | undefined;
  let invalidEvents = false;
  // Google uses the source calendar's timezone to filter all-day dates. The
  // union prevents date-line calendars from losing a Sunday/Saturday record;
  // overlapsWeek still limits the returned model to the selected display week.
  const timeMin =
    compare(window.timeMin, sourceWindow.timeMin) < 0 ? window.timeMin : sourceWindow.timeMin;
  const timeMax =
    compare(window.timeMax, sourceWindow.timeMax) > 0 ? window.timeMax : sourceWindow.timeMax;

  for (let pageNumber = 0; pageNumber < CALENDAR_MAX_PAGES; pageNumber += 1) {
    checkActive(signal);
    const request: CalendarEventPageRequest = {
      calendarId: calendar.calendarId,
      timeMin,
      timeMax,
      timeZone: window.timezone,
      maxResults: CALENDAR_PAGE_SIZE,
      singleEvents: true,
      showDeleted: false,
      orderBy: "startTime",
      fields: CALENDAR_EVENT_FIELDS,
      ...(pageToken === undefined ? {} : { pageToken }),
    };
    const response = await awaitActive(fetchPage(request, { signal }), signal);
    checkActive(signal);
    const page = readPage(response);
    for (const raw of page.items) {
      const result = normalize(raw, calendar);
      if (result.status === "invalid") {
        invalidEvents = true;
        continue;
      }
      if (result.status === "cancelled") {
        // A cancellation arriving after the live instance is a changed page set,
        // not permission to show the stale earlier copy as a complete calendar.
        if (record(raw) && typeof raw.id === "string") {
          if (eventIds.has(raw.id)) throw new IncompleteCalendarError();
          eventIds.add(raw.id);
        }
        continue;
      }
      if (eventIds.has(result.event.eventId)) throw new IncompleteCalendarError();
      eventIds.add(result.event.eventId);
      if (overlapsWeek(result.event, window, compare)) events.push(result.event);
    }
    if (page.nextPageToken === undefined) {
      return {
        events,
        ...(invalidEvents ? { error: partialError(calendar, "calendar_invalid_events") } : {}),
      };
    }
    if (pageTokens.has(page.nextPageToken)) throw new IncompleteCalendarError();
    pageTokens.add(page.nextPageToken);
    pageToken = page.nextPageToken;
  }
  throw new IncompleteCalendarError();
}

/**
 * Build one read-only week from authenticated, server-loaded calendar choices.
 * There is no ownership input, storage, shared cache, or Google write operation.
 * This orchestration is transport-independent; authenticated HTTP wiring is a
 * separate integration gate, not replaced by its test transport.
 */
export async function loadCalendarWeek(
  input: {
    readonly sunday: unknown;
    readonly timezone: unknown;
    readonly calendars: readonly CalendarSelection[];
  },
  fetchPage: FetchCalendarEventPage,
  options: { readonly signal: AbortSignal },
): Promise<WeekViewModel> {
  checkActive(options.signal);
  // Both modules are loaded here, not at module scope, so connect, callback,
  // status, disconnect and event writes never pay for the Temporal polyfill.
  const [Temporal, { normalizeGoogleEvent: normalize }] = await Promise.all([
    loadTemporal(),
    import("./normalizeGoogleEvent.js"),
  ]);
  const window = buildCalendarWeekWindow(input.sunday, input.timezone);
  const selections = visibleSelections(input.calendars, input.sunday);
  const compare: InstantCompare = (left, right) => Temporal.Instant.compare(left, right);
  const scope = new AbortController();
  const cancel = () => scope.abort();
  options.signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, CALENDAR_LOAD_TIMEOUT_MS);
  const results: CalendarResult[] = new Array(selections.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < selections.length) {
      checkActive(options.signal);
      const index = nextIndex++;
      const { metadata: calendar, sourceWindow } = selections[index]!;
      if (sourceWindow === null) {
        results[index] = { events: [], error: partialError(calendar, "calendar_unavailable") };
        continue;
      }
      try {
        results[index] = await collectCalendar(
          calendar,
          window,
          sourceWindow,
          fetchPage,
          scope.signal,
          compare,
          normalize,
        );
      } catch (error) {
        checkActive(options.signal);
        const code = scope.signal.aborted
          ? "calendar_timeout"
          : error instanceof IncompleteCalendarError
            ? "calendar_incomplete"
            : error instanceof CalendarProviderError && error.code === "reconnect_required"
              ? "reconnect_required"
              : "calendar_unavailable";
        // Discard earlier pages from this calendar after an incomplete load.
        results[index] = { events: [], error: partialError(calendar, code) };
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(CALENDAR_CONCURRENCY, selections.length) }, worker),
    );
    checkActive(options.signal);
    return {
      range: window.range,
      timezone: window.timezone,
      visibleCalendars: selections.map((selection) => selection.metadata),
      events: results.flatMap((result) => result.events),
      partialErrors: results.flatMap((result) => (result.error ? [result.error] : [])),
    };
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", cancel);
  }
}
