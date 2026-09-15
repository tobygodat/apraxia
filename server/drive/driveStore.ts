import type { ApplicationEnvironment } from "../env/cloud.js";
import { createGoogleStore } from "../google/store.js";
import { driveHttp } from "./driveHttp.js";

export function createDriveStore(
  environment: ApplicationEnvironment,
  signal: AbortSignal,
  fetcher = fetch,
) {
  return createGoogleStore(driveHttp, environment, signal, fetcher);
}
export type DriveStore = ReturnType<typeof createDriveStore>;
