import { describe, expect, it, vi } from "vitest";

import type { VisibleCalendarMetadata } from "../../frontend/src/types/domain";
import { normalizeGoogleEvent } from "../../server/calendar/normalizeGoogleEvent";

const calendar: VisibleCalendarMetadata = {
  calendarId: "fictional-calendar@example.test",
  displayName: "Work",
  color: { background: "#426a7f", foreground: "#ffffff" },
  isVisible: true,
};
const link =
  "https://www.google.com/calendar/event?eid=ZmljdGlvbmFsIGV2ZW50&ctz=America%2FNew_York";
const invalid = { status: "invalid", code: "invalid_event" };

function timed(overrides: Record<string, unknown> = {}) {
  return {
    id: "series_instance_20260903T130000Z",
    status: "confirmed",
    summary: "Planning",
    htmlLink: link,
    start: { dateTime: "2026-09-03T09:00:00-04:00", timeZone: "America/New_York" },
    end: { dateTime: "2026-09-03T10:00:00-04:00", timeZone: "America/New_York" },
    ...overrides,
  };
}

function allDay(overrides: Record<string, unknown> = {}) {
  return timed({
    start: { date: "2026-09-03" },
    end: { date: "2026-09-06" },
    ...overrides,
  });
}

describe("Google event normalization", () => {
  it("includes a bounded plain-text location for event cards", () => {
    expect(normalizeGoogleEvent(timed({ location: "  Hall 204  " }), calendar)).toMatchObject({
      status: "event",
      event: { location: "Hall 204" },
    });
    const result = normalizeGoogleEvent(timed({ location: "x".repeat(5000) }), calendar);
    expect(result.status === "event" && result.event.location?.length).toBe(4096);
  });

  it.each([undefined, null, "", "  ", 4, { private: "unrelated-data" }])(
    "omits unusable optional location %j without dropping the event",
    (location) => {
      const result = normalizeGoogleEvent(timed({ location }), calendar);
      expect(result.status).toBe("event");
      expect(result.status === "event" && result.event.location).toBeUndefined();
    },
  );

  it("projects only the shared timed fields and trusted calendar identity/color", () => {
    expect(
      normalizeGoogleEvent(
        timed({
          calendarId: "untrusted-calendar",
          calendarColor: { background: "untrusted-color" },
          colorId: "9",
          iCalUID: "shared-series-ical-id",
          recurringEventId: "series-master-id",
          originalStartTime: { dateTime: "2026-09-03T08:00:00-04:00" },
          description: "private-description-canary",
          attendees: [{ email: "private-person@example.test" }],
          extendedProperties: { private: { access_token: "secret-token-canary" } },
        }),
        calendar,
      ),
    ).toEqual({
      status: "event",
      event: {
        eventId: "series_instance_20260903T130000Z",
        calendarId: calendar.calendarId,
        title: "Planning",
        calendarColor: calendar.color,
        googleEventUrl: link,
        kind: "timed",
        startAt: "2026-09-03T09:00:00-04:00",
        endAt: "2026-09-03T10:00:00-04:00",
        startTimeZone: "America/New_York",
        endTimeZone: "America/New_York",
      },
    });
  });

  it("keeps identical event IDs on different calendars distinct and calendar-colored", () => {
    const secondCalendar: VisibleCalendarMetadata = {
      ...calendar,
      calendarId: "other-calendar@example.test",
      color: { background: "#91495c", foreground: null },
    };
    const result = normalizeGoogleEvent(timed(), secondCalendar);
    expect(result).toMatchObject({
      status: "event",
      event: {
        eventId: timed().id,
        calendarId: secondCalendar.calendarId,
        calendarColor: secondCalendar.color,
      },
    });
  });

  it("keeps overlapping event instances as separate events with their original boundaries", () => {
    const first = normalizeGoogleEvent(timed(), calendar);
    const second = normalizeGoogleEvent(
      timed({
        id: "other_instance_20260903T133000Z",
        start: { dateTime: "2026-09-03T09:30:00-04:00" },
        end: { dateTime: "2026-09-03T10:30:00-04:00" },
      }),
      calendar,
    );
    expect(first).toMatchObject({
      status: "event",
      event: {
        eventId: timed().id,
        startAt: "2026-09-03T09:00:00-04:00",
        endAt: "2026-09-03T10:00:00-04:00",
      },
    });
    expect(second).toMatchObject({
      status: "event",
      event: {
        eventId: "other_instance_20260903T133000Z",
        startAt: "2026-09-03T09:30:00-04:00",
        endAt: "2026-09-03T10:30:00-04:00",
      },
    });
  });

  it.each([undefined, "", "   ", "\n\t"])("uses the title fallback for %j", (summary) => {
    expect(normalizeGoogleEvent(timed({ summary }), calendar)).toMatchObject({
      status: "event",
      event: { title: "(No title)" },
    });
  });

  it("preserves nonblank title text without reinterpreting markup", () => {
    expect(
      normalizeGoogleEvent(timed({ summary: "  <b>Planning</b> ☕  " }), calendar),
    ).toMatchObject({
      status: "event",
      event: { title: "  <b>Planning</b> ☕  " },
    });
  });

  it.each([undefined, "confirmed", "tentative"])("accepts Google status %j", (status) => {
    expect(normalizeGoogleEvent(timed({ status }), calendar).status).toBe("event");
  });

  it.each([
    { status: "cancelled" },
    { status: "cancelled", id: "deleted-instance", recurringEventId: "master" },
    { status: "cancelled", summary: 7, start: null, htmlLink: "javascript:alert(1)" },
  ])("skips even skeletal or malformed cancelled records", (raw) => {
    expect(normalizeGoogleEvent(raw, calendar)).toEqual({ status: "cancelled" });
  });

  it.each([undefined, null, true, 7, "event", [], [timed()]])(
    "rejects non-object event %j",
    (raw) => {
      expect(normalizeGoogleEvent(raw, calendar)).toEqual(invalid);
    },
  );

  it.each([
    { id: undefined },
    { id: null },
    { id: 1 },
    { id: "" },
    { id: " bad-id" },
    { id: "bad\nid" },
    { summary: null },
    { summary: 2 },
    { summary: {} },
    { status: "unknown" },
    { status: 4 },
    { status: null },
    { start: null },
    { start: [] },
    { end: null },
    { end: [] },
    { recurrence: ["RRULE:FREQ=WEEKLY"] },
    { recurrence: [] },
    { recurrence: null },
    { recurringEventId: 3 },
    { recurringEventId: "" },
  ])("rejects invalid fields or unexpanded recurrence masters: %j", (overrides) => {
    expect(normalizeGoogleEvent(timed(overrides), calendar)).toEqual(invalid);
  });

  it("does not substitute iCalUID or recurrence master for a missing instance id", () => {
    expect(
      normalizeGoogleEvent(
        timed({
          id: undefined,
          iCalUID: "shared-ical-id",
          recurringEventId: "master-id",
        }),
        calendar,
      ),
    ).toEqual(invalid);
  });

  it("does not mutate raw data, calendar metadata, or share mutable color objects", () => {
    const raw = timed();
    Object.freeze(raw.start);
    Object.freeze(raw.end);
    Object.freeze(raw);
    const metadata = Object.freeze({ ...calendar, color: Object.freeze({ ...calendar.color }) });
    const before = JSON.stringify({ raw, metadata });
    const result = normalizeGoogleEvent(raw, metadata);
    expect(result.status).toBe("event");
    expect(JSON.stringify({ raw, metadata })).toBe(before);
    if (result.status !== "event") throw new Error("Expected event");
    expect(result.event.calendarColor).not.toBe(metadata.color);
    result.event.calendarColor.background = "#000000";
    expect(metadata.color.background).toBe("#426a7f");
  });

  it("returns a fixed safe failure for parser errors without logging raw bodies", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const raw = timed({
        summary: "private-title-canary",
        description: "private-description-canary",
        start: { dateTime: "2026-02-30T09:00:00Z" },
      });
      expect(normalizeGoogleEvent(raw, calendar)).toEqual(invalid);
      expect(
        normalizeGoogleEvent(
          {
            get status() {
              throw new Error("secret-token-canary");
            },
          },
          calendar,
        ),
      ).toEqual(invalid);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe("all-day event boundaries", () => {
  it("preserves local dates and exclusive multi-day end without timestamps", () => {
    expect(normalizeGoogleEvent(allDay(), calendar)).toEqual({
      status: "event",
      event: {
        eventId: timed().id,
        calendarId: calendar.calendarId,
        title: "Planning",
        calendarColor: calendar.color,
        googleEventUrl: link,
        kind: "all_day",
        startDate: "2026-09-03",
        endDateExclusive: "2026-09-06",
      },
    });
  });

  it.each([
    ["2024-02-29", "2024-03-01"],
    ["2026-03-08", "2026-03-09"],
    ["2026-11-01", "2026-11-02"],
    ["2026-12-31", "2027-01-01"],
    ["0001-01-01", "0001-01-02"],
    ["9999-12-30", "9999-12-31"],
  ])("preserves valid date boundaries %s to %s", (start, end) => {
    expect(
      normalizeGoogleEvent(
        allDay({
          start: { date: start, timeZone: "America/New_York" },
          end: { date: end, timeZone: "Pacific/Auckland" },
        }),
        calendar,
      ),
    ).toMatchObject({
      status: "event",
      event: {
        kind: "all_day",
        startDate: start,
        endDateExclusive: end,
      },
    });
  });

  it.each([
    ["2026-09-03", "2026-09-03"],
    ["2026-09-03", "2026-09-02"],
    ["2026-02-29", "2026-03-01"],
    ["2026-04-31", "2026-05-02"],
    ["2026-09-03", "2026-09-31"],
    ["2026-13-01", "2027-01-01"],
    ["2026-9-03", "2026-09-04"],
    ["20260903", "2026-09-04"],
    ["2026-09-03Z", "2026-09-04"],
    ["2026-09-03T00:00:00Z", "2026-09-04"],
    ["2026-09-03[u-ca=iso8601]", "2026-09-04"],
    ["+002026-09-03", "2026-09-04"],
    [null, "2026-09-04"],
    [20260903, "2026-09-04"],
    ["0000-01-01", "0001-01-01"],
    ["0000-01-01", "0000-01-02"],
  ])("rejects invalid all-day boundaries %j to %j", (start, end) => {
    expect(
      normalizeGoogleEvent(allDay({ start: { date: start }, end: { date: end } }), calendar),
    ).toEqual(invalid);
  });

  it.each([
    { start: { date: "2026-09-03", dateTime: "2026-09-03T00:00:00Z" } },
    { end: { dateTime: "2026-09-06T00:00:00Z" } },
    { end: {} },
    { start: { date: "2026-09-03", timeZone: "Not/AZone" } },
    { end: { date: "2026-09-06", timeZone: null } },
  ])("rejects mixed or malformed all-day boundaries %j", (overrides) => {
    expect(normalizeGoogleEvent(allDay(overrides), calendar)).toEqual(invalid);
  });
});

describe("timed event boundaries", () => {
  it.each([
    ["2026-09-03T09:00:00Z", "2026-09-03T10:00:00Z"],
    ["2026-09-03t09:00:00z", "2026-09-03t10:00:00z"],
    ["2026-09-03T09:00:00.123456789+05:45", "2026-09-03T09:00:00.123456790+05:45"],
    ["2026-09-03T09:00:00.000001-03:30", "2026-09-03T10:00:00.000009-03:30"],
    ["2026-09-03T23:30:00+00:00", "2026-09-04T00:30:00+00:00"],
  ])("preserves explicit timestamp precision/offset %s", (start, end) => {
    expect(
      normalizeGoogleEvent(timed({ start: { dateTime: start }, end: { dateTime: end } }), calendar),
    ).toMatchObject({
      status: "event",
      event: {
        kind: "timed",
        startAt: start,
        endAt: end,
        startTimeZone: null,
        endTimeZone: null,
      },
    });
  });

  it("preserves explicit UTC instants with custom display zones", () => {
    expect(
      normalizeGoogleEvent(
        timed({
          start: { dateTime: "2026-09-03T13:00:00Z", timeZone: "US/Eastern" },
          end: { dateTime: "2026-09-03T14:00:00Z", timeZone: "Europe/London" },
        }),
        calendar,
      ),
    ).toMatchObject({
      status: "event",
      event: {
        startAt: "2026-09-03T13:00:00Z",
        endAt: "2026-09-03T14:00:00Z",
        startTimeZone: "US/Eastern",
        endTimeZone: "Europe/London",
      },
    });
  });

  it("orders instants, not clock strings, across a fall-back overlap", () => {
    expect(
      normalizeGoogleEvent(
        timed({
          start: { dateTime: "2026-11-01T01:45:00-04:00", timeZone: "America/New_York" },
          end: { dateTime: "2026-11-01T01:15:00-05:00", timeZone: "America/New_York" },
        }),
        calendar,
      ).status,
    ).toBe("event");
  });

  it.each([
    [
      "2026-09-03T09:00:00.123456000",
      "2026-09-03T10:00:00.123456001",
      "America/New_York",
      "-04:00",
    ],
    ["2026-01-03T09:00:00", "2026-01-03T10:00:00", "America/New_York", "-05:00"],
    ["2026-09-03T09:00:00", "2026-09-03T10:00:00", "Asia/Kathmandu", "+05:45"],
    ["2026-09-03T09:00:00", "2026-09-03T10:00:00", "UTC", "+00:00"],
  ])("resolves unambiguous zone-only timestamp in %s", (start, end, timeZone, offset) => {
    expect(
      normalizeGoogleEvent(
        timed({
          start: { dateTime: start, timeZone },
          end: { dateTime: end, timeZone },
        }),
        calendar,
      ),
    ).toMatchObject({
      status: "event",
      event: {
        startAt: `${start}${offset}`,
        endAt: `${end}${offset}`,
        startTimeZone: timeZone,
        endTimeZone: timeZone,
      },
    });
  });

  it("resolves each boundary independently across spring DST", () => {
    expect(
      normalizeGoogleEvent(
        timed({
          start: { dateTime: "2026-03-08T01:30:00", timeZone: "America/New_York" },
          end: { dateTime: "2026-03-08T03:30:00", timeZone: "America/New_York" },
        }),
        calendar,
      ),
    ).toMatchObject({
      status: "event",
      event: {
        startAt: "2026-03-08T01:30:00-05:00",
        endAt: "2026-03-08T03:30:00-04:00",
      },
    });
  });

  it.each([
    ["0001-01-01T00:00:00Z", "0001-01-01T01:00:00Z"],
    ["9999-12-31T22:00:00Z", "9999-12-31T23:00:00Z"],
  ])("accepts supported endpoint years without Date's 0–99 coercion", (start, end) => {
    expect(
      normalizeGoogleEvent(timed({ start: { dateTime: start }, end: { dateTime: end } }), calendar),
    ).toMatchObject({ status: "event", event: { startAt: start, endAt: end } });
  });

  it.each([
    ["0000-12-31T23:30:00Z", "0001-01-01T01:00:00Z"],
    ["0000-12-31T23:30:00-01:00", "0001-01-01T01:00:00Z"],
    ["0001-01-01T00:30:00+01:00", "0001-01-01T02:00:00+01:00"],
    ["9999-12-31T22:30:00-01:00", "9999-12-31T23:30:00-01:00"],
  ])("rejects local or resulting UTC instant years outside 0001–9999", (start, end) => {
    expect(
      normalizeGoogleEvent(timed({ start: { dateTime: start }, end: { dateTime: end } }), calendar),
    ).toEqual(invalid);
  });

  it.each([
    ["0000-12-31T23:30:00", "0001-01-01T01:00:00", "UTC"],
    ["0001-01-01T00:30:00", "0001-01-01T02:00:00", "Etc/GMT-1"],
    ["9999-12-31T22:30:00", "9999-12-31T23:30:00", "Etc/GMT+1"],
  ])(
    "rejects zone-only local or resolved UTC years outside the shared range",
    (start, end, timeZone) => {
      expect(
        normalizeGoogleEvent(
          timed({
            start: { dateTime: start, timeZone },
            end: { dateTime: end, timeZone },
          }),
          calendar,
        ),
      ).toEqual(invalid);
    },
  );

  it.each([
    ["2026-03-08T02:30:00", "2026-03-08T03:30:00"],
    ["2026-03-08T01:30:00", "2026-03-08T02:30:00"],
    ["2026-11-01T01:30:00", "2026-11-01T02:30:00"],
    ["2026-11-01T00:30:00", "2026-11-01T01:30:00"],
  ])("does not guess nonexistent/ambiguous zone-only boundaries %s", (start, end) => {
    expect(
      normalizeGoogleEvent(
        timed({
          start: { dateTime: start, timeZone: "America/New_York" },
          end: { dateTime: end, timeZone: "America/New_York" },
        }),
        calendar,
      ),
    ).toEqual(invalid);
  });

  it.each([
    ["2026-09-03T09:00:00Z", "2026-09-03T09:00:00Z"],
    ["2026-09-03T09:00:00-04:00", "2026-09-03T13:00:00Z"],
    ["2026-09-03T09:00:00-04:00", "2026-09-03T10:00:00Z"],
    ["2026-09-03T09:00:00.123456789Z", "2026-09-03T09:00:00.123456788Z"],
  ])("rejects zero or negative instant duration %s to %s", (start, end) => {
    expect(
      normalizeGoogleEvent(timed({ start: { dateTime: start }, end: { dateTime: end } }), calendar),
    ).toEqual(invalid);
  });

  it.each([
    "2026-02-30T09:00:00Z",
    "2026-09-03T24:00:00Z",
    "2026-09-03T09:60:00Z",
    "2026-09-03T09:00:60Z",
    "2026-09-03T09:00Z",
    "2026-09-03 09:00:00Z",
    "2026-09-03T09:00:00+0400",
    "2026-09-03T09:00:00+24:00",
    "2026-09-03T09:00:00+04:60",
    "2026-09-03T09:00:00+04:00:30",
    "2026-09-03T09:00:00.1234567890Z",
    "2026-09-03T09:00:00,123Z",
    "2026-09-03T09:00:00Z[UTC]",
    "2026-09-03T09:00:00Z[u-ca=iso8601]",
    "2026-9-03T09:00:00Z",
    "+002026-09-03T09:00:00Z",
    "2026-09-03",
    "2026-09-03T09:00:00",
    "2026-09-03T09:00:00Z ",
    null,
    5,
  ])("rejects malformed or offsetless/no-zone timestamp %j", (dateTime) => {
    expect(normalizeGoogleEvent(timed({ start: { dateTime } }), calendar)).toEqual(invalid);
  });

  it.each([
    null,
    4,
    "",
    "Not/AZone",
    "+05:30",
    "-04:00",
    "Z",
    "America/New_York ",
    "UTC][u-ca=iso8601",
  ])("rejects an invalid explicit IANA timezone %j even with a usable offset", (timeZone) => {
    expect(
      normalizeGoogleEvent(
        timed({
          start: { dateTime: "2026-09-03T09:00:00-04:00", timeZone },
        }),
        calendar,
      ),
    ).toEqual(invalid);
  });

  it("rejects an offsetless historical sub-minute zone rather than round its offset", () => {
    expect(
      normalizeGoogleEvent(
        timed({
          start: { dateTime: "1900-01-01T09:00:00", timeZone: "Europe/Paris" },
          end: { dateTime: "1900-01-01T10:00:00", timeZone: "Europe/Paris" },
        }),
        calendar,
      ),
    ).toEqual(invalid);
  });
});

describe("Google event navigation boundary", () => {
  it.each([
    link,
    "https://calendar.google.com/calendar/event?eid=opaque_id-123",
    "https://calendar.google.com/calendar/u/2/event?eid=opaque_id&authuser=2&hl=en",
    "https://calendar.google.com/calendar/r/eventedit/opaque_id-123",
    "https://calendar.google.com/calendar/u/0/r/eventedit/opaque_id-123?ctz=America%2FNew_York",
    "https://calendar.google.com/calendar/u/0/r/eventedit/opaque_id-123?pli=1",
  ])("preserves a returned trusted Google event URL exactly: %s", (htmlLink) => {
    expect(normalizeGoogleEvent(timed({ htmlLink }), calendar)).toMatchObject({
      status: "event",
      event: { googleEventUrl: htmlLink },
    });
  });

  it.each([
    undefined,
    null,
    5,
    "",
    "/calendar/event?eid=abc",
    "//calendar.google.com/calendar/event?eid=abc",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "http://calendar.google.com/calendar/event?eid=abc",
    "https://calendar.google.com.evil.example/calendar/event?eid=abc",
    "https://evil.example/calendar/event?eid=abc",
    "https://google.com/calendar/event?eid=abc",
    "https://accounts.google.com/calendar/event?eid=abc",
    "https://calendar.google.com@evil.example/calendar/event?eid=abc",
    "https://person:password@calendar.google.com/calendar/event?eid=abc",
    "https://calendar.google.com:444/calendar/event?eid=abc",
    "https://www.google.com/url?q=https://evil.example",
    "https://calendar.google.com/calendar/redirect?eid=abc",
    "https://calendar.google.com/calendar/render?action=TEMPLATE",
    "https://calendar.google.com/calendar/event?eid=abc&continue=https://evil.example",
    "https://calendar.google.com/calendar/event?eid=abc&redirect_uri=https://evil.example",
    "https://calendar.google.com/calendar/event?eid=abc&url=https://evil.example",
    "https://calendar.google.com/calendar/event?eid=abc&eid=def",
    "https://calendar.google.com/calendar/event?eid=abc#https://evil.example",
    "https://calendar.google.com/calendar/event",
    "https://calendar.google.com/calendar/event?eid=",
    "https://calendar.google.com/calendar/event?eid=%0Aabc",
    "https://calendar.google.com/calendar/event?eid=abc\n",
    "https://calendar.google.com\\calendar\\event?eid=abc",
    "https://calendar.google.com/calendar/event/extra?eid=abc",
  ])(
    "rejects unsafe, non-event, or missing returned links %j without fabricating a link",
    (htmlLink) => {
      expect(normalizeGoogleEvent(timed({ htmlLink }), calendar)).toEqual(invalid);
    },
  );
});
