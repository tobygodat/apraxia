import type { ApplicationEnvironment } from "../env/cloud.js";
import type { GoogleCalendarConnectionStatus } from "../../frontend/src/types/domain.js";
import { object, type GoogleHttp } from "./http.js";

const diagnosticCodes = new Set([
  "PGRST000",
  "PGRST001",
  "PGRST002",
  "PGRST202",
  "PGRST301",
  "PGRST302",
  "PGRST303",
  "42501",
  "42883",
  "42P01",
  "42703",
  "22023",
  "23503",
  "23505",
  "57014",
  "53300",
]);

export interface StoredGoogleCredentials {
  connection: GoogleCalendarConnectionStatus;
  envelope: string | null;
  keyVersion: number | null;
  /** Encrypted short-lived access token cached beside the refresh token; null when absent. */
  accessTokenEnvelope: string | null;
  accessTokenExpiresAt: string | null;
  /** Present only for providers whose read RPC joins the profile timezone. */
  timezone: string | null;
}

export interface AccessTokenCache {
  readonly envelope: string;
  readonly expiresAt: string;
}

function connectionStatus(http: GoogleHttp, value: unknown): GoogleCalendarConnectionStatus {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    typeof value.updated_at !== "string" ||
    typeof value.created_at !== "string" ||
    !Array.isArray(value.granted_scopes) ||
    !["connected", "disconnected", "reconnect_required"].includes(String(value.connection_state))
  ) {
    throw http.error(http.unavailableCode);
  }
  return {
    id: value.id,
    googleAccountId: typeof value.google_account_id === "string" ? value.google_account_id : null,
    displayEmail: typeof value.display_email === "string" ? value.display_email : null,
    connectionState: value.connection_state as GoogleCalendarConnectionStatus["connectionState"],
    grantedScopes: value.granted_scopes.filter((item): item is string => typeof item === "string"),
    lastSuccessfulRefreshAt:
      typeof value.last_successful_refresh_at === "string"
        ? value.last_successful_refresh_at
        : null,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

/** Service-role RPC access to one provider's private credential store. */
export function createGoogleStore(
  http: GoogleHttp,
  environment: ApplicationEnvironment,
  signal: AbortSignal,
  fetcher = fetch,
) {
  const { key: provider, noun } = http.definition;
  async function rpc(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    const key = environment.SUPABASE_SERVICE_ROLE_KEY;
    // Modern secret keys authenticate through apikey; they are not JWT bearer tokens.
    // Retain the Authorization fallback only for legacy service-role JWT keys.
    const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
    if (!key.startsWith("sb_secret_") && !key.startsWith("sb_publishable_"))
      headers.Authorization = `Bearer ${key}`;
    const { response, value } = await http.boundedFetchJson(
      `${environment.SUPABASE_URL}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        signal,
        headers,
        body: JSON.stringify(arguments_),
      },
      fetcher,
      4 * 1024 * 1024,
    );
    if (!response.ok) {
      // Operational diagnostics contain no provider messages, arguments, owners, or credentials.
      // Only recognized SQLSTATE/PostgREST identifiers may leave the provider response.
      const providerCode =
        object(value) && typeof value.code === "string" && diagnosticCodes.has(value.code)
          ? value.code
          : undefined;
      console.warn(`${noun} storage request failed.`, {
        operation: name,
        status: response.status,
        ...(providerCode === undefined ? {} : { code: providerCode }),
      });
      throw http.error(
        name.includes("oauth") ? "invalid_request" : http.unavailableCode,
        name.includes("oauth") ? 400 : 502,
      );
    }
    return value;
  }
  return {
    rpc,
    async read(userId: string): Promise<StoredGoogleCredentials | null> {
      const value = await rpc(`read_${provider}_credentials`, { p_verified_user_id: userId });
      if (value === null) return null;
      if (!object(value)) throw http.error(http.unavailableCode);
      return {
        connection: connectionStatus(http, value.connection),
        envelope: typeof value.envelope === "string" ? value.envelope : null,
        keyVersion: typeof value.key_version === "number" ? value.key_version : null,
        accessTokenEnvelope:
          typeof value.access_token_envelope === "string" ? value.access_token_envelope : null,
        accessTokenExpiresAt:
          typeof value.access_token_expires_at === "string" ? value.access_token_expires_at : null,
        timezone: typeof value.timezone === "string" ? value.timezone : null,
      };
    },
    async clear(
      userId: string,
      state: "disconnected" | "reconnect_required",
      expected?: string,
    ): Promise<boolean> {
      return (
        (await rpc(`clear_${provider}_credentials`, {
          p_verified_user_id: userId,
          p_state: state,
          p_expected_updated_at: expected ?? null,
        })) === true
      );
    },
    /** A null cache clears any previously cached access token together with the refresh save. */
    async save(
      userId: string,
      connectionId: string,
      expected: string | null,
      envelope: string,
      scopes: readonly string[],
      accessToken: AccessTokenCache | null,
    ): Promise<boolean> {
      return (
        (await rpc(`save_${provider}_credentials`, {
          p_verified_user_id: userId,
          p_connection_id: connectionId,
          p_expected_updated_at: expected,
          p_envelope: envelope,
          p_key_version: 1,
          p_scopes: scopes,
          p_access_token_envelope: accessToken?.envelope ?? null,
          p_access_token_expires_at: accessToken?.expiresAt ?? null,
        })) === true
      );
    },
  };
}
export type GoogleStore = ReturnType<typeof createGoogleStore>;
