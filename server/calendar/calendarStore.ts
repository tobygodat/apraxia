import type { ApplicationEnvironment } from "../env/cloud.js";
import type { CalendarPreference } from "../../frontend/src/types/domain.js";
import { createGoogleStore } from "../google/store.js";
import type { CalendarSelection } from "./loadCalendarWeek.js";
import { CalendarHttpError, calendarHttp, object } from "./calendarHttp.js";

/** The shared credential store plus Calendar's owner-scoped visibility preferences. */
export function createCalendarStore(
  environment: ApplicationEnvironment,
  signal: AbortSignal,
  fetcher = fetch,
) {
  const store = createGoogleStore(calendarHttp, environment, signal, fetcher);
  return {
    ...store,
    async syncPreferences(
      userId: string,
      calendars: readonly CalendarSelection[],
    ): Promise<CalendarPreference[]> {
      const values = await store.rpc("sync_calendar_preferences", {
        p_verified_user_id: userId,
        p_calendars: calendars.map(({ calendarId, displayName, color }) => ({
          calendarId,
          displayName,
          color,
        })),
      });
      if (!Array.isArray(values)) throw new CalendarHttpError("calendar_unavailable");
      return values.map((value: unknown) => {
        if (
          !object(value) ||
          typeof value.id !== "string" ||
          typeof value.calendar_id !== "string" ||
          typeof value.display_name !== "string" ||
          typeof value.is_visible !== "boolean" ||
          typeof value.last_seen_at !== "string" ||
          typeof value.created_at !== "string" ||
          typeof value.updated_at !== "string"
        ) {
          throw new CalendarHttpError("calendar_unavailable");
        }
        return {
          id: value.id,
          calendarId: value.calendar_id,
          displayName: value.display_name,
          isVisible: value.is_visible,
          color: {
            background: typeof value.background_color === "string" ? value.background_color : null,
            foreground: typeof value.foreground_color === "string" ? value.foreground_color : null,
          },
          lastSeenAt: value.last_seen_at,
          createdAt: value.created_at,
          updatedAt: value.updated_at,
        };
      });
    },
  };
}
export type CalendarStore = ReturnType<typeof createCalendarStore>;
