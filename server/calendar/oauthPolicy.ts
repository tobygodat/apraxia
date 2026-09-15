import type { VerifiedSession } from "../auth/verifySession.js";
import {
  GOOGLE_OAUTH_TTL_MS,
  GoogleOAuthPolicyError,
  createGoogleOAuthPolicy,
  type GoogleOAuthCallback,
  type PendingGoogleOAuthTransaction,
} from "../google/oauthPolicy.js";
import { CALENDAR_PROVIDER } from "./calendarProvider.js";

export const CALENDAR_SCOPES = CALENDAR_PROVIDER.scopes;
export const CALENDAR_OAUTH_TTL_MS = GOOGLE_OAUTH_TTL_MS;

export class CalendarOAuthPolicyError extends GoogleOAuthPolicyError {
  constructor() {
    super(CALENDAR_PROVIDER);
  }
}

export const calendarOAuthPolicy = createGoogleOAuthPolicy(
  CALENDAR_PROVIDER,
  () => new CalendarOAuthPolicyError(),
);

export type CalendarOAuthCallback = GoogleOAuthCallback;
export type PendingCalendarOAuthTransaction = PendingGoogleOAuthTransaction;

export const getCalendarOAuthRedirectUri = (appUrl: unknown): string =>
  calendarOAuthPolicy.redirectUri(appUrl);
export const assertCalendarMutationRequest = (request: Request, appUrl: unknown): void =>
  calendarOAuthPolicy.assertMutationRequest(request, appUrl);
export const createCalendarOAuthAttempt = (
  session: VerifiedSession,
  configuration: { readonly appUrl: string; readonly clientId: string },
  now?: Date,
) => calendarOAuthPolicy.createAttempt(session, configuration, now);
export const parseCalendarOAuthCallback = (
  callbackUrl: string,
  appUrl: string,
): CalendarOAuthCallback => calendarOAuthPolicy.parseCallback(callbackUrl, appUrl);
export const createCalendarOAuthConsumeCommand = (
  callback: CalendarOAuthCallback,
  session: VerifiedSession,
  appUrl: string,
) => calendarOAuthPolicy.createConsumeCommand(callback, session, appUrl);
export const validateGrantedCalendarScopes = (value: unknown): readonly string[] =>
  calendarOAuthPolicy.validateGrantedScopes(value);
