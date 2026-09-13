import { describe, expect, it } from "vitest";
import type { TimedCalendarEvent } from "../../types/domain";
import { layoutAllDayEvents, layoutTimedEvents, weekDates, startOfWeekSunday } from "./eventLayout";
const event = (id: string, startAt: string, endAt: string): TimedCalendarEvent => ({ kind: "timed", calendarId: "primary", eventId: id, title: id, calendarColor: { background: null, foreground: null }, googleEventUrl: "https://calendar.google.com", startAt, endAt, startTimeZone: null, endTimeZone: null });
describe("calendar layout", () => {
  it.each([
    ["2026-09-13", "2026-09-13"],
    ["2026-09-14", "2026-09-13"],
    ["2026-09-19", "2026-09-13"],
    ["2026-09-01", "2026-08-30"],
    ["2026-01-01", "2025-12-28"],
  ])("starts the week containing %s on Sunday %s", (date, sunday) => {
    expect(startOfWeekSunday(date)).toBe(sunday);
  });

  it("keeps short events readable without painting over the next event", () => {
    const events = [event("short", "2026-09-07T09:00:00Z", "2026-09-07T09:15:00Z"), event("next", "2026-09-07T09:15:00Z", "2026-09-07T09:30:00Z")];
    const result = layoutTimedEvents(events, "2026-09-07", "UTC");
    expect(result.map(({ start, end, column, columns }) => [start, end, column, columns])).toEqual([[540, 570, 0, 2], [555, 585, 1, 2]]);
    expect(result[0].event.endAt).toBe("2026-09-07T09:15:00Z");
  });

  it("spans all-day events once, clips the week and reuses lanes at exclusive ends", () => {
    const allDay = (id: string, startDate: string, endDateExclusive: string) => ({
      kind: "all_day" as const, calendarId: "primary", eventId: id, title: id,
      calendarColor: { background: null, foreground: null }, googleEventUrl: "https://calendar.google.com",
      startDate, endDateExclusive,
    });
    const events = [allDay("before", "2026-08-30", "2026-09-03"), allDay("overlap", "2026-09-01", "2026-09-02"), allDay("after", "2026-09-03", "2026-09-09")];
    const result = layoutAllDayEvents(events, "2026-08-30");
    expect(result.map(({ event, startColumn, endColumn, lane }) => [event.eventId, startColumn, endColumn, lane])).toEqual([
      ["before", 0, 4, 0], ["overlap", 2, 3, 1], ["after", 4, 7, 0],
    ]);
    expect(layoutAllDayEvents([...events].reverse(), "2026-08-30")).toEqual(result);
  });
  it("uses Sunday–Saturday dates across month boundaries", () => {
    expect(weekDates("2026-08-30")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"]);
  });
  it("splits overnight events and excludes the exclusive end day", () => {
    const result = layoutTimedEvents([event("night", "2026-09-01T23:00:00-04:00", "2026-09-03T00:00:00-04:00")], "2026-08-30", "America/New_York");
    expect(result.map(({ day, start, end }) => ({ day, start, end }))).toEqual([{ day: "2026-09-01", start: 1380, end: 1440 }, { day: "2026-09-02", start: 0, end: 1440 }]);
  });
  it("assigns overlapping events to separate lanes, reusing space after the group", () => {
    const result = layoutTimedEvents([event("a", "2026-09-01T09:00:00Z", "2026-09-01T10:00:00Z"), event("b", "2026-09-01T09:30:00Z", "2026-09-01T11:00:00Z"), event("c", "2026-09-01T11:00:00Z", "2026-09-01T12:00:00Z")], "2026-08-30", "UTC");
    expect(result.map(({ column, columns }) => [column, columns])).toEqual([[0, 2], [1, 2], [0, 1]]);
  });
  it("clips a DST transition by the local day rather than assuming 24 elapsed hours", () => {
    const result = layoutTimedEvents([event("dst", "2026-03-08T01:30:00-05:00", "2026-03-08T03:30:00-04:00")], "2026-03-08", "America/New_York");
    expect(result[0]).toMatchObject({ day: "2026-03-08", start: 90, end: 210 });
  });
});
