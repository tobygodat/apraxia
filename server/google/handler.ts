import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  requireApplicationEnvironment,
  requireCalendarEnvironment,
  EnvironmentConfigurationError,
  type ApplicationEnvironment,
} from "../env/cloud.js";
import {
  verifySupabaseSession,
  SessionVerificationError,
  type VerifiedSession,
} from "../auth/verifySession.js";
import {
  encryptRefreshToken,
  decryptRefreshToken,
  encryptAccessToken,
  decryptAccessToken,
  TokenEncryptionError,
  type TokenEncryptionContext,
} from "../calendar/tokenEncryption.js";
import { GoogleHttpError, object, type GoogleHttp } from "./http.js";
import { GoogleOAuthPolicyError, type GoogleOAuthPolicy } from "./oauthPolicy.js";
import { createGoogleOAuthTransport, type GoogleTokens } from "./oauthTransport.js";
import type { AccessTokenCache, GoogleStore, StoredGoogleCredentials } from "./store.js";
import { unavailableCode, unavailableMessage, type GoogleProviderDefinition } from "./provider.js";

/** Refresh instead of reusing a cached access token this close to its expiry. */
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export interface GoogleProviderRuntime {
  readonly definition: GoogleProviderDefinition;
  readonly http: GoogleHttp;
  readonly policy: GoogleOAuthPolicy;
}

interface GoogleAuthorizedContext<A extends string, P, S extends GoogleStore> {
  readonly action: A;
  readonly request: Request;
  /** Result of the adapter's `prepare` step (request validation before Google configuration). */
  readonly prepared: P;
  readonly session: VerifiedSession;
  readonly userId: string;
  readonly environment: ApplicationEnvironment;
  readonly fetcher: typeof fetch;
  readonly store: S;
  /** The connected credential row this request is acting on (never the decrypted tokens). */
  readonly stored: StoredGoogleCredentials;
  readonly accessToken: string;
  readonly headers: Record<string, string>;
  json(value: unknown, status?: number): Response;
  /** Marks the grant used by this request as reconnect_required unless it changed meanwhile. */
  expireUsedGrant(): Promise<void>;
}

export interface GoogleHandlerAdapter<A extends string, P, S extends GoogleStore> {
  readonly runtime: GoogleProviderRuntime;
  expectedMethod(action: A, request: Request): "GET" | "POST";
  createStore(environment: ApplicationEnvironment, signal: AbortSignal, fetcher: typeof fetch): S;
  /** Runs after session verification and before Google configuration is required. */
  prepare?(action: A, request: Request): Promise<P>;
  /** Provider work with a valid access token. Throw a reconnect_required error on an upstream 401. */
  authorized(context: GoogleAuthorizedContext<A, P, S>): Promise<Response>;
  /** Adapter-specific errors that also mean the access token was rejected upstream. */
  isUpstreamUnauthorized?(error: unknown): boolean;
  /** Adapter-specific error responses; return null to fall through to the shared mapping. */
  mapError?(error: unknown, json: (value: unknown, status?: number) => Response): Response | null;
}

/** Returns a still-valid cached access token, or null when a refresh is required. */
export function readCachedAccessToken(
  stored: StoredGoogleCredentials,
  context: TokenEncryptionContext,
  key: string,
  now = Date.now(),
): string | null {
  if (!stored.accessTokenEnvelope || !stored.accessTokenExpiresAt) return null;
  const expiresAt = Date.parse(stored.accessTokenExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt - now <= ACCESS_TOKEN_REFRESH_MARGIN_MS) return null;
  try {
    return decryptAccessToken(stored.accessTokenEnvelope, context, key);
  } catch {
    return null;
  }
}

/**
 * One request pipeline for every Google integration: method/origin checks, the
 * callback handoff, session verification, connect/complete/disconnect/status,
 * and access-token acquisition (cached, refreshed near expiry, refreshed once
 * after an upstream 401). Ownership derives from Auth verification or a trusted
 * server-injected agent identity, never request parameters.
 */
