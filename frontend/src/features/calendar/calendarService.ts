import type { EventCommand, EventDetail, EventMutationResult } from "../../../../shared/calendarEventContract";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import type { CalendarPreference, GoogleCalendarConnectionStatus, WeekViewModel } from "../../types/domain";

export class CalendarServiceError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
export interface CalendarService {
  eventDetail?(calendarId: string, eventId: string, scope: "instance" | "series", signal?: AbortSignal): Promise<EventDetail>;
  mutateEvent?(command: Exclude<EventCommand, { action: "detail" }>): Promise<EventMutationResult>;
  invalidate?(): void;
  status(signal?: AbortSignal): Promise<GoogleCalendarConnectionStatus | null>;
  calendars(signal?: AbortSignal): Promise<CalendarPreference[]>;
  week(sunday: string, signal?: AbortSignal): Promise<WeekViewModel>;
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  setVisibility(id: string, visible: boolean): Promise<void>;
}
export function createCalendarService(client: SupabaseClient<Database>): CalendarService {
  async function request<T>(path: string, method = "GET", signal?: AbortSignal, body: unknown = {}): Promise<T> {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw new CalendarServiceError("Sign in again to use Calendar.", "unauthenticated");
    const requestController = new AbortController();
    const abort = () => requestController.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = window.setTimeout(abort, 30_000);
    let response: Response;
    try {
      response = await fetch(`/api/calendar/${path}`, {
        method, signal: requestController.signal, cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}`, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      throw new CalendarServiceError("Calendar did not respond. Try again.", "calendar_unavailable");
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const code = body?.error?.code ?? "calendar_unavailable";
      const messages: Record<string, string> = {
        calendar_readonly: "You do not have permission to make this change on that calendar.",
        event_not_found: "This event was deleted or is no longer available. Close and refresh the calendar.",
        event_conflict: "This event changed, or a previous save already completed. Close and refresh before editing again.",
        invalid_event: "Check the event dates, times, and repeat settings.",
        mutation_uncertain: "The result could not be confirmed. Close and refresh before trying again.",
        unauthenticated: "Sign in again to use Calendar.", reconnect_required: "Reconnect Google Calendar in Settings to allow event editing.",
        not_configured: "Calendar is not configured yet.", invalid_request: "Calendar could not load this request. Try again.",
      };
      throw new CalendarServiceError(messages[code] ?? "Calendar is unavailable. Try again.", code);
    }
    return response.json() as Promise<T>;
  }
  return {
    eventDetail: (calendarId, eventId, scope, signal) => request("events", "POST", signal, { action: "detail", calendarId, eventId, scope }),
    mutateEvent: (command) => request("events", "POST", undefined, command),
    status: (signal) => request("status", "GET", signal),
    calendars: (signal) => request("calendars", "GET", signal),
    week: (sunday, signal) => request(`events?sunday=${encodeURIComponent(sunday)}`, "GET", signal),
    connect: async () => (await request<{ authorizationUrl: string }>("connect", "POST")).authorizationUrl,
    disconnect: async () => { await request("disconnect", "POST"); },
    setVisibility: async (id, visible) => {
      const { data, error } = await client.from("google_calendar_preferences").update({ is_visible: visible }).eq("id", id).select("id").single();
      if (error || !data) throw new Error("Calendar visibility was not saved. Try again.");
    },
  };
}
