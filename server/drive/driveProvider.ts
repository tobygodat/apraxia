import type { GoogleProviderDefinition } from "../google/provider.js";

export const DRIVE_PROVIDER: GoogleProviderDefinition = Object.freeze({
  key: "drive",
  noun: "Drive",
  label: "Google Drive",
  scopes: Object.freeze(["https://www.googleapis.com/auth/drive.readonly"]),
  callbackPath: "/api/drive/callback",
  browserCallbackPath: "/drive/callback",
  // A reconnect must return a fresh refresh token; never reuse another account's credential.
  reuseRefreshTokenOnReconnect: false,
  providerFailureMessage: "Google Drive could not load. Try again.",
});
