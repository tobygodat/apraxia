import { describe, expect, it } from "vitest";
import { resolveRuntimeMode } from "./runtime";

describe("resolveRuntimeMode", () => {
  it.each([undefined, "", "cloud", " CLOUD "])(
    "defaults %s to the cloud runtime",
    (value) => {
      expect(resolveRuntimeMode(value)).toBe("cloud");
    },
  );

  it("keeps the legacy app behind an explicit flag", () => {
    expect(resolveRuntimeMode("legacy")).toBe("legacy");
  });

  it("fails closed for an invalid explicit value", () => {
    expect(() => resolveRuntimeMode("old-api")).toThrow(
      /either cloud or legacy/,
    );
  });
});
