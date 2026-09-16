import {
  createGoogleConnectionHandler,
  type GoogleHandlerAdapter,
  type GoogleProviderRuntime,
} from "../google/handler.js";
import { serveDriveFiles } from "./driveFiles.js";
import { driveHttp } from "./driveHttp.js";
import { DRIVE_PROVIDER } from "./driveProvider.js";
import { createDriveStore, type DriveStore } from "./driveStore.js";
import { driveOAuthPolicy } from "./oauthPolicy.js";

export type DriveAction =
  "connect" | "callback" | "complete" | "disconnect" | "status" | "files" | "pdf" | "picker";

const runtime: GoogleProviderRuntime = {
  definition: DRIVE_PROVIDER,
  http: driveHttp,
  policy: driveOAuthPolicy,
};

/** Ownership comes from Auth verification or a trusted server-injected agent identity. */
export function createDriveHandler(
  action: DriveAction,
  dependencies: {
    environment?: Record<string, string | undefined>;
    fetch?: typeof fetch;
    /** Only trusted server code may supply an already authenticated agent identity. */
    verifiedSession?: { readonly userId: string };
  } = {},
) {
  const adapter: GoogleHandlerAdapter<DriveAction, undefined, DriveStore> = {
    runtime,
    expectedMethod: (action) =>
      ["connect", "complete", "disconnect", "picker"].includes(action) ? "POST" : "GET",
    createStore: createDriveStore,
    async authorized({ action, request, accessToken, fetcher, headers, json }) {
      if (action === "picker") {
        const config = dependencies.environment ?? process.env;
        const developerKey = config.GOOGLE_PICKER_API_KEY?.trim();
        const appId = config.GOOGLE_PICKER_APP_ID?.trim();
        if (!developerKey || !appId || !/^\d+$/.test(appId)) {
          return json(
            {
              error: {
                code: "not_configured",
                message: "Google Picker setup is not finished yet.",
              },
            },
            503,
          );
        }
        // Explicit Google Picker handoff: temporary access only, never the refresh
        // token, encryption key, or client secret. No browser persistence.
        return json({ accessToken, developerKey, appId });
      }
      return serveDriveFiles(action, request, accessToken, fetcher, headers);
    },
  };
  return createGoogleConnectionHandler(adapter, action, dependencies);
}