export function createGoogleConnectionHandler<A extends string, P, S extends GoogleStore>(
  adapter: GoogleHandlerAdapter<A, P, S>,
  action: A,
  dependencies: {
    environment?: Record<string, string | undefined>;
    fetch?: typeof fetch;
    /** Server-injected identity after agent authentication; never populated from request input. */
    verifiedSession?: VerifiedSession;
  } = {},
) {
  const { definition, http, policy } = adapter.runtime;
  const headers: Record<string, string> = { ...PRIVATE_HEADERS };
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
  return async (request: Request): Promise<Response> => {
    try {
      if (dependencies.verifiedSession && !["calendars", "events", "files", "pdf"].includes(action))
        return json(
          { error: { code: "invalid_request", message: "This action is unavailable." } },
          403,
        );
      const expectedMethod = adapter.expectedMethod(action, request);
      if (request.method !== expectedMethod)
        return json(
          { error: { code: "invalid_request", message: "This action is unavailable." } },
          405,
        );
      const environment = requireApplicationEnvironment(dependencies.environment ?? process.env);
      const fetcher = dependencies.fetch ?? fetch;
      if (action === "callback") {
        const callback = policy.parseCallback(request.url, environment.APP_URL);
        const target = new URL(definition.browserCallbackPath, environment.APP_URL);
        target.hash = new URLSearchParams(
          callback.status === "code"
            ? { state: callback.state, code: callback.code }
            : { state: callback.state, error: "access_denied" },
        ).toString();
        return new Response(null, { status: 303, headers: { ...headers, Location: target.href } });
      }
      if (expectedMethod === "POST") policy.assertMutationRequest(request, environment.APP_URL);
      const session =
        dependencies.verifiedSession ??
        (await verifySupabaseSession(request, environment, { fetch: fetcher }));
      const store = adapter.createStore(environment, request.signal, fetcher);
      const userId = session.userId;
      if (action === "status") return json((await store.read(userId))?.connection ?? null);
      if (action === "disconnect") {
        const previous = await store.read(userId);
        await store.clear(userId, "disconnected");
        if (previous?.envelope && previous.keyVersion === 1) {
          try {
            const configuration = requireCalendarEnvironment(
              dependencies.environment ?? process.env,
            );
            const refreshToken = decryptRefreshToken(
              previous.envelope,
              { userId, connectionId: previous.connection.id, keyVersion: 1 },
              configuration.GOOGLE_TOKEN_ENCRYPTION_KEY,
            );
            await createGoogleOAuthTransport(
              adapter.runtime,
              configuration,
              request.signal,
              fetcher,
            ).revoke(refreshToken);
          } catch {
            /* Local disconnect also works after Google configuration/key loss. */
          }
        }
        return json({ disconnected: true });
      }
      const prepared = (await adapter.prepare?.(action, request)) as P;
      const google = requireCalendarEnvironment(dependencies.environment ?? process.env);
      const key = google.GOOGLE_TOKEN_ENCRYPTION_KEY;
      const oauth = createGoogleOAuthTransport(adapter.runtime, google, request.signal, fetcher);
      const context = (connectionId: string): TokenEncryptionContext => ({
        userId,
        connectionId,
        keyVersion: 1,
      });
      const decrypt = (stored: StoredGoogleCredentials): string => {
        if (!stored.envelope || stored.keyVersion !== 1)
          throw http.error("reconnect_required", 409);
        return decryptRefreshToken(stored.envelope, context(stored.connection.id), key);
      };
      const cacheFor = (tokens: GoogleTokens, connectionId: string): AccessTokenCache | null =>
        tokens.accessTokenExpiresAt === null
          ? null
          : {
              envelope: encryptAccessToken(tokens.accessToken, context(connectionId), key),
              expiresAt: tokens.accessTokenExpiresAt,
            };
      const recoverable = (error: unknown) =>
        error instanceof TokenEncryptionError ||
        error instanceof GoogleOAuthPolicyError ||
        (error instanceof GoogleHttpError && error.code === "reconnect_required");

      if (action === "connect") {
        const attempt = policy.createAttempt(session, {
          appUrl: environment.APP_URL,
          clientId: google.GOOGLE_CLIENT_ID,
        });
        const verifier = randomBytes(32).toString("base64url");
        const authorization = new URL(attempt.authorizationUrl);
        authorization.searchParams.set(
          "code_challenge",
          createHash("sha256").update(verifier).digest("base64url"),
        );
        authorization.searchParams.set("code_challenge_method", "S256");
        const transaction = attempt.transaction;
        await store.rpc(`begin_${definition.key}_oauth_attempt`, {
          p_verified_user_id: userId,
          p_state_hash: transaction.stateHash,
          p_redirect_uri: transaction.redirectUri,
          p_expires_at: transaction.expiresAt,
          p_code_verifier: verifier,
        });
        return json({ authorizationUrl: authorization.href });
      }
      if (action === "complete") {
        const body = await http.readBoundedJson(
          new Response(request.body),
          16 * 1024,
          request.signal,
        );
        if (
          !object(body) ||
          Object.keys(body).some((key) => !["state", "code", "error"].includes(key)) ||
          typeof body.state !== "string" ||
          (typeof body.code !== "string" && typeof body.error !== "string")
        ) {
          throw http.error("invalid_request", 400);
        }
        const callbackUrl = new URL(policy.redirectUri(environment.APP_URL));
        for (const name of ["state", "code", "error"])
          if (typeof body[name] === "string") callbackUrl.searchParams.set(name, body[name]);
        const callback = policy.parseCallback(callbackUrl.href, environment.APP_URL);
        // Read the revision before consuming state/exchanging: disconnect wins against late completions.
        const previous = await store.read(userId);
        const command = policy.createConsumeCommand(callback, session, environment.APP_URL);
        const consumed = await store.rpc(`consume_${definition.key}_oauth_attempt`, {
          p_verified_user_id: userId,
          p_state_hash: command.stateHash,
          p_redirect_uri: command.redirectUri,
        });
        if (!object(consumed) || typeof consumed.code_verifier !== "string")
          throw http.error("invalid_request", 400);
        if (callback.status === "denied") return json({ connected: false, denied: true });
        const tokens = await oauth.exchange(
          callback.code,
          command.redirectUri,
          consumed.code_verifier,
        );
        let refreshToken = tokens.refreshToken;
        let issued = tokens;
        if (!refreshToken) {
          // Without reuse, a missing replacement must not silently reconnect a different
          // Google account using the previous account's refresh token.
          if (!definition.reuseRefreshTokenOnReconnect || !previous?.envelope)
            throw http.error("reconnect_required", 409);
          try {
            policy.validateGrantedScopes(previous.connection.grantedScopes.join(" "));
            const existingToken = decrypt(previous);
            // Consent can omit a replacement. Only reuse a credential that still refreshes,
            // and retain any rotation returned by that verification request.
            const verified = await oauth.refresh(existingToken);
            refreshToken = verified.refreshToken ?? existingToken;
            issued = verified;
          } catch (error) {
            if (recoverable(error)) {
              await store.clear(userId, "reconnect_required", previous.connection.updatedAt);
              throw http.error("reconnect_required", 409);
            }
            throw error;
          }
        }
        const id = previous?.connection.id ?? randomUUID();
        const envelope = encryptRefreshToken(refreshToken, context(id), key);
        if (
          !(await store.save(
            userId,
            id,
            previous?.connection.updatedAt ?? null,
            envelope,
            tokens.scopes,
            cacheFor(issued, id),
          ))
        ) {
          throw http.error("invalid_request", 409);
        }
        return json({ connected: true });
      }

      const stored = await store.read(userId);
      if (!stored || stored.connection.connectionState !== "connected" || !stored.envelope) {
        throw http.error("reconnect_required", 409);
      }
      const currentEnvelope: string = stored.envelope;
      let usedEnvelope = currentEnvelope;
      const failClosed = async <T>(work: () => Promise<T> | T): Promise<T> => {
        try {
          return await work();
        } catch (error) {
          if (recoverable(error)) {
            await store.clear(userId, "reconnect_required", stored.connection.updatedAt);
            throw http.error("reconnect_required", 409);
          }
          throw error;
        }
      };
      await failClosed(() =>
        policy.validateGrantedScopes(stored.connection.grantedScopes.join(" ")),
      );
      const refreshAccessToken = () =>
        failClosed(async () => {
          const tokens = await oauth.refresh(decrypt(stored));
          const envelope = tokens.refreshToken
            ? encryptRefreshToken(tokens.refreshToken, context(stored.connection.id), key)
            : currentEnvelope;
          usedEnvelope = envelope;
          const saved = await store.save(
            userId,
            stored.connection.id,
            stored.connection.updatedAt,
            envelope,
            definition.scopes,
            cacheFor(tokens, stored.connection.id),
          );
          if (!saved) {
            // A concurrent refresh can succeed; a disconnect or new grant must stop this request.
            const current = await store.read(userId);
            if (
              !current ||
              current.connection.connectionState !== "connected" ||
              current.envelope !== envelope
            ) {
              throw http.error("reconnect_required", 409);
            }
          }
          return tokens.accessToken;
        });
      const expireUsedGrant = async () => {
        const current = await store.read(userId);
        if (current?.envelope === usedEnvelope)
          await store.clear(userId, "reconnect_required", current.connection.updatedAt);
      };
      const unauthorized = (error: unknown) =>
        (error instanceof GoogleHttpError && error.code === "reconnect_required") ||
        adapter.isUpstreamUnauthorized?.(error) === true;
      const run = (accessToken: string) =>
        adapter.authorized({
          action,
          request,
          prepared,
          session,
          userId,
          environment,
          fetcher,
          store,
          stored,
          accessToken,
          headers,
          json,
          expireUsedGrant,
        });
      const cached = readCachedAccessToken(stored, context(stored.connection.id), key);
      if (cached !== null) {
        try {
          return await run(cached);
        } catch (error) {
          // A cached token can expire or be revoked early; refresh once before giving up.
          if (!unauthorized(error)) throw error;
        }
      }
      const fresh = await refreshAccessToken();
      try {
        return await run(fresh);
      } catch (error) {
        if (unauthorized(error)) await expireUsedGrant();
        throw error;
      }
    } catch (error) {
      if (error instanceof SessionVerificationError)
        return json(
          { error: { code: error.code, message: error.message } },
          error.code === "unauthenticated" ? 401 : 503,
        );
      if (error instanceof EnvironmentConfigurationError) {
        return json(
          {
            error: {
              code: "not_configured",
              message: `${definition.noun} setup is not finished yet.`,
            },
          },
          503,
        );
      }
      const mapped = adapter.mapError?.(error, json);
      if (mapped) return mapped;
      if (error instanceof GoogleOAuthPolicyError) {
        return json(
          {
            error: {
              code: "invalid_request",
              message: `${definition.noun} request could not be verified. Try again.`,
            },
          },
          400,
        );
      }
      if (error instanceof GoogleHttpError)
        return json({ error: { code: error.code, message: error.message } }, error.status);
      return json(
        { error: { code: unavailableCode(definition), message: unavailableMessage(definition) } },
        502,
      );
    }
  };
}
