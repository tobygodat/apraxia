import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarPreference } from "../../frontend/src/types/domain";
import {
  CALENDAR_LOAD_TIMEOUT_MS,
  CalendarProviderError,
  loadCalendarWeek,
  type FetchCalendarEventPage,
} from "../../server/calendar/loadCalendarWeek";

type Selection = Pick<CalendarPreference, "calendarId" | "displayName" | "color" | "isVisible"> & {
  readonly timeZone: string;
};
const SUNDAY = "2026-09-06";
const TIMEZONE = "America/New_York";
const PRIVATE_ERROR = "private upstream bearer token and event body";

function calendar(calendarId = "focus@example.test", extra: Partial<Selection> = {}): Selection {
  return {
    calendarId,
    displayName: `Calendar ${calendarId}`,
    color: { background: "#336699", foreground: "#ffffff" },
    isVisible: true,
    timeZone: TIMEZONE,
    ...extra,
  };
}

function timedEvent(eventId = "event1", extra: Record<string, unknown> = {}) {
  return {
    id: eventId,
    status: "confirmed",
    summary: `Event ${eventId}`,
    htmlLink: "https://www.google.com/calendar/event?eid=ZXZlbnQx",
    start: { dateTime: "2026-09-07T09:00:00-04:00", timeZone: TIMEZONE },
    end: { dateTime: "2026-09-07T10:00:00-04:00", timeZone: TIMEZONE },
    ...extra,
  };
}

