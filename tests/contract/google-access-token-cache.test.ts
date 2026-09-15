import { describe, expect, it, vi } from "vitest";
import { createCalendarHandler } from "../../server/calendar/calendarHandlers";
import { CALENDAR_SCOPES } from "../../server/calendar/oauthPolicy";
import { createDriveHandler } from "../../server/drive/driveHandlers";
import { DRIVE_SCOPES } from "../../server/drive/oauthPolicy";
import {
  decryptAccessToken,
  encryptAccessToken,
  encryptRefreshToken,
} from "../../server/calendar/tokenEncryption";
import { ACCESS_TOKEN_REFRESH_MARGIN_MS, readCachedAccessToken } from "../../server/google/handler";

const userId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const environment = {
  APP_URL: "https://app.example.test",
  VITE_SUPABASE_URL: "https://db.example.test",
  SUPABASE_URL: "https://db.example.test",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_test",
  SUPABASE_ANON_KEY: "sb_publishable_test",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
};
const key = environment.GOOGLE_TOKEN_ENCRYPTION_KEY;
const context = { userId, connectionId, keyVersion: 1 };
const updatedAt = "2026-09-04T12:00:00Z";
type Provider = "calendar" | "drive";

/** A connected credential row as the read RPC returns it, optionally with a cached access token. */
const stored = (provider: Provider, cache?: { token: string; expiresInMs: number }) => ({
  connection: {
    id: connectionId,
    connection_state: "connected",
    created_at: updatedAt,
    updated_at: updatedAt,
    granted_scopes: [...(provider === "calendar" ? CALENDAR_SCOPES : DRIVE_SCOPES)],
  },
  envelope: encryptRefreshToken("existing-refresh", context, key),
  key_version: 1,
  timezone: "America/New_York",
  ...(cache
    ? {
        access_token_envelope: encryptAccessToken(cache.token, context, key),
        access_token_expires_at: new Date(Date.now() + cache.expiresInMs).toISOString(),
      }
    : {}),
});
const bearer = (init: RequestInit | undefined) => new Headers(init?.headers).get("authorization");
const calls = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>, match: (url: string) => boolean) =>
  fetcher.mock.calls.filter(([url]) => match(String(url)));
const rpc = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>, name: string) =>
  calls(fetcher, (url) => url.endsWith(`/${name}`));

/** Session, storage, and token-endpoint fixtures; `api` answers every other Google request. */
function fetcherFor(
  provider: Provider,
  credentials: unknown,
  api: (url: string, init: RequestInit | undefined) => Response,
) {
  return vi.fn<typeof fetch>(async (url, init) => {
    const target = String(url);
    if (target.endsWith("/auth/v1/user"))
      return Response.json({ id: userId, role: "authenticated", is_anonymous: false });
    if (target.endsWith(`/read_${provider}_credentials`)) return Response.json(credentials);
    if (target.endsWith("/token"))
      return Response.json({
        access_token: "fresh-access",
        token_type: "Bearer",
        expires_in: 3600,
      });
    if (target.endsWith("/sync_calendar_preferences")) return Response.json([]);
    if (target.includes("googleapis.com")) return api(target, init);
    return Response.json(true);
  });
}

const providers: {
  provider: Provider;
  run: (fetcher: typeof fetch) => Promise<Response>;
  ok: () => Response;
}[] = [
  {
    provider: "calendar",
    ok: () => Response.json({ items: [] }),
    run: (fetcher) =>
      createCalendarHandler("calendars", { environment, fetch: fetcher })(
        new Request(`${environment.APP_URL}/api/calendar/calendars`, {
          headers: { Authorization: "Bearer session-token" },
        }),
      ),
  },
  {
    provider: "drive",
    ok: () => Response.json({ files: [] }),
    run: (fetcher) =>
      createDriveHandler("files", { environment, fetch: fetcher })(
        new Request(`${environment.APP_URL}/api/drive/files`, {
          headers: { Authorization: "Bearer session-token" },
        }),
      ),
  },
];

