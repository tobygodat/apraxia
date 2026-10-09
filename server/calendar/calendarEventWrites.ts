import type {
  EventCommand,
  EventDetail,
  EventMutationResult,
  EventValues,
} from "../../shared/calendarEventContract.js";
import type { CalendarSelection } from "./loadCalendarWeek.js";
import { CalendarHttpError, object, readBoundedJson } from "./calendarHttp.js";

const ROOT = "https://www.googleapis.com/calendar/v3/calendars/";
const FIELDS =
  "id,etag,status,summary,location,start,end,recurrence,recurringEventId,eventType,organizer(self)";

/** Request-local writer; credentials never leave the server. No mutation retries. */
export async function executeEventCommand(
  command: EventCommand,
  calendars: readonly CalendarSelection[],
  accessToken: string,
  parent: AbortSignal,
  fetcher: typeof fetch,
): Promise<EventDetail | EventMutationResult> {
  const calendar = calendars.find((item) => item.calendarId === command.calendarId);
  if (!calendar) throw new CalendarHttpError("event_not_found", 404);
  const writable = (id: string) => calendars.some((item) => item.calendarId === id && item.canEdit);
  if (command.action !== "detail" && !writable(command.calendarId))
    throw new CalendarHttpError("calendar_readonly", 403);
  const base = (id: string) => `${ROOT}${encodeURIComponent(id)}/events`;
  const path = (id: string) => `${base(command.calendarId)}/${encodeURIComponent(id)}`;
  async function call(
    url: string,
    method = "GET",
    body?: unknown,
    etag?: string,
  ): Promise<Record<string, unknown>> {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(10_000)]);
    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        signal,
        redirect: "manual",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(etag ? { "If-Match": etag } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new CalendarHttpError("mutation_uncertain", 502);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      const codes: Record<number, string> = {
        401: "reconnect_required",
        403: "calendar_readonly",
        404: "event_not_found",
        410: "event_not_found",
        409: "event_conflict",
        412: "event_conflict",
        400: "invalid_event",
      };
      throw new CalendarHttpError(
        codes[response.status] ?? "mutation_uncertain",
        response.status >= 500 ? 502 : response.status,
      );
    }
    if (response.status === 204) return {};
    const value = await readBoundedJson(response, 128 * 1024, signal);
    if (!object(value)) throw new CalendarHttpError("calendar_unavailable");
    return value;
  }
  const body = (values: EventValues) => ({
    summary: values.title,
    location: values.location,
    start:
      values.timing.kind === "all_day"
        ? { date: values.timing.start, dateTime: null, timeZone: null }
        : { date: null, dateTime: values.timing.start, timeZone: values.timeZone },
    end:
      values.timing.kind === "all_day"
        ? { date: values.timing.end, dateTime: null, timeZone: null }
        : { date: null, dateTime: values.timing.end, timeZone: values.timeZone },
    ...(values.recurrence === null ? {} : { recurrence: values.recurrence }),
  });
  if (command.action === "create") {
    await call(`${base(command.calendarId)}?sendUpdates=all&fields=id`, "POST", {
      id: command.eventId,
      ...body(command.values),
    });
    return { saved: true };
  }
  let current = await call(`${path(command.eventId)}?fields=${encodeURIComponent(FIELDS)}`);
  const recurring =
    typeof current.recurringEventId === "string" || Array.isArray(current.recurrence);
  if (command.scope === "series" && typeof current.recurringEventId === "string") {
    current = await call(`${path(current.recurringEventId)}?fields=${encodeURIComponent(FIELDS)}`);
  }
  if (
    current.status === "cancelled" ||
    typeof current.id !== "string" ||
    typeof current.etag !== "string"
  )
    throw new CalendarHttpError("event_not_found", 404);
  const canMove =
    (current.eventType === undefined || current.eventType === "default") &&
    object(current.organizer) &&
    current.organizer.self === true &&
    typeof current.recurringEventId !== "string";
  if (command.action === "detail") {
    if (!object(current.start) || !object(current.end))
      throw new CalendarHttpError("calendar_unavailable");
    const allDay = typeof current.start.date === "string";
    const start = allDay ? current.start.date : current.start.dateTime;
    const end = allDay ? current.end.date : current.end.dateTime;
    if (typeof start !== "string" || typeof end !== "string")
      throw new CalendarHttpError("calendar_unavailable");
    return {
      calendarId: command.calendarId,
      eventId: current.id,
      etag: current.etag,
      recurring,
      canMove,
      values: {
        title: typeof current.summary === "string" ? current.summary : "",
        location: typeof current.location === "string" ? current.location : "",
        timeZone:
          typeof current.start.timeZone === "string" ? current.start.timeZone : calendar.timeZone,
        timing: { kind: allDay ? "all_day" : "timed", start, end },
        recurrence: Array.isArray(current.recurrence)
          ? current.recurrence.filter((rule): rule is string => typeof rule === "string")
          : [],
      },
    };
  }
  if (current.etag !== command.etag) throw new CalendarHttpError("event_conflict", 409);
  if (command.action === "delete") {
    await call(`${path(current.id)}?sendUpdates=all`, "DELETE", undefined, command.etag);
    return { saved: true };
  }
  const moving = command.destinationCalendarId !== command.calendarId;
  if (moving && (!canMove || !writable(command.destinationCalendarId)))
    throw new CalendarHttpError("calendar_readonly", 403);
  if (typeof current.recurringEventId === "string" && command.values.recurrence !== null)
    throw new CalendarHttpError("invalid_event", 400);
  await call(
    `${path(current.id)}?sendUpdates=all&fields=id`,
    "PATCH",
    body(command.values),
    command.etag,
  );
  if (moving) {
    try {
      await call(
        `${path(current.id)}/move?destination=${encodeURIComponent(command.destinationCalendarId)}&sendUpdates=all&fields=id`,
        "POST",
      );
    } catch {
      return {
        saved: true,
        warning:
          "Event details were saved, but the calendar move could not be confirmed. Refresh before trying to move it again.",
      };
    }
  }
  return { saved: true };
}
