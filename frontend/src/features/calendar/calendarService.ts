import type { EventCommand, EventDetail, EventMutationResult } from "../../../../shared/calendarEventContract";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import type { CalendarPreference, GoogleCalendarConnectionStatus, WeekViewModel } from "../../types/domain";

export const CALENDAR_BROWSER_DEADLINE_MS = 30_000;
export const CALENDAR_WEEK_CACHE_TTL_MS = 60_000;
export const CALENDAR_WEEK_RETRY_DELAY_MS = 750;

export class CalendarServiceError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = "CalendarServiceError"; }
}

export interface CalendarService {
  eventDetail?(calendarId: string, eventId: string, scope: "instance" | "series", signal?: AbortSignal): Promise<EventDetail>;
  mutateEvent?(command: Exclude<EventCommand, { action: "detail" }>): Promise<EventMutationResult>;
  invalidate?(): void;
  status(signal?: AbortSignal): Promise<GoogleCalendarConnectionStatus | null>;
  calendars(signal?: AbortSignal): Promise<CalendarPreference[]>;
  week(monday: string, signal?: AbortSignal): Promise<WeekViewModel>;
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  setVisibility(id: string, visible: boolean): Promise<void>;
}

type WeekCacheEntry = { readonly week: WeekViewModel; readonly savedAt: number };

const messages: Record<string, string> = {
  calendar_readonly: "You do not have permission to make this change on that calendar.",
  event_not_found: "This event was deleted or is no longer available. Close and refresh the calendar.",
  event_conflict: "This event changed, or a previous save already completed. Close and refresh before editing again.",
  invalid_event: "Check the event dates, times, and repeat settings.",
  mutation_uncertain: "The result could not be confirmed. Close and refresh before trying again.",
  unauthenticated: "Sign in again to use Calendar.",
  reconnect_required: "Reconnect Google Calendar in Settings to allow event editing.",
  disconnected: "Connect Google Calendar in Settings to see your week.",
  not_configured: "Calendar is not configured yet.",
  invalid_request: "Calendar could not load this request. Try again.",
  calendar_timeout: "Calendar took too long to respond. Try again.",
};

function abortError(): DOMException { return new DOMException("Calendar request cancelled.", "AbortError"); }
function timeoutError(): CalendarServiceError { return new CalendarServiceError(messages.calendar_timeout, "calendar_timeout"); }

/** A race is required in addition to fetch cancellation: some transports ignore AbortSignal. */
function awaitWithSignal<T>(work: PromiseLike<T>, signal: AbortSignal, onAbort: () => Error = abortError): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); callback(); };
    const abort = () => finish(() => reject(onAbort()));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(work).then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

