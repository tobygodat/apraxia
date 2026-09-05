// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { createCalendarService } from "./calendarService";
const client = { auth: { getSession: async () => ({ data: { session: { access_token: "session-token" } }, error: null }) } } as unknown as SupabaseClient<Database>;
afterEach(() => vi.unstubAllGlobals());
it("sends authenticated JSON mutations and returns only the authorization URL", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ authorizationUrl: "https://accounts.google.com/oauth" }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  expect(await createCalendarService(client).connect()).toBe("https://accounts.google.com/oauth");
  expect(fetch).toHaveBeenCalledWith("/api/calendar/connect", expect.objectContaining({ method: "POST", body: "{}", headers: { Authorization: "Bearer session-token", "Content-Type": "application/json" } }));
});
it("does not expose upstream error messages", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "reconnect_required", message: "secret upstream body" } }), { status: 401 }));
  await expect(createCalendarService(client).status()).rejects.toThrow("Reconnect Google Calendar in Settings to allow event editing.");
});
