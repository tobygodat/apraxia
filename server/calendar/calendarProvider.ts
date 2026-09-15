import type { GoogleProviderDefinition } from "../google/provider.js";

export const CALENDAR_PROVIDER: GoogleProviderDefinition = Object.freeze({
  key: "calendar",
  noun: "Calendar",
  label: "Google Calendar",
  scopes: Object.freeze([
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendars.readonly",
  ]),
  callbackPath: "/api/calendar/callback",
  browserCallbackPath: "/calendar/callback",
  // A validated existing refresh token survives Google's omission of a replacement (docs/CALENDAR.md).
  reuseRefreshTokenOnReconnect: true,
  providerFailureMessage: "Calendar is temporarily unavailable. Try again.",
});
