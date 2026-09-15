import type { CalendarEnvironment } from "../env/cloud.js";
import { createGoogleOAuthTransport as createTransport } from "../google/oauthTransport.js";
import { calendarHttp } from "./calendarHttp.js";
import { calendarOAuthPolicy } from "./oauthPolicy.js";

export function createGoogleOAuthTransport(
  configuration: CalendarEnvironment,
  signal: AbortSignal,
  fetcher = fetch,
) {
  return createTransport(
    { http: calendarHttp, policy: calendarOAuthPolicy },
    configuration,
    signal,
    fetcher,
  );
}
