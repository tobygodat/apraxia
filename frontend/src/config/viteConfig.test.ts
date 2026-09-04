import { describe, expect, it } from "vitest";

import { createViteConfig } from "../../vite.config";

describe("createViteConfig", () => {
  it.each([
    [{}, undefined],
    [{ VITE_ORBITOS_RUNTIME: "cloud" }, undefined],
    [
      { VITE_ORBITOS_RUNTIME: "cloud", ORBITOS_CLOUD_DEV: "1" },
      undefined,
    ],
    [
      { VITE_ORBITOS_RUNTIME: "legacy", ORBITOS_CLOUD_DEV: "0" },
      { "/api": "http://127.0.0.1:8000" },
    ],
  ])("selects the expected API proxy for %o", (environment, proxy) => {
    expect(createViteConfig(environment).server.proxy).toEqual(proxy);
  });

  it("rejects cloud development paired with the legacy app", () => {
    expect(() =>
      createViteConfig({
        ORBITOS_CLOUD_DEV: "1",
        VITE_ORBITOS_RUNTIME: "legacy",
      }),
    ).toThrow(/cannot be combined/);
  });

  it("fails closed for an invalid runtime instead of guessing a proxy mode", () => {
    expect(() =>
      createViteConfig({ VITE_ORBITOS_RUNTIME: "old-api" }),
    ).toThrow(/either cloud or legacy/);
  });
});
