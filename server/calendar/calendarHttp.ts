import { GoogleHttpError, createGoogleHttp, object } from "../google/http.js";
import { CALENDAR_PROVIDER } from "./calendarProvider.js";

/** Calendar-labelled transport failure; see server/google/http.ts for the shared behaviour. */
export class CalendarHttpError extends GoogleHttpError {
  constructor(code: string, status = 502) {
    super(CALENDAR_PROVIDER, code, status);
    this.name = "CalendarHttpError";
  }
}

export const calendarHttp = createGoogleHttp(
  CALENDAR_PROVIDER,
  (code, status) => new CalendarHttpError(code, status),
);
export const { readBoundedJson } = calendarHttp;
export { object };
