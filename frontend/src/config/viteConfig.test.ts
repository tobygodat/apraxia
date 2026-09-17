import { describe, expect, it } from "vitest";

import { createViteConfig } from "../../vite.config";

describe("createViteConfig", () => {
  it.each([
    [{}, undefined],
    [{ VITE_APRAXIA_RUNTIME: "cloud" }, undefined],
    [{ VITE_APRAXIA_RUNTIME: "cloud", APRAXIA_CLOUD_DEV: "1" }, undefined],
    [
      { VITE_APRAXIA_RUNTIME: "legacy", APRAXIA_CLOUD_DEV: "0" },
      { "/api": "http://127.0.0.1:8000" },
    ],
  ])("selects the expected API proxy for %o", (environment, proxy) => {
    expect(createViteConfig(environment).server.proxy).toEqual(proxy);
  });

  it("rejects cloud development paired with the legacy app", () => {
    expect(() =>
      createViteConfig({
        APRAXIA_CLOUD_DEV: "1",
        VITE_APRAXIA_RUNTIME: "legacy",
      }),
    ).toThrow(/cannot be combined/);
  });

  it("fails closed for an invalid runtime instead of guessing a proxy mode", () => {
    expect(() => createViteConfig({ VITE_APRAXIA_RUNTIME: "old-api" })).toThrow(
      /either cloud or legacy/,
    );
  });
});