function input(calendars: readonly Selection[] = [calendar()]) {
  return { sunday: SUNDAY, timezone: TIMEZONE, calendars };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fetcher(implementation: FetchCalendarEventPage = async () => ({ items: [] })) {
  return vi.fn<FetchCalendarEventPage>(implementation);
}

function options() {
  return { signal: new AbortController().signal };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Calendar week loader request boundary", () => {
  it("requests only the selected local Sunday-Saturday window and read-only event fields", async () => {
    const fetch = fetcher(async () => ({ items: [timedEvent()] }));
    const result = await loadCalendarWeek(input(), fetch, options());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [request, requestOptions] = fetch.mock.calls[0]!;
    expect(request).toMatchObject({
      calendarId: "focus@example.test",
      timeZone: TIMEZONE,
      maxResults: 250,
      singleEvents: true,
      showDeleted: false,
      orderBy: "startTime",
      fields: expect.any(String),
    });
    expect(new Date(request.timeMin).toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(new Date(request.timeMax).toISOString()).toBe("2026-09-13T04:00:00.000Z");
    expect(Object.keys(request).sort()).toEqual(
      [
        "calendarId",
        "fields",
        "maxResults",
        "orderBy",
        "showDeleted",
        "singleEvents",
        "timeMax",
        "timeMin",
        "timeZone",
      ].sort(),
    );
    expect(request.fields).toContain("nextPageToken");
    for (const field of ["items", "id", "summary", "htmlLink", "start", "end", "status"]) {
      expect(request.fields).toContain(field);
    }
    expect(request.fields).not.toMatch(/description|attendees|attachments|access_token|user_id/i);
    expect(requestOptions).toEqual({ signal: expect.any(AbortSignal) });
    expect(result.range).toEqual({ sunday: SUNDAY, saturday: "2026-09-12" });
    expect(result.timezone).toBe(TIMEZONE);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      eventId: "event1",
      calendarId: "focus@example.test",
      kind: "timed",
      startAt: "2026-09-07T09:00:00-04:00",
      endAt: "2026-09-07T10:00:00-04:00",
    });
    expect(result.partialErrors).toEqual([]);
  });

  it("performs no fetches for an empty or all-hidden selection", async () => {
    const fetch = fetcher();
    for (const calendars of [[], [calendar("hidden@example.test", { isVisible: false })]]) {
      const result = await loadCalendarWeek(input(calendars), fetch, options());
      expect(result.events).toEqual([]);
      expect(result.visibleCalendars).toEqual([]);
      expect(result.partialErrors).toEqual([]);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("projects visible metadata without owner or private extra fields and without retaining mutable colors", async () => {
    const selected = {
      ...calendar(),
      user_id: "private-owner",
      accessToken: "private-token",
      color: { background: "#336699", foreground: "#ffffff", privateColor: "private-color" },
    };
    const fetch = fetcher(async () => ({ items: [timedEvent()] }));
    const result = await loadCalendarWeek(
      input([selected, calendar("hidden@example.test", { isVisible: false })]),
      fetch,
      options(),
    );
    expect(result.visibleCalendars).toEqual([
      {
        calendarId: "focus@example.test",
        displayName: "Calendar focus@example.test",
        color: { background: "#336699", foreground: "#ffffff" },
        isVisible: true,
      },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(
      /private-owner|private-token|private-color|user_id|accessToken/,
    );
    selected.color.background = "#000000";
    expect(result.visibleCalendars[0]?.color.background).toBe("#336699");
    expect(result.events[0]?.calendarColor.background).toBe("#336699");
  });

  it.each([
    { sunday: "2026-09-07" },
    { sunday: "2026-02-30" },
    { sunday: null },
    { timezone: "Not/A_Timezone" },
    { timezone: null },
  ])("rejects an invalid week request before fetching: %j", async (invalid) => {
    const fetch = fetcher();
    await expect(
      loadCalendarWeek({ ...input(), ...invalid }, fetch, options()),
    ).rejects.toMatchObject({
      name: "CalendarWeekRequestError",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { calendarId: "" },
    { calendarId: " " },
    { calendarId: null },
    { displayName: "" },
    { displayName: null },
    { isVisible: "yes" },
    { color: null },
    { color: { background: "url(private)", foreground: "#ffffff" } },
    { color: { background: "#336699" } },
  ])("rejects invalid selection fields before any calendar starts: %j", async (invalid) => {
    const fetch = fetcher();
    const selection = { ...calendar("invalid@example.test"), ...invalid } as Selection;
    await expect(
      loadCalendarWeek(input([calendar(), selection]), fetch, options()),
    ).rejects.toMatchObject({
      name: "CalendarWeekRequestError",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects duplicate calendar selections including a hidden duplicate", async () => {
    const fetch = fetcher();
    await expect(
      loadCalendarWeek(
        input([calendar(), calendar(undefined, { isVisible: false })]),
        fetch,
        options(),
      ),
    ).rejects.toMatchObject({ name: "CalendarWeekRequestError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "Not/A_Timezone"])(
    "isolates a missing or invalid source timezone without fetching that calendar: %s",
    async (timeZone) => {
      const bad = { ...calendar("bad-zone@example.test"), timeZone } as unknown as Selection;
      const fetch = fetcher(async () => ({ items: [timedEvent()] }));
      const result = await loadCalendarWeek(input([bad, calendar()]), fetch, options());
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]![0].calendarId).toBe("focus@example.test");
      expect(result.events.map((event) => event.calendarId)).toEqual(["focus@example.test"]);
      expect(result.partialErrors).toEqual([
        expect.objectContaining({
          calendarId: "bad-zone@example.test",
          code: "calendar_unavailable",
          retryable: true,
        }),
      ]);
    },
  );

  it("does not require source timezone metadata for a hidden calendar", async () => {
    const hidden = {
      ...calendar("hidden@example.test", { isVisible: false }),
      timeZone: undefined,
    } as unknown as Selection;
    const fetch = fetcher();
    const result = await loadCalendarWeek(input([hidden]), fetch, options());
    expect(result.visibleCalendars).toEqual([]);
    expect(result.partialErrors).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    {
      profileZone: "Etc/GMT+12",
      sourceZone: "Pacific/Kiritimati",
      paddingStart: "2026-09-06T01:00:00+14:00",
      paddingEnd: "2026-09-06T02:00:00+14:00",
    },
    {
      profileZone: "Pacific/Kiritimati",
      sourceZone: "Etc/GMT+12",
      paddingStart: "2026-09-12T22:00:00-12:00",
      paddingEnd: "2026-09-12T23:00:00-12:00",
    },
  ])(
    "covers both calendar weeks across the date line but filters timed padding: $profileZone / $sourceZone",
    async ({ profileZone, sourceZone, paddingStart, paddingEnd }) => {
      const fetch = fetcher(async () => ({
        items: [
          timedEvent("event1", { start: { date: "2026-09-06" }, end: { date: "2026-09-07" } }),
          timedEvent("event2", { start: { date: "2026-09-12" }, end: { date: "2026-09-13" } }),
          timedEvent("event3", {
            start: { dateTime: paddingStart, timeZone: sourceZone },
            end: { dateTime: paddingEnd, timeZone: sourceZone },
          }),
        ],
      }));
      const result = await loadCalendarWeek(
        {
          ...input([calendar(undefined, { timeZone: sourceZone })]),
          timezone: profileZone,
        },
        fetch,
        options(),
      );
      const request = fetch.mock.calls[0]![0];
      expect(new Date(request.timeMin).toISOString()).toBe("2026-09-05T10:00:00.000Z");
      expect(new Date(request.timeMax).toISOString()).toBe("2026-09-13T12:00:00.000Z");
      expect(request.timeZone).toBe(profileZone);
      expect(result.events.map((event) => event.eventId)).toEqual(["event1", "event2"]);
      expect(result.events).toEqual([
        expect.objectContaining({
          kind: "all_day",
          startDate: "2026-09-06",
          endDateExclusive: "2026-09-07",
        }),
        expect.objectContaining({
          kind: "all_day",
          startDate: "2026-09-12",
          endDateExclusive: "2026-09-13",
        }),
      ]);
      expect(result.partialErrors).toEqual([]);
    },
  );
});

describe("Calendar week loader paging and isolation", () => {
  it("uses both zones across different DST schedules and preserves boundary-spanning events", async () => {
    const fetch = fetcher(async () => ({
      items: [
        timedEvent("spanning", { start: { date: "2026-03-21" }, end: { date: "2026-03-23" } }),
        timedEvent("nextweek", { start: { date: "2026-03-29" }, end: { date: "2026-03-30" } }),
        timedEvent("endsatstart", {
          start: { dateTime: "2026-03-22T03:00:00Z" },
          end: { dateTime: "2026-03-22T04:00:00Z" },
        }),
        timedEvent("overlap", {
          start: { dateTime: "2026-03-22T03:59:00Z" },
          end: { dateTime: "2026-03-22T04:01:00Z" },
        }),
        timedEvent("startsatend", {
          start: { dateTime: "2026-03-29T04:00:00Z" },
          end: { dateTime: "2026-03-29T05:00:00Z" },
        }),
      ],
    }));
    const result = await loadCalendarWeek(
      {
        sunday: "2026-03-22",
        timezone: "America/New_York",
        calendars: [calendar(undefined, { timeZone: "Europe/London" })],
      },
      fetch,
      options(),
    );
    expect(fetch.mock.calls[0]![0]).toMatchObject({
      timeMin: "2026-03-22T00:00:00Z",
      timeMax: "2026-03-29T04:00:00Z",
    });
    expect(result.events.map((event) => event.eventId)).toEqual(["spanning", "overlap"]);
    expect(result.events[0]).toMatchObject({
      startDate: "2026-03-21",
      endDateExclusive: "2026-03-23",
    });
    expect(result.partialErrors).toEqual([]);
  });

  it("follows sequential opaque page tokens, including empty pages with a next token", async () => {
    const fetch = fetcher()
      .mockResolvedValueOnce({ nextPageToken: "opaque/+=:page-2" })
      .mockResolvedValueOnce({ items: [], nextPageToken: "opaque/+=:page-3" })
      .mockResolvedValueOnce({ items: [timedEvent()] });
    const result = await loadCalendarWeek(input(), fetch, options());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([request]) => request.pageToken)).toEqual([
      undefined,
      "opaque/+=:page-2",
      "opaque/+=:page-3",
    ]);
    expect(result.events.map((event) => event.eventId)).toEqual(["event1"]);
    expect(result.partialErrors).toEqual([]);
  });

  it("retains normal and all-day events from every successful page", async () => {
    const fetch = fetcher()
      .mockResolvedValueOnce({ items: [timedEvent("event1")], nextPageToken: "next" })
      .mockResolvedValueOnce({
        items: [
          timedEvent("event2", {
            start: { date: "2026-09-08" },
            end: { date: "2026-09-10" },
          }),
        ],
      });
    const result = await loadCalendarWeek(input(), fetch, options());
    expect(result.events).toHaveLength(2);
    expect(result.events[1]).toMatchObject({
      kind: "all_day",
      startDate: "2026-09-08",
      endDateExclusive: "2026-09-10",
    });
    expect(result.partialErrors).toEqual([]);
  });

  it("bounds concurrent calendars to three while each calendar pages sequentially", async () => {
    const calendars = Array.from({ length: 5 }, (_, index) =>
      calendar(`calendar${index}@example.test`),
    );
    const pending: Array<{ calendarId: string; page: ReturnType<typeof deferred<unknown>> }> = [];
    const activeCalendars = new Set<string>();
    let peak = 0;
    let sameCalendarOverlap = false;
    const fetch = fetcher((request) => {
      if (activeCalendars.has(request.calendarId)) sameCalendarOverlap = true;
      activeCalendars.add(request.calendarId);
      peak = Math.max(peak, activeCalendars.size);
      const page = deferred<unknown>();
      pending.push({ calendarId: request.calendarId, page });
      return page.promise.finally(() => activeCalendars.delete(request.calendarId));
    });
    const loading = loadCalendarWeek(input(calendars), fetch, options());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    pending[0]!.page.resolve({ items: [], nextPageToken: "second" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(pending[3]!.calendarId).toBe(pending[0]!.calendarId);
    pending[3]!.page.resolve({ items: [] });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
    pending[1]!.page.resolve({ items: [] });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
    for (const index of [2, 4, 5]) pending[index]!.page.resolve({ items: [] });
    const result = await loading;
    expect(peak).toBe(3);
    expect(sameCalendarOverlap).toBe(false);
    expect(result.partialErrors).toEqual([]);
  });

  it("allows identical event IDs in separate calendars", async () => {
    const calendars = [calendar("one@example.test"), calendar("two@example.test")];
    const fetch = fetcher(async () => ({ items: [timedEvent("event1")] }));
    const result = await loadCalendarWeek(input(calendars), fetch, options());
    expect(result.events.map((event) => [event.calendarId, event.eventId])).toEqual([
      ["one@example.test", "event1"],
      ["two@example.test", "event1"],
    ]);
    expect(result.partialErrors).toEqual([]);
  });

  it.each([
    null,
    [],
    "private page content",
    { items: null },
    { items: {} },
    { items: new Array(1) },
    { items: Array.from({ length: 251 }, (_, index) => timedEvent(`event${index}`)) },
    { items: [], nextPageToken: "" },
    { items: [], nextPageToken: null },
    { items: [], nextPageToken: 42 },
  ])("discards only a calendar with a malformed page: %j", async (badPage) => {
    const fetch = fetcher(async (request) => {
      if (request.calendarId === "good@example.test") return { items: [timedEvent("event2")] };
      return request.pageToken ? badPage : { items: [timedEvent("event1")], nextPageToken: "next" };
    });
    const result = await loadCalendarWeek(
      input([calendar(), calendar("good@example.test")]),
      fetch,
      options(),
    );
    expect(result.events.map((event) => event.eventId)).toEqual(["event2"]);
    expect(result.partialErrors).toEqual([
      expect.objectContaining({
        calendarId: "focus@example.test",
        code: "calendar_incomplete",
        retryable: true,
        userMessage: expect.any(String),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("private page content");
    expect(result.visibleCalendars).toHaveLength(2);
  });

  it("detects repeated pagination tokens before fetching an already requested page", async () => {
    const fetch = fetcher()
      .mockResolvedValueOnce({ items: [timedEvent("event1")], nextPageToken: "first" })
      .mockResolvedValueOnce({ items: [timedEvent("event2")], nextPageToken: "second" })
      .mockResolvedValueOnce({ items: [timedEvent("event3")], nextPageToken: "first" });
    const result = await loadCalendarWeek(input(), fetch, options());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.events).toEqual([]);
    expect(result.partialErrors).toEqual([
      expect.objectContaining({ code: "calendar_incomplete" }),
    ]);
  });

  it.each([false, true])(
    "rejects duplicate instance IDs within or across pages (across=%s)",
    async (acrossPages) => {
      const fetch = fetcher();
      if (acrossPages) {
        fetch
          .mockResolvedValueOnce({ items: [timedEvent()], nextPageToken: "next" })
          .mockResolvedValueOnce({ items: [timedEvent()] });
      } else fetch.mockResolvedValueOnce({ items: [timedEvent(), timedEvent()] });
      const result = await loadCalendarWeek(input(), fetch, options());
      expect(result.events).toEqual([]);
      expect(result.partialErrors).toEqual([
        expect.objectContaining({ code: "calendar_incomplete" }),
      ]);
    },
  );

  it.each([false, true])(
    "rejects contradictory live/cancelled duplicate instances (cancelledFirst=%s)",
    async (cancelledFirst) => {
      const cancelled = { id: "event1", status: "cancelled" };
      const first = cancelledFirst ? cancelled : timedEvent();
      const second = cancelledFirst ? timedEvent() : cancelled;
      const fetch = fetcher()
        .mockResolvedValueOnce({ items: [first], nextPageToken: "next" })
        .mockResolvedValueOnce({ items: [second] });
      const result = await loadCalendarWeek(input(), fetch, options());
      expect(result.events).toEqual([]);
      expect(result.partialErrors).toEqual([
        expect.objectContaining({ code: "calendar_incomplete" }),
      ]);
    },
  );

  it("accepts exactly 100 complete pages", async () => {
    const fetch = fetcher(async (request) => {
      const pageNumber = request.pageToken === undefined ? 1 : Number(request.pageToken);
      return {
        items: [timedEvent(`event${pageNumber}`)],
        ...(pageNumber < 100 ? { nextPageToken: String(pageNumber + 1) } : {}),
      };
    });
    const result = await loadCalendarWeek(input(), fetch, options());
    expect(fetch).toHaveBeenCalledTimes(100);
    expect(result.events).toHaveLength(100);
    expect(result.partialErrors).toEqual([]);
  });

  it("reports page-budget exhaustion rather than presenting a truncated calendar as complete", async () => {
    const fetch = fetcher(async (request) => {
      if (request.calendarId === "good@example.test") return { items: [timedEvent("event1")] };
      const pageNumber = request.pageToken === undefined ? 1 : Number(request.pageToken);
      return { items: [timedEvent(`event${pageNumber}`)], nextPageToken: String(pageNumber + 1) };
    });
    const result = await loadCalendarWeek(
      input([calendar(), calendar("good@example.test")]),
      fetch,
      options(),
    );
    expect(
      fetch.mock.calls.filter(([request]) => request.calendarId === "focus@example.test"),
    ).toHaveLength(100);
    expect(result.events.map((event) => event.calendarId)).toEqual(["good@example.test"]);
    expect(result.partialErrors).toEqual([
      expect.objectContaining({
        calendarId: "focus@example.test",
        code: "calendar_incomplete",
        retryable: true,
      }),
    ]);
  });
});

describe("Calendar week loader partial errors", () => {
  it("skips invalid individual events, reports a safe warning, and silently skips cancellation", async () => {
    const fetch = fetcher(async () => ({
      items: [
        timedEvent("event1"),
        timedEvent("event2", { htmlLink: "javascript:privateEventBody()" }),
        { id: "event3", status: "cancelled" },
      ],
    }));
    const result = await loadCalendarWeek(input(), fetch, options());
    expect(result.events.map((event) => event.eventId)).toEqual(["event1"]);
    expect(result.partialErrors).toEqual([
      expect.objectContaining({
        calendarId: "focus@example.test",
        code: "calendar_invalid_events",
        userMessage: expect.any(String),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("privateEventBody");
  });

  it("does not label normal cancelled entries as invalid events", async () => {
    const result = await loadCalendarWeek(
      input(),
      fetcher(async () => ({
        items: [{ id: "event1", status: "cancelled" }],
      })),
      options(),
    );
    expect(result.events).toEqual([]);
    expect(result.partialErrors).toEqual([]);
  });

  it("retains successful calendars and sanitizes unknown provider failures", async () => {
    const fetch = fetcher(async (request) => {
      if (request.calendarId === "bad@example.test") throw new Error(PRIVATE_ERROR);
      return { items: [timedEvent()] };
    });
    const result = await loadCalendarWeek(
      input([calendar(), calendar("bad@example.test")]),
      fetch,
      options(),
    );
    expect(result.events.map((event) => event.calendarId)).toEqual(["focus@example.test"]);
    expect(result.partialErrors).toEqual([
      expect.objectContaining({
        calendarId: "bad@example.test",
        calendarDisplayName: "Calendar bad@example.test",
        code: "calendar_unavailable",
        retryable: true,
        userMessage: expect.any(String),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_ERROR);
  });

  it.each([
    ["reconnect_required", false],
    ["calendar_unavailable", true],
  ] as const)("maps typed %s errors without leaking exception details", async (code, retryable) => {
    const error = new CalendarProviderError(code);
    error.message = PRIVATE_ERROR;
    const result = await loadCalendarWeek(
      input(),
      fetcher(async () => {
        throw error;
      }),
      options(),
    );
    expect(result.events).toEqual([]);
    expect(result.partialErrors).toEqual([expect.objectContaining({ code, retryable })]);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_ERROR);
  });

  it("does not mistake an upstream AbortError for caller cancellation", async () => {
    const result = await loadCalendarWeek(
      input(),
      fetcher(async () => {
        throw new DOMException(PRIVATE_ERROR, "AbortError");
      }),
      options(),
    );
    expect(result.partialErrors).toEqual([
      expect.objectContaining({ code: "calendar_unavailable" }),
    ]);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_ERROR);
  });
});

describe("Calendar week loader cancellation and deadline", () => {
  it("rejects an already-aborted caller without starting a provider request", async () => {
    const abort = new AbortController();
    abort.abort(new Error(PRIVATE_ERROR));
    const fetch = fetcher();
    const result = loadCalendarWeek(input(), fetch, { signal: abort.signal });
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    await expect(result).rejects.not.toThrow(PRIVATE_ERROR);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects promptly during ignored cancellation and never returns false partial success", async () => {
    const abort = new AbortController();
    const stalled = deferred<unknown>();
    const fetch = fetcher(async (request) =>
      request.calendarId === "good@example.test" ? { items: [timedEvent()] } : stalled.promise,
    );
    const loading = loadCalendarWeek(input([calendar("good@example.test"), calendar()]), fetch, {
      signal: abort.signal,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    abort.abort(new Error(PRIVATE_ERROR));
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    await expect(loading).rejects.not.toThrow(PRIVATE_ERROR);
    expect(fetch.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
    stalled.resolve({ items: [timedEvent("event2")], nextPageToken: "must-not-fetch" });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the whole-load deadline to retain finished calendars and explicitly mark unfinished or queued calendars", async () => {
    vi.useFakeTimers();
    expect(CALENDAR_LOAD_TIMEOUT_MS).toBe(20_000);
    const pending = deferred<unknown>();
    const calendars = [
      calendar("good@example.test"),
      ...Array.from({ length: 4 }, (_, index) => calendar(`slow${index}@example.test`)),
    ];
    const fetch = fetcher(async (request) =>
      request.calendarId === "good@example.test" ? { items: [timedEvent()] } : pending.promise,
    );
    const loading = loadCalendarWeek(input(calendars), fetch, options());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(CALENDAR_LOAD_TIMEOUT_MS);
    const result = await loading;
    expect(result.events.map((event) => event.calendarId)).toEqual(["good@example.test"]);
    expect(result.partialErrors).toHaveLength(4);
    expect(
      result.partialErrors.every((error) => error.code === "calendar_timeout" && error.retryable),
    ).toBe(true);
    expect(new Set(result.partialErrors.map((error) => error.calendarId))).toEqual(
      new Set(calendars.slice(1).map((selection) => selection.calendarId)),
    );
    expect(fetch.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
    pending.resolve({ items: [], nextPageToken: "must-not-fetch" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up the deadline timer after a successful load", async () => {
    vi.useFakeTimers();
    const result = await loadCalendarWeek(input(), fetcher(), options());
    expect(result.partialErrors).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
