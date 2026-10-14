import { GoogleOAuthPolicyError, createGoogleOAuthPolicy } from "../google/oauthPolicy.js";
import { CALENDAR_PROVIDER } from "./calendarProvider.js";

export const CALENDAR_SCOPES = CALENDAR_PROVIDER.scopes;

export class CalendarOAuthPolicyError extends GoogleOAuthPolicyError {
  constructor() {
    super(CALENDAR_PROVIDER);
  }
}

export const calendarOAuthPolicy = createGoogleOAuthPolicy(
  CALENDAR_PROVIDER,
  () => new CalendarOAuthPolicyError(),
);
