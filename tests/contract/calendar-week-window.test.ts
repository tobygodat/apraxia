import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";

import { buildCalendarWeekWindow, CalendarWeekRequestError } from "../../server/calendar/weekWindow";

function hoursBetween(start: string, end: string): number {
  return Number(Temporal.Instant.from(end).epochNanoseconds - Temporal.Instant.from(start).epochNanoseconds)
    / 3_600_000_000_000;
}

describe("Calendar civil-week window", () => {
  it("returns a complete Monday-Sunday range and exclusive next Monday", () => {
    expect(buildCalendarWeekWindow("2026-08-31", "America/New_York")).toEqual({
      range: { monday: "2026-08-31", sunday: "2026-09-06" },
      timezone: "America/New_York",
      timeMin: "2026-08-31T04:00:00Z",
      timeMax: "2026-09-07T04:00:00Z",
      endDateExclusive: "2026-09-07",
    });
  });

  it.each([
    ["2026-03-02", "America/New_York", "2026-03-02T05:00:00Z", "2026-03-09T04:00:00Z", 167],
    ["2026-10-26", "America/New_York", "2026-10-26T04:00:00Z", "2026-11-02T05:00:00Z", 169],
    ["2026-03-30", "Australia/Lord_Howe", "2026-03-29T13:00:00Z", "2026-04-05T13:30:00Z", 168.5],
    ["2026-09-28", "Australia/Lord_Howe", "2026-09-27T13:30:00Z", "2026-10-04T13:00:00Z", 167.5],
    ["2026-08-31", "Asia/Kathmandu", "2026-08-30T18:15:00Z", "2026-09-06T18:15:00Z", 168],
    ["2026-08-31", "Pacific/Chatham", "2026-08-30T11:15:00Z", "2026-09-06T11:15:00Z", 168],
    ["2026-08-31", "America/St_Johns", "2026-08-31T02:30:00Z", "2026-09-07T02:30:00Z", 168],
    ["2011-12-26", "Pacific/Apia", "2011-12-26T10:00:00Z", "2012-01-01T10:00:00Z", 144],
  ])("derives %s in %s from civil boundaries", (monday, zone, start, end, hours) => {
    const window = buildCalendarWeekWindow(monday, zone);
    expect(window.timeMin).toBe(start);
    expect(window.timeMax).toBe(end);
    expect(hoursBetween(window.timeMin, window.timeMax)).toBe(hours);
  });

  it("uses the first valid instant when Monday midnight is skipped", () => {
    const window = buildCalendarWeekWindow("1940-07-15", "Africa/Cairo");
    expect(window.timeMin).toBe("1940-07-14T22:00:00Z");
    expect(window.timeMax).toBe("1940-07-21T21:00:00Z");
    const localStart = Temporal.Instant.from(window.timeMin).toZonedDateTimeISO(window.timezone);
    expect(localStart.toPlainDate().toString()).toBe("1940-07-15");
    expect(localStart.hour).toBe(1);
    expect(hoursBetween(window.timeMin, window.timeMax)).toBe(167);
  });

  it("uses the earlier midnight when Monday repeats and retains historical offset seconds", () => {
    // IANA records Apia's 24-hour backward transition at 1892-07-05 local
    // midnight: Monday July 4 occurred twice, starting at offset +12:33:04.
    const window = buildCalendarWeekWindow("1892-07-04", "Pacific/Apia");
    expect(window.timeMin).toBe("1892-07-03T11:26:56Z");
    expect(window.timeMax).toBe("1892-07-11T11:26:56Z");
    expect(hoursBetween(window.timeMin, window.timeMax)).toBe(192);
    const repeatedMidnight = Temporal.Instant.from(window.timeMin).add({ hours: 24 })
      .toZonedDateTimeISO(window.timezone);
    expect(repeatedMidnight.toPlainDate().toString()).toBe(window.range.monday);
    expect(repeatedMidnight.hour).toBe(0);
  });

  it.each(["UTC", "Etc/UTC", "US/Eastern", "america/new_york", "Etc/GMT+12"])(
    "retains the safely validated named zone %s", (timezone) => {
      const window = buildCalendarWeekWindow("2026-08-31", timezone);
      expect(window.timezone).toBe(timezone);
      expect(window.timeMin).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(window.timeMax).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    },
  );

  it.each([
    ["2024-02-26", "2024-03-03", "2024-03-04"],
    ["2025-12-29", "2026-01-04", "2026-01-05"],
    ["0001-01-01", "0001-01-07", "0001-01-08"],
    ["9999-12-20", "9999-12-26", "9999-12-27"],
  ])("supports the civil-date boundary week %s", (monday, sunday, endDateExclusive) => {
    expect(buildCalendarWeekWindow(monday, "UTC")).toEqual({
      range: { monday, sunday }, timezone: "UTC", endDateExclusive,
      timeMin: `${monday}T00:00:00Z`, timeMax: `${endDateExclusive}T00:00:00Z`,
    });
  });

  it.each([
    undefined, null, 20260831, {}, [], new Date("2026-08-31T00:00:00Z"),
    "", "2026-8-31", "20260831", "2026-08-31\n", " 2026-08-31", "2026-08-31 ",
    "2026-08-31T00:00:00", "2026-08-31[UTC]", "2026-08-31[u-ca=hebrew]",
    "2026-09-01", "2026-02-30", "2025-02-29", "2026-00-01", "2026-13-01",
    "0000-01-03", "+010000-01-03", "10000-01-03", "-000001-01-01", "9999-12-27",
  ])("rejects malformed, non-Monday, or unrepresentable week input %#", (monday) => {
    expect(() => buildCalendarWeekWindow(monday, "UTC")).toThrow(CalendarWeekRequestError);
  });

  it.each([
    undefined, null, {}, [], 0, "", " ", "UTC\n", " UTC", "UTC ",
    "+05:30", "-04:00", "+0530", "+05", "Z", "2026-08-31T00:00:00+01:00[Europe/Paris]",
    "Not/A_Real_Zone", "America//New_York", "../America/New_York", "America/New_York?secret=value",
    "America/New_York\u0000", "A".repeat(256),
  ])("rejects unsupported timezone input %#", (timezone) => {
    expect(() => buildCalendarWeekWindow("2026-08-31", timezone)).toThrow(CalendarWeekRequestError);
  });

  it("rejects an otherwise valid civil boundary if its UTC instant is outside the supported years", () => {
    expect(() => buildCalendarWeekWindow("0001-01-01", "Asia/Kathmandu"))
      .toThrow(CalendarWeekRequestError);
  });

  it("never echoes untrusted input or underlying Temporal diagnostics", () => {
    for (const [monday, timezone] of [
      ["private-calendar-input", "UTC"], ["2026-08-31", "private-calendar-timezone"],
      ["2026-02-30", "UTC"],
    ]) {
      try {
        buildCalendarWeekWindow(monday, timezone);
        throw new Error("Expected request rejection.");
      } catch (error) {
        expect(error).toBeInstanceOf(CalendarWeekRequestError);
        expect((error as Error).name).toBe("CalendarWeekRequestError");
        expect((error as Error).message).toBe("Choose a valid Monday and named timezone.");
        expect((error as Error).cause).toBeUndefined();
        expect(String(error)).not.toContain("private-calendar");
      }
    }
  });
});
