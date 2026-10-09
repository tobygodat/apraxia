import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CalendarHttpError, calendarHttp } from "../../server/calendar/calendarHttp.js";
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

  it("reports the environment the Worker's DEPLOY_ENV names", async () => {
    vi.stubEnv("DEPLOY_ENV", "production");
    vi.stubEnv("VERCEL_ENV", undefined);

    const response = await get("/api/health");

    expect(await response.json()).toMatchObject({ environment: "production" });
    vi.unstubAllEnvs();
  });
});

describe("Worker-compatible fetch", () => {
  function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sources(path);
      return path.endsWith(".ts") ? [path] : [];
    });
  }

  it('never asks for redirect: "error", which workerd rejects before sending', () => {
    const offenders = ["server", "shared", "api", "worker"].flatMap(sources).filter((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .some((line) => !line.trim().startsWith("//") && /redirect:\s*["']error["']/.test(line)),
    );

    expect(offenders).toEqual([]);
  });

  it("refuses a redirect response as an upstream failure", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { Location: "https://example.com/" } }),
      );

    await expect(
      calendarHttp.boundedFetchJson("https://www.googleapis.com/x", {}, fetcher),
    ).rejects.toBeInstanceOf(CalendarHttpError);
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });
});
