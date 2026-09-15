import { GoogleHttpError, createGoogleHttp, object } from "../google/http.js";
import { DRIVE_PROVIDER } from "./driveProvider.js";

/** Drive-labelled transport failure; see server/google/http.ts for the shared behaviour. */
export class DriveHttpError extends GoogleHttpError {
  constructor(code: string, status = 502) {
    super(DRIVE_PROVIDER, code, status);
    this.name = "DriveHttpError";
  }
}

export const driveHttp = createGoogleHttp(
  DRIVE_PROVIDER,
  (code, status) => new DriveHttpError(code, status),
);
export const { boundedFetchJson } = driveHttp;
export { object };
