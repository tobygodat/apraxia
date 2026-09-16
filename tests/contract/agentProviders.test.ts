import { describe, expect, it, vi } from "vitest";
import { serveAgentProvider } from "../../server/agent/agentProviders";
import { createCalendarHandler } from "../../server/calendar/calendarHandlers";
import { createDriveHandler } from "../../server/drive/driveHandlers";
import { CALENDAR_SCOPES } from "../../server/calendar/oauthPolicy";
import { DRIVE_SCOPES } from "../../server/drive/oauthPolicy";
import { encryptAccessToken, encryptRefreshToken } from "../../server/calendar/tokenEncryption";

const userId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const environment = {
  APP_URL: "https://app.example.test",
  VITE_SUPABASE_URL: "https://db.example.test",
  VITE_SUPABASE_ANON_KEY: "sb_publishable_test",
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_ANON_KEY: "sb_publishable_test",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
};
const updatedAt = "2026-09-04T12:00:00Z";
function setup(state: unknown = { state: "new" }, upstreamStatus = 200) {
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const target = String(url);
    if (target.includes("/read_")) {
      const tokenContext = { userId, connectionId, keyVersion: 1 };
      return Response.json({
        connection: {
          id: connectionId,
          connection_state: "connected",
          created_at: updatedAt,
          updated_at: updatedAt,
          granted_scopes: target.includes("calendar") ? CALENDAR_SCOPES : DRIVE_SCOPES,
        },
        envelope: encryptRefreshToken(
          "refresh-secret",
          tokenContext,
          environment.GOOGLE_TOKEN_ENCRYPTION_KEY,
        ),
        key_version: 1,
        timezone: "America/New_York",
        access_token_envelope: encryptAccessToken(
          "google-access",
          tokenContext,
          environment.GOOGLE_TOKEN_ENCRYPTION_KEY,
        ),
        access_token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      });
    }
    if (target.includes("calendarList"))
      return Response.json({
        items: [
          { id: "primary", summary: "Main", timeZone: "America/New_York", accessRole: "owner" },
        ],
      });
    if (target.includes("sync_calendar_preferences")) return Response.json([]);
    if (target.includes("drive/v3/files")) return Response.json({ files: [] });
    if (target.includes("/events"))
      return Response.json({ id: "event" }, { status: upstreamStatus });
    throw new Error(`Unexpected request ${target}`);
  });
  const rpc = vi.fn(async (_name: string, body: Record<string, unknown>) =>
    body.p_operation === "begin" ? state : true,
  );
  return { userId, environment, fetch: fetcher, rpc };
}
const values = {
  title: "Study",
  location: "",
  timeZone: "America/New_York",
  timing: { kind: "all_day", start: "2026-09-17", end: "2026-09-18" },
  recurrence: [],
};
const command = { action: "create", calendarId: "primary", values };
const request = (resource: string, body?: unknown, key = "muse-1") =>
  new Request(`${environment.APP_URL}/api/agent/v1/${resource}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer agent-secret", "Idempotency-Key": key },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe("agent provider boundary", () => {
  it.each(["calendars", "drive-files"])(
    "dispatches %s without leaking agent credentials or calling Supabase Auth",
    async (resource) => {
      const context = setup();
      const result = await serveAgentProvider(request(resource), context, resource);
      expect(result.status).toBe(200);
      expect(context.fetch.mock.calls.some(([url]) => String(url).includes("/auth/"))).toBe(false);
      expect(JSON.stringify(context.fetch.mock.calls)).not.toContain("agent-secret");
      expect(JSON.stringify(await result.json())).not.toContain("secret");
      const googleCalls = context.fetch.mock.calls.filter(([url]) =>
        String(url).includes("googleapis.com"),
      );
      expect(
        googleCalls.every(
          ([, init]) => new Headers(init?.headers).get("authorization") === "Bearer google-access",
        ),
      ).toBe(true);
    },
  );

  it("creates with deterministic event ID and records the replayable result", async () => {
    const context = setup();
    const response = await serveAgentProvider(request("events", command), context, "events");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ saved: true, eventId: expect.stringMatching(/^[a-f0-9]{32}$/) });
    expect(context.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_operation: "begin",
      p_user_id: userId,
    });
    expect(context.rpc.mock.calls[1]?.[1]).toMatchObject({
      p_operation: "finish",
      p_result: { status: 200, body: result },
    });
    const another = setup();
    const replay = await serveAgentProvider(request("events", command), another, "events");
    expect((await replay.json()).eventId).toBe(result.eventId);
  });

  it("allows read-only detail commands without an idempotency key", async () => {
    const context = setup();
    const baseFetch = context.fetch.getMockImplementation()!;
    context.fetch.mockImplementation(async (url, init) =>
      String(url).includes("/events/")
        ? Response.json({
            id: "event",
            etag: "current",
            summary: "Study",
            start: { date: "2026-09-17" },
            end: { date: "2026-09-18" },
          })
        : baseFetch(url, init),
    );
    const response = await serveAgentProvider(
      request(
        "events",
        { action: "detail", calendarId: "primary", eventId: "event", scope: "instance" },
        "",
      ),
      context,
      "events",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ eventId: "event", etag: "current" });
    expect(context.rpc).not.toHaveBeenCalled();
  });

  it.each(["pending", "completed"])(
    "does not repeat external writes for %s requests",
    async (state) => {
      const context = setup({ state, result: { status: 200, body: { saved: true } } });
      const response = await serveAgentProvider(request("events", command), context, "events");
      expect(response.status).toBe(state === "completed" ? 200 : 409);
      if (state === "pending") expect((await response.json()).eventId).toMatch(/^[a-f0-9]{32}$/);
      expect(context.fetch).not.toHaveBeenCalled();
    },
  );

  it("reports uncertain upstream writes and failed receipt persistence", async () => {
    const context = setup(undefined, 503);
    expect(
      await (await serveAgentProvider(request("events", command), context, "events")).json(),
    ).toMatchObject({
      error: { code: "outcome_unknown" },
      eventId: expect.stringMatching(/^[a-f0-9]{32}$/),
    });
    const failedFinish = setup();
    failedFinish.rpc.mockImplementation(async (_name, body) => {
      if (body.p_operation === "finish") throw new Error("database unavailable");
      return { state: "new" };
    });
    expect(
      (await serveAgentProvider(request("events", command), failedFinish, "events")).status,
    ).toBe(409);
  });

  it("rejects deletes, missing idempotency keys and stale-update commands without etags", async () => {
    const context = setup();
    for (const body of [{ action: "delete" }, { ...command, action: "update" }])
      expect((await serveAgentProvider(request("events", body), context, "events")).status).toBe(
        400,
      );
    expect(
      (await serveAgentProvider(request("events", command, ""), context, "events")).status,
    ).toBe(400);
    expect(context.rpc).not.toHaveBeenCalled();
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it("keeps browser authentication and origin checks, and denies connection and picker injection", async () => {
    const context = setup();
    const browser = await createCalendarHandler("calendars", context)(request("calendars"));
    expect(browser.status).toBe(503);
    expect(context.fetch.mock.calls.some(([url]) => String(url).includes("/auth/v1/user"))).toBe(
      true,
    );
    const injected = { ...context, verifiedSession: { userId } };
    expect(
      (await createCalendarHandler("events", injected)(request("events", command))).status,
    ).toBe(400);
    expect((await createDriveHandler("picker", injected)(request("picker", {}))).status).toBe(403);
    expect(
      (await createCalendarHandler("disconnect", injected)(request("disconnect", {}))).status,
    ).toBe(403);
  });
});