function deadlineSignal(parent?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const forward = () => controller.abort();
  parent?.addEventListener("abort", forward, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), CALENDAR_BROWSER_DEADLINE_MS);
  return { signal: controller.signal, dispose: () => { window.clearTimeout(timeout); parent?.removeEventListener("abort", forward); } };
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    const abort = () => { window.clearTimeout(timer); reject(abortError()); };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export function createCalendarService(client: SupabaseClient<Database>, accountKey = "current-account"): CalendarService {
  const weeks = new Map<string, WeekCacheEntry>();

  async function request<T>(path: string, method = "GET", parentSignal?: AbortSignal, body: unknown = {}): Promise<T> {
    const scope = deadlineSignal(parentSignal);
    let response: Response | undefined;
    try {
      // Keep session acquisition inside the same browser deadline as fetch and body parsing.
      const sessionResult = await awaitWithSignal(client.auth.getSession(), scope.signal, timeoutError);
      if (scope.signal.aborted) throw timeoutError();
      const session = sessionResult.data.session;
      if (sessionResult.error || !session) throw new CalendarServiceError(messages.unauthenticated, "unauthenticated");
      response = await awaitWithSignal(fetch(`/api/calendar/${path}`, {
        method, signal: scope.signal, cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}`, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      }), scope.signal, timeoutError);
      const parsed = await awaitWithSignal(response.json(), scope.signal, timeoutError);
      if (!response.ok) {
        const code = parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
          "error" in parsed && parsed.error && typeof parsed.error === "object" && !Array.isArray(parsed.error) &&
          "code" in parsed.error && typeof parsed.error.code === "string" ? parsed.error.code : "calendar_unavailable";
        throw new CalendarServiceError(messages[code] ?? "Calendar is unavailable. Try again.", code);
      }
      return parsed as T;
    } catch (error) {
      if (parentSignal?.aborted) throw abortError();
      if (error instanceof CalendarServiceError) throw error;
      if (scope.signal.aborted) throw timeoutError();
      throw new CalendarServiceError("Calendar did not respond. Try again.", "calendar_unavailable");
    } finally {
      // Do not clear the deadline until response.json() has settled.
      try { if (response?.body) void response.body.cancel().catch(() => undefined); } catch { /* best effort */ }
      scope.dispose();
    }
  }

  async function weekRequest(monday: string, signal?: AbortSignal): Promise<WeekViewModel> {
    try {
      return await request<WeekViewModel>(`events?monday=${encodeURIComponent(monday)}`, "GET", signal);
    } catch (error) {
      if (signal?.aborted || !(error instanceof CalendarServiceError) ||
        !["calendar_unavailable", "calendar_timeout"].includes(error.code)) throw error;
      await delay(CALENDAR_WEEK_RETRY_DELAY_MS, signal ?? new AbortController().signal);
      return request<WeekViewModel>(`events?monday=${encodeURIComponent(monday)}`, "GET", signal);
    }
  }

  async function retryPartial(first: WeekViewModel, monday: string, signal?: AbortSignal): Promise<WeekViewModel> {
    const retryable = new Set(first.partialErrors.filter(error => error.retryable).map(error => error.calendarId));
    if (!retryable.size) return first;
    await delay(CALENDAR_WEEK_RETRY_DELAY_MS, signal ?? new AbortController().signal);
    try {
      const second = await request<WeekViewModel>(`events?monday=${encodeURIComponent(monday)}`, "GET", signal);
      const secondErrors = new Map(second.partialErrors.map(error => [error.calendarId, error]));
      const retained = first.partialErrors.filter(error => !retryable.has(error.calendarId));
      const failedAgain = [...retryable].flatMap(calendarId => {
        const error = secondErrors.get(calendarId);
        if (!error) return [];
        return [{ ...error, code: "calendar_retained", userMessage: "This calendar could not be refreshed. Retained events from the last successful load where available.", retryable: true }];
      });
      const recoveredIds = new Set([...retryable].filter(id => !secondErrors.has(id)));
      return {
        ...first,
        events: [
          ...first.events.filter(event => !retryable.has(event.calendarId)),
          ...second.events.filter(event => recoveredIds.has(event.calendarId)),
        ],
        partialErrors: [...retained, ...failedAgain],
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ...first, partialErrors: first.partialErrors.map(item => retryable.has(item.calendarId)
        ? { ...item, code: "calendar_retained", userMessage: "This calendar could not be refreshed. Retained events from the last successful load where available.", retryable: true }
        : item) };
    }
  }

  async function week(monday: string, signal?: AbortSignal): Promise<WeekViewModel> {
    const key = `${accountKey}|${monday}`;
    const cached = weeks.get(key);
    if (cached && Date.now() - cached.savedAt <= CALENDAR_WEEK_CACHE_TTL_MS) return structuredClone(cached.week);
    const value = await retryPartial(await weekRequest(monday, signal), monday, signal);
    weeks.set(key, { week: value, savedAt: Date.now() });
    return structuredClone(value);
  }

  return {
    eventDetail: (calendarId, eventId, scope, signal) => request("events", "POST", signal, { action: "detail", calendarId, eventId, scope }),
    mutateEvent: (command) => request("events", "POST", undefined, command),
    invalidate: () => weeks.clear(),
    status: (signal) => request("status", "GET", signal),
    calendars: (signal) => request("calendars", "GET", signal),
    week,
    connect: async () => (await request<{ authorizationUrl: string }>("connect", "POST")).authorizationUrl,
    disconnect: async () => { await request("disconnect", "POST"); },
    setVisibility: async (id, visible) => {
      const { data, error } = await client.from("google_calendar_preferences").update({ is_visible: visible }).eq("id", id).select("id").single();
      if (error || !data) throw new Error("Calendar visibility was not saved. Try again.");
      weeks.clear();
    },
  } satisfies CalendarService;
}
