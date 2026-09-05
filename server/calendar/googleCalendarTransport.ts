import { Buffer } from "node:buffer";
import { Temporal } from "@js-temporal/polyfill";

import {
  CALENDAR_EVENT_FIELDS, CALENDAR_PAGE_SIZE, CalendarProviderError,
  type CalendarEventPageRequest, type CalendarSelection, type FetchCalendarEventPage,
} from "./loadCalendarWeek.js";

export const GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS = 8_000;
export const GOOGLE_CALENDAR_LIST_TIMEOUT_MS = 20_000;
export const GOOGLE_CALENDAR_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const GOOGLE_CALENDAR_MAX_HEADER_BYTES = 16 * 1024;
export const GOOGLE_CALENDAR_LIST_MAX_PAGES = 20;
export const GOOGLE_CALENDAR_MAX_PAGE_TOKEN_LENGTH = 2_048;
export const GOOGLE_CALENDAR_LIST_FIELDS =
  "nextPageToken,items(id,summary,summaryOverride,timeZone,backgroundColor,foregroundColor,accessRole)";

const API_ROOT = "https://www.googleapis.com/calendar/v3/";
const MAX_IDENTIFIER_LENGTH = 1_024;
const MAX_DISPLAY_NAME_LENGTH = 4_096;
const MAX_BODY_CHUNKS = 16_384;
const NAMED_ZONE = /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/;
const INSTANT = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface GoogleCalendarReadTransport {
  readonly fetchEventPage: FetchCalendarEventPage;
  /** Fresh Google metadata only. A later owner-scoped adapter merges saved visibility. */
  listCalendars(options: { readonly signal: AbortSignal }): Promise<readonly CalendarSelection[]>;
}

function unavailable(): CalendarProviderError {
  return new CalendarProviderError("calendar_unavailable");
}

function cancelled(): DOMException {
  // Do not copy signal.reason: it may contain request data or credentials.
  return new DOMException("Calendar request cancelled.", "AbortError");
}

function checkActive(signal: AbortSignal): void {
  if (signal.aborted) throw cancelled();
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH && !/[\s\u0000-\u001f\u007f]/u.test(value) &&
    value !== "." && value !== "..";
}

function pageToken(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= GOOGLE_CALENDAR_MAX_PAGE_TOKEN_LENGTH && !/[\u0000-\u001f\u007f]/u.test(value);
}

function namedZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 128 || !NAMED_ZONE.test(value)) return false;
  try { Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value); return true; }
  catch { return false; }
}

/** Observe late failures even when an injected fetch/reader ignores cancellation. */
function awaitActive<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(cancelled());
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) abort(); else resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) abort(); else reject(error);
    });
  });
}

async function withDeadline<T>(
  parent: AbortSignal, milliseconds: number, work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  checkActive(parent);
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, milliseconds);
  try {
    const result = await awaitActive(work(controller.signal), controller.signal);
    checkActive(parent);
    return result;
  } catch (error) {
    if (parent.aborted) throw cancelled();
    if (error instanceof CalendarProviderError) {
      throw new CalendarProviderError(error.code === "reconnect_required" ? "reconnect_required" : "calendar_unavailable");
    }
    throw unavailable();
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", abort);
    controller.abort();
  }
}

function discardBody(response: Response): void {
  // Never await cancellation: non-conforming transports may never settle it.
  try { void response.body?.cancel().catch(() => {}); } catch { /* no provider errors */ }
}

function validateHeaders(response: Response): void {
  // The platform owns wire-level header parsing; this caps accepted headers.
  let bytes = 0;
  for (const [name, value] of response.headers) {
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    if (bytes > GOOGLE_CALENDAR_MAX_HEADER_BYTES) throw unavailable();
  }
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > GOOGLE_CALENDAR_MAX_BODY_BYTES)) {
    throw unavailable();
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(response.headers.get("content-type") ?? "") ||
    response.body === null) throw unavailable();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let chunks = 0;
  let text = "";
  let finished = false;
  try {
    while (true) {
      checkActive(signal);
      const chunk = await awaitActive(reader.read(), signal);
      if (chunk.done) { finished = true; break; }
      // Even an immediately resolved stream of empty chunks is bounded; such
      // a stream must not starve the event loop and defeat the deadline.
      if (++chunks > MAX_BODY_CHUNKS) throw unavailable();
      bytes += chunk.value.byteLength;
      if (bytes > GOOGLE_CALENDAR_MAX_BODY_BYTES) throw unavailable();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    checkActive(signal);
    return JSON.parse(text) as unknown;
  } finally {
    if (!finished) {
      try { void reader.cancel().catch(() => {}); } catch { /* best-effort stop */ }
    }
    try { reader.releaseLock(); } catch { /* an ignoring reader may still be pending */ }
  }
}

