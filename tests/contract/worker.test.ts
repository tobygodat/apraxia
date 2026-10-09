import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../../worker/index.js";

const assets = { fetch: vi.fn<(request: Request) => Promise<Response>>() };

beforeEach(() => {
  assets.fetch.mockReset();
  assets.fetch.mockResolvedValue(new Response("<!doctype html>", { status: 200 }));
});

function get(path: string) {
  return worker.fetch(new Request(`https://apraxia.dev${path}`), { ASSETS: assets });
}

describe("Cloudflare worker", () => {
  it("serves non-API paths from the static assets with the security headers", async () => {
    const response = await get("/tasks");

    expect(assets.fetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("marks the calendar callback page uncacheable", async () => {
    const response = await get("/calendar/callback");

    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("routes API paths to their handlers instead of the assets", async () => {
    const response = await get("/api/health");

    expect(assets.fetch).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin");
    expect(await response.json()).toMatchObject({ runtime: "cloudflare-worker" });
  });

  it("answers an unknown API path with 404 rather than the app shell", async () => {
    const response = await get("/api/unknown");

    expect(assets.fetch).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
  });
});
