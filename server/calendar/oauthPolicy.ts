import { createHash, randomBytes } from "node:crypto";

import { normalizeSecureHttpOrigin } from "../../shared/supabaseEnvironment.js";
import type { VerifiedSession } from "../auth/verifySession.js";

export const CALENDAR_READ_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const);
export const CALENDAR_OAUTH_TTL_MS = 10 * 60 * 1000;
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CALLBACK_PATH = "/api/calendar/callback";
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export class CalendarOAuthPolicyError extends Error {
  constructor() {
    super("Calendar authorization could not be verified. Start the connection again.");
    this.name = "CalendarOAuthPolicyError";
  }
}

function owner(session: VerifiedSession): string {
  if (!session || typeof session.userId !== "string" || !UUID.test(session.userId) ||
    session.userId === NIL_UUID) throw new CalendarOAuthPolicyError();
  return session.userId.toLowerCase();
}

function origin(appUrl: unknown): string {
  const value = normalizeSecureHttpOrigin(appUrl);
  if (value === null) throw new CalendarOAuthPolicyError();
  return value;
}

export function getCalendarOAuthRedirectUri(appUrl: unknown): string {
  return `${origin(appUrl)}${CALLBACK_PATH}`;
}

/** Additional CSRF boundary for JSON POSTs; the route must still verify its JWT. */
export function assertCalendarMutationRequest(request: Request, appUrl: unknown): void {
  try {
    const canonicalOrigin = origin(appUrl);
    const url = new URL(request.url);
    const fetchSite = request.headers.get("sec-fetch-site");
    const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (request.method !== "POST" || url.origin !== canonicalOrigin ||
      url.username !== "" || url.password !== "" || url.hash !== "" ||
      request.headers.get("origin") !== canonicalOrigin ||
      (fetchSite !== null && fetchSite !== "same-origin") || mediaType !== "application/json") {
      throw new CalendarOAuthPolicyError();
    }
  } catch {
    throw new CalendarOAuthPolicyError();
  }
}

function validState(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value;
}

function stateHash(state: unknown): string {
  if (!validState(state)) throw new CalendarOAuthPolicyError();
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function graphic(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum &&
    /^[\x21-\x7e]+$/.test(value);
}

/** Private persistence receives only this projection, never the raw state. */
export interface PendingCalendarOAuthTransaction {
  readonly userId: string;
  readonly stateHash: string;
  readonly redirectUri: string;
  readonly expiresAt: string;
}

export function createCalendarOAuthAttempt(
  session: VerifiedSession,
  configuration: { readonly appUrl: string; readonly clientId: string },
  now: Date = new Date(),
): {
  readonly authorizationUrl: string;
  readonly transaction: PendingCalendarOAuthTransaction;
} {
  try {
    const userId = owner(session);
    if (!graphic(configuration.clientId, 1024) || !(now instanceof Date) ||
      !Number.isFinite(now.getTime())) throw new CalendarOAuthPolicyError();
    const expiresAt = new Date(now.getTime() + CALENDAR_OAUTH_TTL_MS).toISOString();
    if (!/^(?!0000)\d{4}-/.test(now.toISOString()) || !/^(?!0000)\d{4}-/.test(expiresAt)) {
      throw new CalendarOAuthPolicyError();
    }
    const redirectUri = getCalendarOAuthRedirectUri(configuration.appUrl);
    const rawState = randomBytes(32).toString("base64url");
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: configuration.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: CALENDAR_READ_SCOPES.join(" "),
      state: rawState,
      access_type: "offline",
      prompt: "consent",
      // Calendar authorization is separate. Do not merge broader grants from
      // another flow using the same Google client.
      include_granted_scopes: "false",
    }).toString();
    return {
      authorizationUrl: url.href,
      transaction: { userId, stateHash: stateHash(rawState), redirectUri, expiresAt },
    };
  } catch {
    throw new CalendarOAuthPolicyError();
  }
}

export type CalendarOAuthCallback =
  | { readonly status: "code"; readonly state: string; readonly code: string }
  | { readonly status: "denied"; readonly state: string };

/** Parsing is not authentication and does not consume the stored transaction. */
export function parseCalendarOAuthCallback(callbackUrl: string, appUrl: string): CalendarOAuthCallback {
  try {
    const redirectUri = getCalendarOAuthRedirectUri(appUrl);
    if (typeof callbackUrl !== "string" || callbackUrl.length > 16_384 || callbackUrl.includes("#") ||
      /[\s\\\u0000-\u001f\u007f]/u.test(callbackUrl) ||
      callbackUrl.split("?")[0] !== redirectUri) throw new CalendarOAuthPolicyError();
    const url = new URL(callbackUrl);
    if (url.hash !== "" || url.username !== "" || url.password !== "" ||
      url.origin + url.pathname !== redirectUri) throw new CalendarOAuthPolicyError();
    const values = url.searchParams;
    if (values.getAll("state").length !== 1 || values.getAll("code").length > 1 ||
      values.getAll("error").length > 1 || values.has("code") === values.has("error")) {
      throw new CalendarOAuthPolicyError();
    }
    const state = values.get("state");
    if (!validState(state)) throw new CalendarOAuthPolicyError();
    if (values.has("error")) {
      if (!graphic(values.get("error"), 256)) throw new CalendarOAuthPolicyError();
      return { status: "denied", state };
    }
    const code = values.get("code");
    if (!graphic(code, 4096)) throw new CalendarOAuthPolicyError();
    // scope/authuser/prompt/error_description are intentionally not trusted or
    // projected. Only the token endpoint can establish the granted permissions.
    return { status: "code", state, code };
  } catch {
    throw new CalendarOAuthPolicyError();
  }
}

/**
 * This command is only for a private, server-owned ATOMIC consume operation:
 * match all three fields, require consumed_at IS NULL and expires_at > DB now,
 * then mark consumed and return one result in the same transaction. A read then
 * write adapter is invalid. Browser callback/session handoff remains required.
 */
export function createCalendarOAuthConsumeCommand(
  callback: CalendarOAuthCallback,
  session: VerifiedSession,
  appUrl: string,
): { readonly stateHash: string; readonly userId: string; readonly redirectUri: string } {
  try {
    if (!callback || (callback.status !== "denied" && callback.status !== "code") ||
      (callback.status === "code" && !graphic(callback.code, 4096))) {
      throw new CalendarOAuthPolicyError();
    }
    return {
      stateHash: stateHash(callback.state), userId: owner(session),
      redirectUri: getCalendarOAuthRedirectUri(appUrl),
    };
  } catch {
    throw new CalendarOAuthPolicyError();
  }
}

/** Reject excess grants as well as missing grants; never retain a write-capable token. */
export function validateGrantedCalendarScopes(value: unknown): readonly string[] {
  if (typeof value !== "string" || value.length > 1024 || value.trim() === "") {
    throw new CalendarOAuthPolicyError();
  }
  const scopes = value.trim().split(/\s+/);
  if (scopes.length !== CALENDAR_READ_SCOPES.length || new Set(scopes).size !== scopes.length ||
    !CALENDAR_READ_SCOPES.every((scope) => scopes.includes(scope))) {
    throw new CalendarOAuthPolicyError();
  }
  return [...CALENDAR_READ_SCOPES];
}
