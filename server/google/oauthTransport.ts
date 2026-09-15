import type { CalendarEnvironment } from "../env/cloud.js";
import { object, type GoogleHttp } from "./http.js";
import type { GoogleOAuthPolicy } from "./oauthPolicy.js";

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  scopes: readonly string[];
  /** ISO instant derived from Google's `expires_in`; null when Google omits a usable lifetime. */
  accessTokenExpiresAt: string | null;
}

/** Google issues hour-long access tokens; reject nonsense lifetimes before they become cache entries. */
const MAX_EXPIRES_IN_SECONDS = 24 * 60 * 60;

export function createGoogleOAuthTransport(
  runtime: { readonly http: GoogleHttp; readonly policy: GoogleOAuthPolicy },
  configuration: CalendarEnvironment,
  signal: AbortSignal,
  fetcher = fetch,
) {
  const { http, policy } = runtime;
  async function token(
    parameters: Record<string, string>,
    refreshing: boolean,
  ): Promise<GoogleTokens> {
    const issuedAt = Date.now();
    const { response, value } = await http.boundedFetchJson(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...parameters,
          client_id: configuration.GOOGLE_CLIENT_ID,
          client_secret: configuration.GOOGLE_CLIENT_SECRET,
        }).toString(),
      },
      fetcher,
    );
    if (!response.ok) {
      if (object(value) && value.error === "invalid_grant")
        throw http.error("reconnect_required", 409);
      throw http.error(http.unavailableCode);
    }
    if (
      !object(value) ||
      typeof value.access_token !== "string" ||
      value.access_token.length > 4096 ||
      !/^[A-Za-z0-9._~+/-]+=*$/.test(value.access_token) ||
      typeof value.token_type !== "string" ||
      value.token_type.toLowerCase() !== "bearer" ||
      (value.refresh_token !== undefined &&
        (typeof value.refresh_token !== "string" ||
          value.refresh_token.length > 16_384 ||
          !/^[\x21-\x7e]+$/.test(value.refresh_token)))
    ) {
      throw http.error(http.unavailableCode);
    }
    // A refresh response may omit scope: it retains the previously verified grant.
    const scopes =
      refreshing && value.scope === undefined
        ? policy.definition.scopes
        : policy.validateGrantedScopes(value.scope);
    const expiresIn =
      typeof value.expires_in === "number" &&
      Number.isInteger(value.expires_in) &&
      value.expires_in > 0 &&
      value.expires_in <= MAX_EXPIRES_IN_SECONDS
        ? value.expires_in
        : null;
    return {
      accessToken: value.access_token,
      refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : null,
      scopes,
      accessTokenExpiresAt:
        expiresIn === null ? null : new Date(issuedAt + expiresIn * 1000).toISOString(),
    };
  }
  return {
    exchange(code: string, redirectUri: string, verifier: string) {
      return token(
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        },
        false,
      );
    },
    refresh(refreshToken: string) {
      return token({ grant_type: "refresh_token", refresh_token: refreshToken }, true);
    },
    async revoke(refreshToken: string): Promise<void> {
      try {
        const response = await fetcher("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          body: new URLSearchParams({ token: refreshToken }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
        });
        void response.body?.cancel().catch(() => undefined);
      } catch {
        /* Local disconnection remains effective if Google's revocation is unavailable. */
      }
    },
  };
}
