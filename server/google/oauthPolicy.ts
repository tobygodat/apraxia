import { createHash, randomBytes } from "node:crypto";

import { normalizeSecureHttpOrigin } from "../../shared/supabaseEnvironment.js";
import type { VerifiedSession } from "../auth/verifySession.js";
import type { GoogleProviderDefinition } from "./provider.js";

export const GOOGLE_OAUTH_TTL_MS = 10 * 60 * 1000;
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Never carries request input; adapters subclass it so `instanceof` stays provider-specific. */
export class GoogleOAuthPolicyError extends Error {
  constructor(readonly provider: GoogleProviderDefinition) {
    super(`${provider.noun} authorization could not be verified. Start the connection again.`);
    this.name = `${provider.noun}OAuthPolicyError`;
  }
}

export type GoogleOAuthCallback =
  | { readonly status: "code"; readonly state: string; readonly code: string }
  | { readonly status: "denied"; readonly state: string };

/** Private persistence receives only this projection, never the raw state. */
export interface PendingGoogleOAuthTransaction {
  readonly userId: string;
  readonly stateHash: string;
  readonly redirectUri: string;
  readonly expiresAt: string;
}

export interface GoogleOAuthPolicy {
  readonly definition: GoogleProviderDefinition;
  readonly ttlMs: number;
  redirectUri(appUrl: unknown): string;
  /** Additional CSRF boundary for JSON POSTs; the route must still verify its JWT. */
  assertMutationRequest(request: Request, appUrl: unknown): void;
  createAttempt(
    session: VerifiedSession,
    configuration: { readonly appUrl: string; readonly clientId: string },
    now?: Date,
  ): {
    readonly authorizationUrl: string;
    readonly transaction: PendingGoogleOAuthTransaction;
  };
  /** Parsing is not authentication and does not consume the stored transaction. */
  parseCallback(callbackUrl: string, appUrl: string): GoogleOAuthCallback;
  /**
   * Only for a private, server-owned ATOMIC consume operation: match all three
   * fields, require consumed_at IS NULL and expires_at > DB now, then mark consumed
   * in the same transaction. A read-then-write adapter is invalid.
   */
  createConsumeCommand(
    callback: GoogleOAuthCallback,
    session: VerifiedSession,
    appUrl: string,
  ): {
    readonly stateHash: string;
    readonly userId: string;
    readonly redirectUri: string;
  };
  /** Reject excess grants as well as missing grants; retain only the requested permissions. */
  validateGrantedScopes(value: unknown): readonly string[];
}