function readPage(value: unknown): { items: readonly unknown[]; nextPageToken?: string } {
  if (!record(value) || value.error !== undefined ||
    (value.items !== undefined && !Array.isArray(value.items)) ||
    (value.nextPageToken !== undefined && !pageToken(value.nextPageToken))) throw unavailable();
  const items: readonly unknown[] = value.items ?? [];
  if (items.length > CALENDAR_PAGE_SIZE) throw unavailable();
  return { items, ...(value.nextPageToken === undefined ? {} : { nextPageToken: value.nextPageToken as string }) };
}

function stringFields(value: Record<string, unknown>, names: readonly string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const name of names) {
    if (value[name] !== undefined) output[name] = typeof value[name] === "string" ? value[name] : null;
  }
  return output;
}

/** Retain only normalization inputs, even if Google ignores the fields mask. */
function projectEvent(raw: unknown): unknown {
  if (!record(raw)) return null;
  const result = stringFields(raw, ["id", "status", "summary", "htmlLink", "recurringEventId"]);
  for (const boundary of ["start", "end"]) {
    if (raw[boundary] !== undefined) {
      result[boundary] = record(raw[boundary]) ? stringFields(raw[boundary], ["date", "dateTime", "timeZone"]) : null;
    }
  }
  // Only presence is needed to reject an unexpanded recurrence master.
  if (raw.recurrence !== undefined) result.recurrence = [];
  return result;
}

function projectCalendar(raw: unknown): CalendarSelection {
  if (!record(raw) || !identifier(raw.id)) throw unavailable();
  for (const name of ["summary", "summaryOverride"]) {
    if (raw[name] !== undefined && (typeof raw[name] !== "string" || raw[name].length > MAX_DISPLAY_NAME_LENGTH)) {
      throw unavailable();
    }
  }
  const color = (value: unknown): string | null => {
    if (value === undefined) return null;
    if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value)) throw unavailable();
    return value;
  };
  return {
    calendarId: raw.id,
    displayName: typeof raw.summaryOverride === "string" && raw.summaryOverride.trim() !== "" ?
      raw.summaryOverride : typeof raw.summary === "string" && raw.summary.trim() !== "" ?
        raw.summary : "(Untitled calendar)",
    color: { background: color(raw.backgroundColor), foreground: color(raw.foregroundColor) },
    // Never infer source timezone from the profile or events response. An empty
    // zone intentionally lets loadCalendarWeek fail only this calendar.
    timeZone: namedZone(raw.timeZone) ? raw.timeZone : "",
    // Google hidden/selected preferences are not orbitOS visibility settings.
    isVisible: true,
    canEdit: raw.accessRole === 'owner' || raw.accessRole === 'writer',
  };
}

function eventUrl(request: CalendarEventPageRequest): URL {
  if (!record(request) || !identifier(request.calendarId) ||
    !namedZone(request.timeZone) || typeof request.timeMin !== "string" ||
    typeof request.timeMax !== "string" || request.timeMin.length > 64 || request.timeMax.length > 64 ||
    !INSTANT.test(request.timeMin) || !INSTANT.test(request.timeMax) ||
    request.maxResults !== CALENDAR_PAGE_SIZE || request.singleEvents !== true ||
    request.showDeleted !== false || request.orderBy !== "startTime" || request.fields !== CALENDAR_EVENT_FIELDS ||
    (request.pageToken !== undefined && !pageToken(request.pageToken)) ||
    Temporal.Instant.compare(request.timeMin, request.timeMax) >= 0) throw unavailable();
  const url = new URL(`${API_ROOT}calendars/${encodeURIComponent(request.calendarId)}/events`);
  url.search = new URLSearchParams({
    timeMin: request.timeMin, timeMax: request.timeMax, timeZone: request.timeZone,
    maxResults: String(CALENDAR_PAGE_SIZE), singleEvents: "true", showDeleted: "false",
    orderBy: "startTime", fields: CALENDAR_EVENT_FIELDS,
    ...(request.pageToken === undefined ? {} : { pageToken: request.pageToken }),
  }).toString();
  return url;
}

