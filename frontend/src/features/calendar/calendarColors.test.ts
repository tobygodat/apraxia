import { describe, expect, it } from "vitest";
import { calendarAccent, calendarEventStyle } from "./calendarColors";

describe("calendar colors", () => {
  it("keeps valid Google calendar colors and expands short hex colors", () => {
    expect(calendarAccent("personal", { background: " #A4BDFC ", foreground: null })).toBe("#a4bdfc");
    expect(calendarAccent("work", { background: "#AbC", foreground: null })).toBe("#aabbcc");
  });

  it("uses a stable usable color when metadata is missing or malformed", () => {
    const fallback = calendarAccent("personal", { background: null, foreground: null });
    expect(fallback).toMatch(/^#[\da-f]{6}$/);
    for (const background of ["", "transparent", "var(--private)", "#nope", "url(https://example.com)"]) {
      expect(calendarAccent("personal", { background, foreground: null })).toBe(fallback);
    }
  });

  it("preserves exact fills and readable text, including hover", () => {
    const luminance = (hex: string) => {
      const linear = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
    };
    for (const background of ["#ffffff", "#ffff00", "#000000", "#a4bdfc", "#ff3333"]) {
      const style = calendarEventStyle("calendar", { background, foreground: "#000000" }) as Record<string, string>;
      for (const key of ["--calendar-event-bg", "--calendar-event-hover"]) {
        expect(style[key]).toBe(background);
        const pair = [luminance(style["--calendar-event-text"]), luminance(style[key])].sort((a, b) => a - b);
        expect((pair[1] + .05) / (pair[0] + .05)).toBeGreaterThan(4.5);
      }
      expect(style["--calendar-event-color"]).toBe(background);
    }
  });
});