export function createGoogleOAuthPolicy(
  definition: GoogleProviderDefinition,
  fail: () => GoogleOAuthPolicyError,
): GoogleOAuthPolicy {
  const scopes = definition.scopes;

  function owner(session: VerifiedSession): string {
    if (
      !session ||
      typeof session.userId !== "string" ||
      !UUID.test(session.userId) ||
      session.userId === NIL_UUID
    )
      throw fail();
    return session.userId.toLowerCase();
  }

  function origin(appUrl: unknown): string {
    const value = normalizeSecureHttpOrigin(appUrl);
    if (value === null) throw fail();
    return value;
  }

  function redirectUri(appUrl: unknown): string {
    return `${origin(appUrl)}${definition.callbackPath}`;
  }

  function validState(value: unknown): value is string {
    return (
      typeof value === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(value) &&
      Buffer.from(value, "base64url").toString("base64url") === value
    );
  }

  function stateHash(state: unknown): string {
    if (!validState(state)) throw fail();
    return createHash("sha256").update(state, "utf8").digest("hex");
  }

  function graphic(value: unknown, maximum: number): value is string {
    return (
      typeof value === "string" &&
      value.length >= 1 &&
      value.length <= maximum &&
      /^[\x21-\x7e]+$/.test(value)
    );
  }

  return {
    definition,
    ttlMs: GOOGLE_OAUTH_TTL_MS,
    redirectUri,
    assertMutationRequest(request, appUrl) {
      try {
        const canonicalOrigin = origin(appUrl);
        const url = new URL(request.url);
        const fetchSite = request.headers.get("sec-fetch-site");
        const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        if (
          request.method !== "POST" ||
          url.origin !== canonicalOrigin ||
          url.username !== "" ||
          url.password !== "" ||
          url.hash !== "" ||
          request.headers.get("origin") !== canonicalOrigin ||
          (fetchSite !== null && fetchSite !== "same-origin") ||
          mediaType !== "application/json"
        ) {
          throw fail();
        }
      } catch {
        throw fail();
      }
    },
    createAttempt(session, configuration, now = new Date()) {
      try {
        const userId = owner(session);
        if (
          !graphic(configuration.clientId, 1024) ||
          !(now instanceof Date) ||
          !Number.isFinite(now.getTime())
        )
          throw fail();
        const expiresAt = new Date(now.getTime() + GOOGLE_OAUTH_TTL_MS).toISOString();
        if (!/^(?!0000)\d{4}-/.test(now.toISOString()) || !/^(?!0000)\d{4}-/.test(expiresAt))
          throw fail();
        const redirect = redirectUri(configuration.appUrl);
        const rawState = randomBytes(32).toString("base64url");
        const url = new URL(AUTHORIZE_URL);
        url.search = new URLSearchParams({
          client_id: configuration.clientId,
          redirect_uri: redirect,
          response_type: "code",
          scope: scopes.join(" "),
          state: rawState,
          access_type: "offline",
          prompt: "consent",
          // Each authorization is separate. Do not merge broader grants from
          // another flow using the same Google client.
          include_granted_scopes: "false",
        }).toString();
        return {
          authorizationUrl: url.href,
          transaction: { userId, stateHash: stateHash(rawState), redirectUri: redirect, expiresAt },
        };
      } catch {
        throw fail();
      }
    },
    parseCallback(callbackUrl, appUrl) {
      try {
        const redirect = redirectUri(appUrl);
        if (
          typeof callbackUrl !== "string" ||
          callbackUrl.length > 16_384 ||
          callbackUrl.includes("#") ||
          // eslint-disable-next-line no-control-regex -- deliberately rejects control characters in untrusted provider input.
          /[\s\\\u0000-\u001f\u007f]/u.test(callbackUrl) ||
          callbackUrl.split("?")[0] !== redirect
        )
          throw fail();
        const url = new URL(callbackUrl);
        if (
          url.hash !== "" ||
          url.username !== "" ||
          url.password !== "" ||
          url.origin + url.pathname !== redirect
        )
          throw fail();
        const values = url.searchParams;
        if (
          values.getAll("state").length !== 1 ||
          values.getAll("code").length > 1 ||
          values.getAll("error").length > 1 ||
          values.has("code") === values.has("error")
        ) {
          throw fail();
        }
        const state = values.get("state");
        if (!validState(state)) throw fail();
        if (values.has("error")) {
          if (!graphic(values.get("error"), 256)) throw fail();
          return { status: "denied", state };
        }
        const code = values.get("code");
        if (!graphic(code, 4096)) throw fail();
        // scope/authuser/prompt/error_description are intentionally not trusted or
        // projected. Only the token endpoint can establish the granted permissions.
        return { status: "code", state, code };
      } catch {
        throw fail();
      }
    },
    createConsumeCommand(callback, session, appUrl) {
      try {
        if (
          !callback ||
          (callback.status !== "denied" && callback.status !== "code") ||
          (callback.status === "code" && !graphic(callback.code, 4096))
        ) {
          throw fail();
        }
        return {
          stateHash: stateHash(callback.state),
          userId: owner(session),
          redirectUri: redirectUri(appUrl),
        };
      } catch {
        throw fail();
      }
    },
    validateGrantedScopes(value) {
      if (typeof value !== "string" || value.length > 1024 || value.trim() === "") throw fail();
      const granted = value.trim().split(/\s+/);
      if (
        granted.length !== scopes.length ||
        new Set(granted).size !== granted.length ||
        !scopes.every((scope) => granted.includes(scope))
      ) {
        throw fail();
      }
      return [...scopes];
    },
  };
}
