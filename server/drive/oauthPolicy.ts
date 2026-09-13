import { createHash, randomBytes } from "node:crypto";

import { normalizeSecureHttpOrigin } from "../../shared/supabaseEnvironment.js";
import type { VerifiedSession } from "../auth/verifySession.js";

export const DRIVE_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/drive.readonly",
] as const);
export const DRIVE_OAUTH_TTL_MS = 10 * 60 * 1000;
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const CALLBACK_PATH = "/api/drive/callback";
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export class DriveOAuthPolicyError extends Error {
  constructor() {
    super("Drive authorization could not be verified. Start the connection again.");
    this.name = "DriveOAuthPolicyError";
  }
}

function owner(session: VerifiedSession): string {
  if (!session || typeof session.userId !== "string" || !UUID.test(session.userId) ||
    session.userId === NIL_UUID) throw new DriveOAuthPolicyError();
  return session.userId.toLowerCase();
}

function origin(appUrl: unknown): string {
  const value = normalizeSecureHttpOrigin(appUrl);
  if (value === null) throw new DriveOAuthPolicyError();
  return value;
}

export function getDriveOAuthRedirectUri(appUrl: unknown): string {
  return `${origin(appUrl)}${CALLBACK_PATH}`;
}

/** Additional CSRF boundary for JSON POSTs; the route must still verify its JWT. */
export function assertDriveMutationRequest(request: Request, appUrl: unknown): void {
  try {
    const canonicalOrigin = origin(appUrl);
    const url = new URL(request.url);
    const fetchSite = request.headers.get("sec-fetch-site");
    const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (request.method !== "POST" || url.origin !== canonicalOrigin ||
      url.username !== "" || url.password !== "" || url.hash !== "" ||
      request.headers.get("origin") !== canonicalOrigin ||
      (fetchSite !== null && fetchSite !== "same-origin") || mediaType !== "application/json") {
      throw new DriveOAuthPolicyError();
    }
  } catch {
    throw new DriveOAuthPolicyError();
  }
}

function validState(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value;
}

function stateHash(state: unknown): string {
  if (!validState(state)) throw new DriveOAuthPolicyError();
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function graphic(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum &&
    /^[\x21-\x7e]+$/.test(value);
}

/** Private persistence receives only this projection, never the raw state. */
export interface PendingDriveOAuthTransaction {
  readonly userId: string;
  readonly stateHash: string;
  readonly redirectUri: string;
  readonly expiresAt: string;
}

export function createDriveOAuthAttempt(
  session: VerifiedSession,
  configuration: { readonly appUrl: string; readonly clientId: string },
  now: Date = new Date(),
): {
  readonly authorizationUrl: string;
  readonly transaction: PendingDriveOAuthTransaction;
} {
  try {
    const userId = owner(session);
    if (!graphic(configuration.clientId, 1024) || !(now instanceof Date) ||
      !Number.isFinite(now.getTime())) throw new DriveOAuthPolicyError();
    const expiresAt = new Date(now.getTime() + DRIVE_OAUTH_TTL_MS).toISOString();
    if (!/^(?!0000)\d{4}-/.test(now.toISOString()) || !/^(?!0000)\d{4}-/.test(expiresAt)) {
      throw new DriveOAuthPolicyError();
    }
    const redirectUri = getDriveOAuthRedirectUri(configuration.appUrl);
    const rawState = randomBytes(32).toString("base64url");
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: configuration.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: DRIVE_SCOPES.join(" "),
      state: rawState,
      access_type: "offline",
      prompt: "consent",
      // Drive authorization is separate. Do not merge broader grants from
      // another flow using the same Google client.
      include_granted_scopes: "false",
    }).toString();
    return {
      authorizationUrl: url.href,
      transaction: { userId, stateHash: stateHash(rawState), redirectUri, expiresAt },
    };
  } catch {
    throw new DriveOAuthPolicyError();
  }
}

export type DriveOAuthCallback =
  | { readonly status: "code"; readonly state: string; readonly code: string }
  | { readonly status: "denied"; readonly state: string };

/** Parsing is not authentication and does not consume the stored transaction. */
export function parseDriveOAuthCallback(callbackUrl: string, appUrl: string): DriveOAuthCallback {
  try {
    const redirectUri = getDriveOAuthRedirectUri(appUrl);
    if (typeof callbackUrl !== "string" || callbackUrl.length > 16_384 || callbackUrl.includes("#") ||
      /[\s\\\u0000-\u001f\u007f]/u.test(callbackUrl) ||
      callbackUrl.split("?")[0] !== redirectUri) throw new DriveOAuthPolicyError();
    const url = new URL(callbackUrl);
    if (url.hash !== "" || url.username !== "" || url.password !== "" ||
      url.origin + url.pathname !== redirectUri) throw new DriveOAuthPolicyError();
    const values = url.searchParams;
    if (values.getAll("state").length !== 1 || values.getAll("code").length > 1 ||
      values.getAll("error").length > 1 || values.has("code") === values.has("error")) {
      throw new DriveOAuthPolicyError();
    }
    const state = values.get("state");
    if (!validState(state)) throw new DriveOAuthPolicyError();
    if (values.has("error")) {
      if (!graphic(values.get("error"), 256)) throw new DriveOAuthPolicyError();
      return { status: "denied", state };
    }
    const code = values.get("code");
    if (!graphic(code, 4096)) throw new DriveOAuthPolicyError();
    // scope/authuser/prompt/error_description are intentionally not trusted or
    // projected. Only the token endpoint can establish the granted permissions.
    return { status: "code", state, code };
  } catch {
    throw new DriveOAuthPolicyError();
  }
}

/**
 * This command is only for a private, server-owned ATOMIC consume operation:
 * match all three fields, require consumed_at IS NULL and expires_at > DB now,
 * then mark consumed and return one result in the same transaction. A read then
 * write adapter is invalid. Browser callback/session handoff remains required.
 */
export function createDriveOAuthConsumeCommand(
  callback: DriveOAuthCallback,
  session: VerifiedSession,
  appUrl: string,
): { readonly stateHash: string; readonly userId: string; readonly redirectUri: string } {
  try {
    if (!callback || (callback.status !== "denied" && callback.status !== "code") ||
      (callback.status === "code" && !graphic(callback.code, 4096))) {
      throw new DriveOAuthPolicyError();
    }
    return {
      stateHash: stateHash(callback.state), userId: owner(session),
      redirectUri: getDriveOAuthRedirectUri(appUrl),
    };
  } catch {
    throw new DriveOAuthPolicyError();
  }
}

/** Reject excess grants as well as missing grants; retain only the requested Drive permissions. */
export function validateGrantedDriveScopes(value: unknown): readonly string[] {
  if (typeof value !== "string" || value.length > 1024 || value.trim() === "") {
    throw new DriveOAuthPolicyError();
  }
  const scopes = value.trim().split(/\s+/);
  if (scopes.length !== DRIVE_SCOPES.length || new Set(scopes).size !== scopes.length ||
    !DRIVE_SCOPES.every((scope) => scopes.includes(scope))) {
    throw new DriveOAuthPolicyError();
  }
  return [...DRIVE_SCOPES];
}
