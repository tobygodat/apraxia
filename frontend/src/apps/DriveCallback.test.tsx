// @vitest-environment happy-dom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";
import { DriveCallback, finishDriveHandoff, parseDriveHandoff } from "./DriveCallback";

const input = { state: "s".repeat(43), code: "one-time-code" };
function client(userId: string | null = "owner") {
  return { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: userId ? {
    user: { id: userId }, access_token: "fictional-jwt",
  } : null }, error: null }) } } as unknown as SupabaseClient<Database>;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("accepts a single handoff and rejects ambiguous or malformed callback material", () => {
  expect(parseDriveHandoff(`#state=${input.state}&code=one-time-code`)).toEqual(input);
  expect(parseDriveHandoff(`#state=${input.state}&error=access_denied`)).toEqual({ state: input.state, error: "access_denied" });
  for (const hash of ["", "#state=short&code=x", `#state=${input.state}&code=x&code=y`,
    `#state=${input.state}&code=x&error=access_denied`, `#state=${input.state}&code=%0A`]) {
    expect(parseDriveHandoff(hash)).toBeNull();
  }
});

it.each([null, "different-owner"])("does not exchange a code with a missing or switched session: %s", async userId => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(finishDriveHandoff(client(userId), "owner", input)).rejects.toThrow("session_changed");
  expect(fetcher).not.toHaveBeenCalled();
});

it("submits only once during StrictMode replay and uses the restored session", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ connected: true })));
  vi.stubGlobal("fetch", fetcher);
  render(<StrictMode><MemoryRouter initialEntries={["/drive/callback"]}><Routes>
    <Route path="/drive/callback" element={<DriveCallback client={client()} userId="owner" input={input} />} />
    <Route path="/classes" element={<h1>Classes destination</h1>} />
  </Routes></MemoryRouter></StrictMode>);
  await screen.findByRole("heading", { name: "Classes destination" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith("/api/drive/complete", expect.objectContaining({
    method: "POST", cache: "no-store", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json", Authorization: "Bearer fictional-jwt" },
    body: JSON.stringify(input),
  }));
});

it("offers a restart after an exchange fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
  render(<MemoryRouter><DriveCallback client={client()} userId="owner" input={input} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Start the connection again"));
  expect(screen.getByRole("link", { name: "Open Classes" }).getAttribute("href")).toBe("/classes");
});