/**
 * Server-only, request-local transport. The caller obtains the access token
 * from authenticated private storage; there is no browser credential argument,
 * ownership choice, OAuth exchange/refresh, retry, shared cache, or write API.
 * Never retain this factory result across users or return it from a route.
 *
 * Google contracts verified against the calendarList.list, events.list and
 * errors references at developers.google.com/workspace/calendar/api/.
 */
export function createGoogleCalendarReadTransport(options: {
  readonly accessToken: string;
  readonly fetch?: typeof globalThis.fetch;
}): GoogleCalendarReadTransport {
  const { accessToken } = options;
  if (typeof window !== "undefined" || typeof accessToken !== "string" || accessToken.length === 0 ||
    accessToken.length > 4_096 || !/^[A-Za-z0-9._~+\/-]+=*$/.test(accessToken)) {
    throw unavailable();
  }
  const fetch = options.fetch ?? globalThis.fetch;
  const get = (url: URL, parent: AbortSignal): Promise<unknown> => withDeadline(
    parent, GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS, async (signal) => {
      let response: Response | undefined;
      try {
        const received = await awaitActive<Response>(fetch(url, {
          method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
          redirect: "error", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal,
        }).then((value) => {
          if (signal.aborted) discardBody(value);
          return value;
        }), signal);
        response = received;
        validateHeaders(received);
        if (received.redirected || received.status !== 200) {
          // 401 may mean expired, not revoked. A future credential layer must
          // refresh before treating this provisional code as reconnection.
          throw new CalendarProviderError(received.status === 401 ? "reconnect_required" : "calendar_unavailable");
        }
        return await readJson(received, signal);
      } finally {
        if (response) discardBody(response);
      }
    },
  );
  return {
    fetchEventPage: async (request, { signal }) => {
      checkActive(signal);
      try {
        const page = readPage(await get(eventUrl(request), signal));
        return { ...page, items: page.items.map(projectEvent) };
      } catch (error) {
        if (signal.aborted) throw cancelled();
        if (error instanceof CalendarProviderError) {
          throw new CalendarProviderError(error.code === "reconnect_required" ? "reconnect_required" : "calendar_unavailable");
        }
        throw unavailable();
      }
    },
    listCalendars: ({ signal }) => withDeadline(signal, GOOGLE_CALENDAR_LIST_TIMEOUT_MS, async (listSignal) => {
      const calendars: CalendarSelection[] = [];
      const ids = new Set<string>();
      const tokens = new Set<string>();
      let token: string | undefined;
      for (let index = 0; index < GOOGLE_CALENDAR_LIST_MAX_PAGES; index += 1) {
        checkActive(listSignal);
        const url = new URL(`${API_ROOT}users/me/calendarList`);
        url.search = new URLSearchParams({
          maxResults: String(CALENDAR_PAGE_SIZE), showDeleted: "false", showHidden: "true",
          fields: GOOGLE_CALENDAR_LIST_FIELDS, ...(token === undefined ? {} : { pageToken: token }),
        }).toString();
        const page = readPage(await get(url, listSignal));
        for (const item of page.items) {
          const calendar = projectCalendar(item);
          if (ids.has(calendar.calendarId)) throw unavailable();
          ids.add(calendar.calendarId);
          calendars.push(calendar);
        }
        if (page.nextPageToken === undefined) return calendars;
        if (tokens.has(page.nextPageToken)) throw unavailable();
        tokens.add(page.nextPageToken);
        token = page.nextPageToken;
      }
      // Never report a limited prefix as the user's complete calendar list.
      throw unavailable();
    }),
  };
}
