import type { CalendarEnvironment } from "../env/cloud.js";
import { createGoogleOAuthTransport as createTransport } from "../google/oauthTransport.js";
import { driveHttp } from "./driveHttp.js";
import { driveOAuthPolicy } from "./oauthPolicy.js";

export function createGoogleOAuthTransport(
  configuration: CalendarEnvironment,
  signal: AbortSignal,
  fetcher = fetch,
) {
  return createTransport(
    { http: driveHttp, policy: driveOAuthPolicy },
    configuration,
    signal,
    fetcher,
  );
}
