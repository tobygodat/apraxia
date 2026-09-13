import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import { buildCalendarWeekWindow, CalendarWeekRequestError } from "../../server/calendar/weekWindow";

function hoursBetween(start: string, end: string): number {
  return Number(Temporal.Instant.from(end).epochNanoseconds - Temporal.Instant.from(start).epochNanoseconds)
    / 3_600_000_000_000;
}

describe("Calendar civil-week window", () => {
  it("returns a complete Sunday-Saturday range and exclusive next Sunday", () => {
    expect(buildCalendarWeekWindow("2026-08-30", "America/New_York")).toEqual({
      range: { sunday: "2026-08-30", saturday: "2026-09-05" },
      timezone: "America/New_York",
      timeMin: "2026-08-30T04:00:00Z",
      timeMax: "2026-09-06T04:00:00Z",
      endDateExclusive: "2026-09-06",
    });
  });

  it.each([
    ["2026-03-08", "America/New_York", "2026-03-08T05:00:00Z", "2026-03-15T04:00:00Z", 167],
    ["2026-11-01", "America/New_York", "2026-11-01T04:00:00Z", "2026-11-08T05:00:00Z", 169],
    ["2026-04-05", "Australia/Lord_Howe", "2026-04-04T13:00:00Z", "2026-04-11T13:30:00Z", 168.5],
    ["2026-10-04", "Australia/Lord_Howe", "2026-10-03T13:30:00Z", "2026-10-10T13:00:00Z", 167.5],
    ["2026-08-30", "Asia/Kathmandu", "2026-08-29T18:15:00Z", "2026-09-05T18:15:00Z", 168],
    ["2026-08-30", "Pacific/Chatham", "2026-08-29T11:15:00Z", "2026-09-05T11:15:00Z", 168],
    ["2026-08-30", "America/St_Johns", "2026-08-30T02:30:00Z", "2026-09-06T02:30:00Z", 168],
    ["2011-12-25", "Pacific/Apia", "2011-12-25T10:00:00Z", "2011-12-31T10:00:00Z", 144],
  ])("derives %s in %s from civil boundaries", (sunday, zone, start, end, hours) => {
    const window = buildCalendarWeekWindow(sunday, zone);
    expect(window.timeMin).toBe(start);
    expect(window.timeMax).toBe(end);
    expect(hoursBetween(window.timeMin, window.timeMax)).toBe(hours);
  });

  it("uses the first valid instant when Sunday midnight is skipped", () => {
    const window = buildCalendarWeekWindow("2018-11-04", "America/Sao_Paulo");
    expect(window.timeMin).toBe("2018-11-04T03:00:00Z");
    expect(window.timeMax).toBe("2018-11-11T02:00:00Z");
    const localStart = Temporal.Instant.from(window.timeMin).toZonedDateTimeISO(window.timezone);
    expect(localStart.toPlainDate().toString()).toBe("2018-11-04");
    expect(localStart.hour).toBe(1);
    expect(hoursBetween(window.timeMin, window.timeMax)).toBe(167);
  });

  it("uses the earlier midnight when Sunday midnight repeats", () => {
    const window = buildCalendarWeekWindow("2026-11-01", "America/Havana");
    expect(window.timeMin).toBe("2026-11-01T04:00:00Z");
    expect(window.timeMax).toBe("2026-11-08T05:00:00Z");
    expect(hoursBetween(window.timeMin, window.timeMax)).toBe(169);
    const repeatedMidnight = Temporal.Instant.from(window.timeMin).add({ hours: 1 })
      .toZonedDateTimeISO(window.timezone);
    expect(repeatedMidnight.toPlainDate().toString()).toBe(window.range.sunday);
    expect(repeatedMidnight.hour).toBe(0);
  });

  it.each(["UTC", "Etc/UTC", "US/Eastern", "america/new_york", "Etc/GMT+12"])(
    "retains the safely validated named zone %s", (timezone) => {
      const window = buildCalendarWeekWindow("2026-08-30", timezone);
      expect(window.timezone).toBe(timezone);
      expect(window.timeMin).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(window.timeMax).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    },
  );

  it.each([
    ["2024-02-25", "2024-03-02", "2024-03-03"],
    ["2025-12-28", "2026-01-03", "2026-01-04"],
    ["0001-01-07", "0001-01-13", "0001-01-14"],
    ["9999-12-19", "9999-12-25", "9999-12-26"],
  ])("supports the civil-date boundary week %s", (sunday, saturday, endDateExclusive) => {
    expect(buildCalendarWeekWindow(sunday, "UTC")).toEqual({
      range: { sunday, saturday }, timezone: "UTC", endDateExclusive,
      timeMin: `${sunday}T00:00:00Z`, timeMax: `${endDateExclusive}T00:00:00Z`,
    });
  });

  it.each([
    undefined, null, 20260831, {}, [], new Date("2026-08-31T00:00:00Z"),
    "", "2026-8-31", "20260831", "2026-08-31\n", " 2026-08-31", "2026-08-31 ",
    "2026-08-31T00:00:00", "2026-08-31[UTC]", "2026-08-31[u-ca=hebrew]",
    "2026-08-31", "2026-09-01", "2026-02-30", "2025-02-29", "2026-00-01", "2026-13-01",
    "0000-01-03", "+010000-01-03", "10000-01-03", "-000001-01-01", "9999-12-26",
  ])("rejects malformed, non-Sunday, or unrepresentable week input %#", (sunday) => {
    expect(() => buildCalendarWeekWindow(sunday, "UTC")).toThrow(CalendarWeekRequestError);
  });

  it.each([
    undefined, null, {}, [], 0, "", " ", "UTC\n", " UTC", "UTC ",
    "+05:30", "-04:00", "+0530", "+05", "Z", "2026-08-31T00:00:00+01:00[Europe/Paris]",
    "Not/A_Real_Zone", "America//New_York", "../America/New_York", "America/New_York?secret=value",
    "America/New_York\u0000", "A".repeat(256),
  ])("rejects unsupported timezone input %#", (timezone) => {
    expect(() => buildCalendarWeekWindow("2026-08-30", timezone)).toThrow(CalendarWeekRequestError);
  });

  it("rejects a Sunday whose exclusive end falls outside the supported years", () => {
    expect(() => buildCalendarWeekWindow("9999-12-26", "Asia/Kathmandu"))
      .toThrow(CalendarWeekRequestError);
  });

  it("never echoes untrusted input or underlying Temporal diagnostics", () => {
    for (const [sunday, timezone] of [
      ["private-calendar-input", "UTC"], ["2026-08-30", "private-calendar-timezone"],
      ["2026-02-30", "UTC"],
    ]) {
      try {
        buildCalendarWeekWindow(sunday, timezone);
        throw new Error("Expected request rejection.");
      } catch (error) {
        expect(error).toBeInstanceOf(CalendarWeekRequestError);
        expect((error as Error).name).toBe("CalendarWeekRequestError");
        expect((error as Error).message).toBe("Choose a valid Sunday and named timezone.");
        expect((error as Error).cause).toBeUndefined();
        expect(String(error)).not.toContain("private-calendar");
      }
    }
  });
});
