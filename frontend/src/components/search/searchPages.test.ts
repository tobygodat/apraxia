import { describe, expect, it } from "vitest";
import { matchPages, stepHighlight } from "./searchPages";

describe("matchPages", () => {
  it("lists every page for an empty query", () => {
    expect(matchPages("  ").map((page) => page.label)).toEqual([
      "Home",
      "Tasks",
      "Ideas",
      "Projects",
      "Classes",
      "Career",
      "Appearance",
      "Settings",
    ]);
  });
  it("matches anywhere in the name, ignoring case, with prefix matches first", () => {
    expect(matchPages("AS").map((page) => page.to)).toEqual(["/todos", "/ideas", "/classes"]);
    expect(matchPages("c").map((page) => page.to)).toEqual([
      "/classes",
      "/career",
      "/projects",
      "/appearance",
    ]);
    expect(matchPages("zzz")).toEqual([]);
  });
});

describe("stepHighlight", () => {
  it("wraps at both ends and has nothing to highlight in an empty list", () => {
    expect(stepHighlight(2, 1, 3)).toBe(0);
    expect(stepHighlight(0, -1, 3)).toBe(2);
    expect(stepHighlight(-1, -1, 3)).toBe(2);
    expect(stepHighlight(0, 1, 0)).toBe(-1);
  });
});
