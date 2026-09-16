import { eventCommandSchema, type EventCommand } from "../../shared/calendarEventContract.js";
import {
  createGoogleConnectionHandler,
  type GoogleHandlerAdapter,
  type GoogleProviderRuntime,
} from "../google/handler.js";
import { executeEventCommand } from "./calendarEventWrites.js";
import { CALENDAR_PROVIDER } from "./calendarProvider.js";
import { CalendarHttpError, calendarHttp, readBoundedJson } from "./calendarHttp.js";
import { createCalendarStore, type CalendarStore } from "./calendarStore.js";
import { createGoogleCalendarReadTransport } from "./googleCalendarTransport.js";
import { loadCalendarWeek, CalendarProviderError } from "./loadCalendarWeek.js";
import { calendarOAuthPolicy } from "./oauthPolicy.js";
import { loadTemporal } from "./temporal.js";
import {
  assertCalendarWeekSunday,
  buildCalendarWeekWindow,
  CalendarWeekRequestError,
} from "./weekWindow.js";

export type CalendarAction =
  "connect" | "callback" | "complete" | "disconnect" | "status" | "calendars" | "events";

interface PreparedCalendarRequest {
  readonly sunday: string | null;
  readonly command: EventCommand | null;
}

const runtime: GoogleProviderRuntime = {
  definition: CALENDAR_PROVIDER,
  http: calendarHttp,
  policy: calendarOAuthPolicy,
};

/** Calendar-specific request validation and provider work; the shared pipeline owns sessions and tokens. */
const adapter: GoogleHandlerAdapter<CalendarAction, PreparedCalendarRequest, CalendarStore> = {
  runtime,
  expectedMethod: (action, request) =>
    ["connect", "complete", "disconnect"].includes(action) ||
    (action === "events" && request.method === "POST")
      ? "POST"
      : "GET",
  createStore: createCalendarStore,
  async prepare(action, request) {
    const parameters = new URL(request.url).searchParams;
    if (action === "events" && request.method === "GET") {
      if (
        parameters.getAll("sunday").length !== 1 ||
        [...parameters.keys()].some((key) => key !== "sunday")
      ) {
        throw new CalendarHttpError("invalid_request", 400);
      }
      // A civil-date check only: the polyfill stays unloaded for a bad request line.
      assertCalendarWeekSunday(parameters.get("sunday"));
    }
    const command =
      action === "events" && request.method === "POST"
        ? eventCommandSchema.safeParse(
            await readBoundedJson(new Response(request.body), 16 * 1024, request.signal),
          )
        : null;
    if (command && !command.success) throw new CalendarHttpError("invalid_event", 400);
    return { sunday: parameters.get("sunday"), command: command?.data ?? null };
  },
  isUpstreamUnauthorized: (error) =>
    error instanceof CalendarProviderError && error.code === "reconnect_required",
  mapError(error, json) {
    if (error instanceof CalendarWeekRequestError) {
      return json(
        {
          error: {
            code: "invalid_request",
            message: "Calendar request could not be verified. Try again.",
          },
        },
        400,
      );
    }
    if (error instanceof CalendarProviderError) {
      return json(
        {
          error: {
            code: error.code,
            message:
              error.code === "reconnect_required"
                ? "Reconnect Google Calendar to continue."
                : "Calendar is temporarily unavailable. Try again.",
          },
        },
        error.code === "reconnect_required" ? 409 : 502,
      );
    }
    return null;
  },
  async authorized({
    action,
    request,
    prepared,
    userId,
    fetcher,
    store,
    stored,
    accessToken,
    json,
    expireUsedGrant,
  }) {
    const transport = createGoogleCalendarReadTransport({ accessToken, fetch: fetcher });
    const discovered = await transport.listCalendars({ signal: request.signal });
    if (prepared.command)
      return json(
        await executeEventCommand(
          prepared.command,
          discovered,
          accessToken,
          request.signal,
          fetcher,
        ),
      );
    const preferences = await store.syncPreferences(userId, discovered);
    if (action === "calendars") {
      return json(
        preferences.map((item) => ({
          ...item,
          canEdit:
            discovered.find((source) => source.calendarId === item.calendarId)?.canEdit ?? false,
        })),
      );
    }
    // The credential read joins the profile timezone; no separate profile round trip.
    if (stored.timezone === null) throw new CalendarHttpError("calendar_unavailable");
    await loadTemporal();
    buildCalendarWeekWindow(prepared.sunday, stored.timezone);
    const byId = new Map(preferences.map((preference) => [preference.calendarId, preference]));
    const model = await loadCalendarWeek(
      {
        sunday: prepared.sunday,
        timezone: stored.timezone,
        calendars: discovered.map((item) => ({
          ...item,
          isVisible: byId.get(item.calendarId)?.isVisible ?? true,
        })),
      },
      transport.fetchEventPage,
      { signal: request.signal },
    );
    if (model.partialErrors.some((error) => error.code === "reconnect_required"))
      await expireUsedGrant();
    return json(model);
  },
};

/** Ownership comes from Auth verification or a trusted server-injected agent identity. */
export function createCalendarHandler(
  action: CalendarAction,
  dependencies: {
    environment?: Record<string, string | undefined>;
    fetch?: typeof fetch;
    /** Only trusted server code may supply an already authenticated agent identity. */
    verifiedSession?: { readonly userId: string };
  } = {},
) {
  return createGoogleConnectionHandler(adapter, action, dependencies);
}