describe.each(providers)("Google access token cache ($provider)", ({ provider, run, ok }) => {
  it("reuses a cached access token without contacting the token endpoint or storage", async () => {
    const fetcher = fetcherFor(
      provider,
      stored(provider, { token: "cached-access", expiresInMs: 3_600_000 }),
      ok,
    );
    const response = await run(fetcher);
    expect(response.status).toBe(200);
    expect(rpc(fetcher, "token")).toHaveLength(0);
    expect(rpc(fetcher, `save_${provider}_credentials`)).toHaveLength(0);
    const api = calls(fetcher, (url) => url.includes("www.googleapis.com"));
    expect(api.length).toBeGreaterThan(0);
    expect(api.every(([, init]) => bearer(init) === "Bearer cached-access")).toBe(true);
  });

  it("refreshes near expiry and persists the replacement encrypted with its expiry", async () => {
    const fetcher = fetcherFor(
      provider,
      stored(provider, { token: "cached-access", expiresInMs: 30_000 }),
      ok,
    );
    const before = Date.now();
    const response = await run(fetcher);
    expect(response.status).toBe(200);
    expect(rpc(fetcher, "token")).toHaveLength(1);
    const api = calls(fetcher, (url) => url.includes("www.googleapis.com"));
    expect(api.every(([, init]) => bearer(init) === "Bearer fresh-access")).toBe(true);
    const [save] = rpc(fetcher, `save_${provider}_credentials`);
    const body = save![1]!.body as string;
    expect(body).not.toContain("fresh-access");
    const saved = JSON.parse(body) as Record<string, string>;
    expect(saved.p_expected_updated_at).toBe(updatedAt);
    expect(decryptAccessToken(saved.p_access_token_envelope, context, key)).toBe("fresh-access");
    const expiresAt = Date.parse(saved.p_access_token_expires_at!);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
  });

  it("refreshes once after Google rejects a cached token, then retries with the new token", async () => {
    const fetcher = fetcherFor(
      provider,
      stored(provider, { token: "cached-access", expiresInMs: 3_600_000 }),
      (_url, init) =>
        bearer(init) === "Bearer cached-access"
          ? Response.json({ error: "private-detail" }, { status: 401 })
          : ok(),
    );
    const response = await run(fetcher);
    expect(response.status).toBe(200);
    expect(rpc(fetcher, "token")).toHaveLength(1);
    expect(
      calls(fetcher, (url) => url.includes("www.googleapis.com")).map(([, init]) => bearer(init)),
    ).toEqual(["Bearer cached-access", "Bearer fresh-access"]);
    expect(rpc(fetcher, `clear_${provider}_credentials`)).toHaveLength(0);
    expect(await response.text()).not.toContain("private-detail");
  });

  it("expires the grant when the freshly refreshed token is rejected as well, without a second refresh", async () => {
    const fetcher = fetcherFor(
      provider,
      stored(provider, { token: "cached-access", expiresInMs: 3_600_000 }),
      () => Response.json({ error: "private-detail" }, { status: 401 }),
    );
    const response = await run(fetcher);
    expect(response.status).toBe(409);
    expect(rpc(fetcher, "token")).toHaveLength(1);
    expect(calls(fetcher, (url) => url.includes("www.googleapis.com"))).toHaveLength(2);
    const [clear] = rpc(fetcher, `clear_${provider}_credentials`);
    expect(JSON.parse(clear![1]!.body as string)).toMatchObject({
      p_state: "reconnect_required",
      p_expected_updated_at: updatedAt,
    });
  });

  it("clears the cache instead of caching a token whose lifetime Google omitted", async () => {
    const fetcher = fetcherFor(provider, stored(provider), ok);
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token"))
        return Response.json({ access_token: "fresh-access", token_type: "Bearer" });
      return fetcherFor(provider, stored(provider), ok)(url, init);
    });
    expect((await run(fetcher)).status).toBe(200);
    const [save] = rpc(fetcher, `save_${provider}_credentials`);
    expect(JSON.parse(save![1]!.body as string)).toMatchObject({
      p_access_token_envelope: null,
      p_access_token_expires_at: null,
    });
  });
});

describe("readCachedAccessToken", () => {
  const base = {
    connection: {
      id: connectionId,
      googleAccountId: null,
      displayEmail: null,
      connectionState: "connected" as const,
      grantedScopes: [...CALENDAR_SCOPES],
      lastSuccessfulRefreshAt: null,
      createdAt: updatedAt,
      updatedAt,
    },
    envelope: "unused",
    keyVersion: 1,
    timezone: null,
  };
  const at = (offset: number) => new Date(1_800_000_000_000 + offset).toISOString();

  it("applies the refresh margin exactly", () => {
    const accessTokenEnvelope = encryptAccessToken("cached-access", context, key);
    const now = 1_800_000_000_000;
    expect(
      readCachedAccessToken(
        { ...base, accessTokenEnvelope, accessTokenExpiresAt: at(ACCESS_TOKEN_REFRESH_MARGIN_MS) },
        context,
        key,
        now,
      ),
    ).toBeNull();
    expect(
      readCachedAccessToken(
        {
          ...base,
          accessTokenEnvelope,
          accessTokenExpiresAt: at(ACCESS_TOKEN_REFRESH_MARGIN_MS + 1),
        },
        context,
        key,
        now,
      ),
    ).toBe("cached-access");
  });

  it("never accepts a refresh-token envelope, another owner, or a malformed expiry as a cached access token", () => {
    const accessTokenEnvelope = encryptAccessToken("cached-access", context, key);
    const future = at(3_600_000);
    expect(
      readCachedAccessToken(
        {
          ...base,
          accessTokenEnvelope: encryptRefreshToken("cached-access", context, key),
          accessTokenExpiresAt: future,
        },
        context,
        key,
        1_800_000_000_000,
      ),
    ).toBeNull();
    expect(
      readCachedAccessToken(
        { ...base, accessTokenEnvelope, accessTokenExpiresAt: future },
        { ...context, userId: "33333333-3333-4333-8333-333333333333" },
        key,
        1_800_000_000_000,
      ),
    ).toBeNull();
    expect(
      readCachedAccessToken(
        { ...base, accessTokenEnvelope, accessTokenExpiresAt: "soon" },
        context,
        key,
      ),
    ).toBeNull();
    expect(
      readCachedAccessToken(
        { ...base, accessTokenEnvelope: null, accessTokenExpiresAt: future },
        context,
        key,
      ),
    ).toBeNull();
  });
});

describe("Drive disconnect", () => {
  it("revokes the refresh token at Google and clears local credentials", async () => {
    const fetcher = fetcherFor("drive", stored("drive"), () => Response.json({}));
    const response = await createDriveHandler("disconnect", { environment, fetch: fetcher })(
      new Request(`${environment.APP_URL}/api/drive/disconnect`, {
        method: "POST",
        body: "{}",
        headers: {
          Authorization: "Bearer session-token",
          Origin: environment.APP_URL,
          "Content-Type": "application/json",
        },
      }),
    );
    expect(await response.json()).toEqual({ disconnected: true });
    const [revoke] = calls(fetcher, (url) => url === "https://oauth2.googleapis.com/revoke");
    expect(new URLSearchParams(revoke![1]!.body as string).get("token")).toBe("existing-refresh");
    expect(
      JSON.parse(rpc(fetcher, "clear_drive_credentials")[0]![1]!.body as string),
    ).toMatchObject({ p_state: "disconnected" });
  });
});
