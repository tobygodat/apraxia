import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_EVENT_FIELDS,
  CALENDAR_PAGE_SIZE,
  CalendarProviderError,
  loadCalendarWeek,
  type CalendarEventPageRequest,
} from "../../server/calendar/loadCalendarWeek";
import {
  createGoogleCalendarReadTransport,
  GOOGLE_CALENDAR_LIST_FIELDS,
  GOOGLE_CALENDAR_LIST_MAX_PAGES,
  GOOGLE_CALENDAR_LIST_TIMEOUT_MS,
  GOOGLE_CALENDAR_MAX_BODY_BYTES,
  GOOGLE_CALENDAR_MAX_HEADER_BYTES,
  GOOGLE_CALENDAR_MAX_PAGE_TOKEN_LENGTH,
  GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS,
} from "../../server/calendar/googleCalendarTransport";

import { normalizeGoogleEvent } from "../../server/calendar/normalizeGoogleEvent";

const TOKEN = "fake_request_local_access_token";
const PRIVATE = "private provider description or credential";
const ZONE = "America/New_York";

function request(extra: Partial<CalendarEventPageRequest> = {}): CalendarEventPageRequest {
  return {
    calendarId: "team@example.test",
    timeMin: "2026-09-07T04:00:00Z",
    timeMax: "2026-09-14T04:00:00Z",
    timeZone: ZONE,
    maxResults: CALENDAR_PAGE_SIZE,
    singleEvents: true,
    showDeleted: false,
    orderBy: "startTime",
    fields: CALENDAR_EVENT_FIELDS,
    ...extra,
  };
}

function response(
  value: unknown = { items: [] },
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeFetch(implementation: typeof fetch = async () => response()) {
  return vi.fn<typeof fetch>(implementation);
}

function options() {
  return { signal: new AbortController().signal };
}

function transport(fetch: typeof globalThis.fetch) {
  return createGoogleCalendarReadTransport({ accessToken: TOKEN, fetch });
}

function calendar(id = "team@example.test", extra: Record<string, unknown> = {}) {
  return {
    id,
    summary: "Team",
    timeZone: ZONE,
    backgroundColor: "#336699",
    foregroundColor: "#ffffff",
    ...extra,
  };
}

function event(id = "event1", extra: Record<string, unknown> = {}) {
  return {
    id,
    status: "confirmed",
    summary: "A meeting",
    htmlLink: "https://calendar.google.com/calendar/event?eid=ZXZlbnQx",
    start: { dateTime: "2026-09-08T09:00:00-04:00", timeZone: ZONE },
    end: { dateTime: "2026-09-08T10:00:00-04:00", timeZone: ZONE },
    ...extra,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fixed read-only Google Calendar requests", () => {
  it("uses only loader parameters, fixed host and GET, with the token only in Authorization", async () => {
    const fetch = fakeFetch();
    const result = await transport(fetch).fetchEventPage(request(), options());
    const [input, init] = fetch.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.origin).toBe("https://www.googleapis.com");
    expect(url.pathname).toBe("/calendar/v3/calendars/team%40example.test/events");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      timeMin: "2026-09-07T04:00:00Z",
      timeMax: "2026-09-14T04:00:00Z",
      timeZone: ZONE,
      maxResults: "250",
      singleEvents: "true",
      showDeleted: "false",
      orderBy: "startTime",
      fields: CALENDAR_EVENT_FIELDS,
      eventLabelVersion: "1",
    });
    expect(init).toEqual({
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${TOKEN}` },
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: expect.any(AbortSignal),
    });
    expect(String(input)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result).toEqual({ items: [] });
  });

  it("encodes opaque calendar IDs and pagination tokens without allowing URL/query injection", async () => {
    const fetch = fakeFetch();
    const pageToken = "opaque&access_token=not-a-token?next=https://evil.test/#x +/=";
    for (const calendarId of [
      "https://evil.test/a?b#c",
      "a/../../users/me/calendarList",
      "a%2f..%2fb",
      "a\\b@example.test",
    ]) {
      await transport(fetch).fetchEventPage(request({ calendarId, pageToken }), options());
      const url = new URL(String(fetch.mock.lastCall![0]));
      expect(url.origin).toBe("https://www.googleapis.com");
      expect(url.pathname).toBe(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
      expect(url.searchParams.get("pageToken")).toBe(pageToken);
      expect(url.searchParams.get("access_token")).toBeNull();
      expect(url.hash).toBe("");
    }
  });

  it.each([
    { fields: "*" },
    { fields: "description" },
    { maxResults: 251 },
    { singleEvents: false },
    { showDeleted: true },
    { orderBy: "updated" },
    { calendarId: ".." },
    { calendarId: "." },
    { calendarId: "bad\r\nheader" },
    { timeZone: "Invalid/Zone" },
    { timeMin: "2026-09-07" },
    { timeMax: "2026-02-30T00:00:00Z" },
    { timeMax: "2026-09-01T04:00:00Z" },
    { pageToken: "" },
    { pageToken: "x".repeat(GOOGLE_CALENDAR_MAX_PAGE_TOKEN_LENGTH + 1) },
  ])("rejects unsafe/changed request fields without fetching: %j", async (extra) => {
    const fetch = fakeFetch();
    await expect(
      transport(fetch).fetchEventPage(
        request(extra as Partial<CalendarEventPageRequest>),
        options(),
      ),
    ).rejects.toMatchObject({ name: "CalendarProviderError", code: "calendar_unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["", "Bearer token", "bad\r\nheader", "a".repeat(4_097)])(
    "rejects invalid credentials safely",
    (accessToken) => {
      const fetch = fakeFetch();
      expect(() => createGoogleCalendarReadTransport({ accessToken, fetch })).toThrow(
        CalendarProviderError,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("does not reuse tokens across independent request-local instances", async () => {
    const fetch = fakeFetch();
    await Promise.all(
      ["token_A", "token_B"].map((accessToken) =>
        createGoogleCalendarReadTransport({ accessToken, fetch }).fetchEventPage(
          request(),
          options(),
        ),
      ),
    );
    expect(
      fetch.mock.calls.map(([, init]) => new Headers(init?.headers).get("authorization")),
    ).toEqual(["Bearer token_A", "Bearer token_B"]);
  });
});

describe("fresh calendar list metadata", () => {
  it("follows empty pages, includes Google-hidden calendars, and defaults app visibility independently", async () => {
    const fetch = fakeFetch()
      .mockResolvedValueOnce(response({ items: [], nextPageToken: "opaque +/&?=" }))
      .mockResolvedValueOnce(
        response({
          items: [
            calendar(undefined, {
              summaryOverride: "My team",
              selected: false,
              hidden: true,
              description: PRIVATE,
              accessToken: TOKEN,
            }),
          ],
          nextSyncToken: PRIVATE,
        }),
      );
    const result = await transport(fetch).listCalendars(options());
    expect(result).toEqual([
      {
        calendarId: "team@example.test",
        displayName: "My team",
        timeZone: ZONE,
        color: { background: "#336699", foreground: "#ffffff" },
        isVisible: true,
        canEdit: false,
      },
    ]);
    const first = new URL(String(fetch.mock.calls[0]![0]));
    const second = new URL(String(fetch.mock.calls[1]![0]));
    expect(first.pathname).toBe("/calendar/v3/users/me/calendarList");
    expect(Object.fromEntries(first.searchParams)).toEqual({
      maxResults: "250",
      showDeleted: "false",
      showHidden: "true",
      fields: GOOGLE_CALENDAR_LIST_FIELDS,
    });
    expect(second.searchParams.get("pageToken")).toBe("opaque +/&?=");
    expect(second.searchParams.get("syncToken")).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(
      /description|accessToken|nextSyncToken|private provider/,
    );
  });

  it("keeps missing/invalid source zones unavailable per calendar without guessing from the profile", async () => {
    const fetch = fakeFetch(async (url) =>
      String(url).includes("calendarList")
        ? response({
            items: [
              calendar("valid"),
              calendar("missing", { timeZone: undefined }),
              calendar("invalid", { timeZone: "bad" }),
            ],
          })
        : response({ items: [event()] }),
    );
    const read = transport(fetch);
    const calendars = await read.listCalendars(options());
    expect(calendars.map((value) => value.timeZone)).toEqual([ZONE, "", ""]);
    const week = await loadCalendarWeek(
      { sunday: "2026-09-06", timezone: ZONE, calendars },
      read.fetchEventPage,
      options(),
    );
    expect(week.events).toHaveLength(1);
    expect(week.partialErrors.map((error) => error.calendarId)).toEqual(["missing", "invalid"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("supports optional colors and an empty calendar title without copying unrelated fields", async () => {
    const fetch = fakeFetch(async () => response({ items: [{ id: "team", timeZone: "UTC" }] }));
    expect(await transport(fetch).listCalendars(options())).toEqual([
      {
        calendarId: "team",
        timeZone: "UTC",
        displayName: "(Untitled calendar)",
        color: { background: null, foreground: null },
        isVisible: true,
        canEdit: false,
      },
    ]);
  });

  it.each([
    { items: [calendar(), calendar()] },
    { items: [calendar("bad", { backgroundColor: "url(private)" })] },
    { items: [calendar("bad", { summary: { description: PRIVATE } })] },
    { items: [null] },
  ])(
    "rejects malformed or duplicate metadata instead of presenting a false complete list",
    async (body) => {
      await expect(
        transport(fakeFetch(async () => response(body))).listCalendars(options()),
      ).rejects.toMatchObject({ code: "calendar_unavailable" });
    },
  );

  it("rejects token loops and later-page errors without returning earlier metadata", async () => {
    const loop = fakeFetch(async () => response({ items: [], nextPageToken: "same" }));
    await expect(transport(loop).listCalendars(options())).rejects.toMatchObject({
      code: "calendar_unavailable",
    });
    expect(loop).toHaveBeenCalledTimes(2);
    const failing = fakeFetch()
      .mockResolvedValueOnce(response({ items: [calendar()], nextPageToken: "next" }))
      .mockResolvedValueOnce(response({ error: PRIVATE }, 503));
    await expect(transport(failing).listCalendars(options())).rejects.toMatchObject({
      code: "calendar_unavailable",
    });
  });

  it("bounds list pagination instead of silently returning a prefix", async () => {
    let index = 0;
    const fetch = fakeFetch(async () => response({ items: [], nextPageToken: `page${++index}` }));
    await expect(transport(fetch).listCalendars(options())).rejects.toMatchObject({
      code: "calendar_unavailable",
    });
    expect(fetch).toHaveBeenCalledTimes(GOOGLE_CALENDAR_LIST_MAX_PAGES);
  });
});

describe("bounded response handling", () => {
  it("projects only normalizer fields even when Google returns extra sensitive data", async () => {
    const value = event("instance1", {
      recurringEventId: "master",
      location: "Hall 204",
      description: PRIVATE,
      attendees: [{ email: PRIVATE }],
      start: { dateTime: "2026-09-08T09:00:00-04:00", description: PRIVATE },
    });
    const fetch = fakeFetch(async () =>
      response({ items: [value], description: PRIVATE, nextPageToken: "next" }),
    );
    const result = await transport(fetch).fetchEventPage(request(), options());
    expect(result).toEqual({
      nextPageToken: "next",
      items: [
        {
          id: "instance1",
          status: "confirmed",
          summary: "A meeting",
          location: "Hall 204",
          htmlLink: value.htmlLink,
          recurringEventId: "master",
          start: { dateTime: "2026-09-08T09:00:00-04:00" },
          end: value.end,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  });

  it("marks malformed fields and recurrence masters invalid without leaking nested payloads", async () => {
    const fetch = fakeFetch(async () =>
      response({
        items: [
          event("bad", {
            summary: { secret: PRIVATE },
            start: { dateTime: { secret: PRIVATE } },
            recurrence: [PRIVATE],
          }),
          null,
        ],
      }),
    );
    const result = await transport(fetch).fetchEventPage(request(), options());
    expect(result).toMatchObject({
      items: [{ summary: null, start: { dateTime: null }, recurrence: [] }, null],
    });
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
  });

  it.each([
    [401, "reconnect_required"],
    [403, "calendar_unavailable"],
    [429, "calendar_unavailable"],
    [500, "calendar_unavailable"],
    [503, "calendar_unavailable"],
    [302, "calendar_unavailable"],
  ])(
    "sanitizes HTTP %s without forwarding bodies, response headers, or error causes",
    async (status, code) => {
      const fetch = fakeFetch(async () =>
        response(
          { error: { message: PRIVATE, errors: [{ reason: "rateLimitExceeded" }] } },
          Number(status),
          {
            "x-provider-secret": TOKEN,
            location: "https://evil.test",
          },
        ),
      );
      const error = await transport(fetch)
        .fetchEventPage(request(), options())
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        name: "CalendarProviderError",
        code,
        message: "Calendar could not be loaded.",
      });
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(error)).not.toMatch(
        /private provider|fake_request_local|rateLimitExceeded/,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not treat permission or quota-related 403 responses as revoked credentials", async () => {
    for (const reason of [
      "forbidden",
      "insufficientPermissions",
      "userRateLimitExceeded",
      "rateLimitExceeded",
      "quotaExceeded",
    ]) {
      const fetch = fakeFetch(async () => response({ error: { errors: [{ reason }] } }, 403));
      await expect(transport(fetch).fetchEventPage(request(), options())).rejects.toMatchObject({
        code: "calendar_unavailable",
      });
    }
  });

  it.each([
    null,
    [],
    { error: { message: PRIVATE } },
    { items: null },
    { items: {} },
    { items: [], nextPageToken: "" },
    { items: [], nextPageToken: 42 },
    { items: [], nextPageToken: "x".repeat(GOOGLE_CALENDAR_MAX_PAGE_TOKEN_LENGTH + 1) },
    { items: Array.from({ length: CALENDAR_PAGE_SIZE + 1 }, () => ({})) },
  ])("rejects invalid page shapes", async (body) => {
    await expect(
      transport(fakeFetch(async () => response(body))).fetchEventPage(request(), options()),
    ).rejects.toMatchObject({ code: "calendar_unavailable" });
  });

  it.each(["{", '{"items":[', "not json"])("sanitizes malformed/truncated JSON", async (body) => {
    const fetch = fakeFetch(
      async () => new Response(body, { headers: { "content-type": "application/json" } }),
    );
    await expect(transport(fetch).fetchEventPage(request(), options())).rejects.toMatchObject({
      code: "calendar_unavailable",
    });
  });

  it("counts actual streamed bytes, not just claimed Content-Length, and cancels oversize streams", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(GOOGLE_CALENDAR_MAX_BODY_BYTES + 1).fill(32));
      },
      cancel,
    });
    const fetch = fakeFetch(
      async () =>
        new Response(body, {
          headers: { "content-type": "application/json", "content-length": "1" },
        }),
    );
    await expect(transport(fetch).fetchEventPage(request(), options())).rejects.toMatchObject({
      code: "calendar_unavailable",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each<Record<string, string>>([
    { "content-length": String(GOOGLE_CALENDAR_MAX_BODY_BYTES + 1) },
    { "content-length": "invalid" },
    { "x-extra": "x".repeat(GOOGLE_CALENDAR_MAX_HEADER_BYTES) },
    { "content-type": "text/html" },
  ])("rejects unsafe content headers before accepting a page", async (headers) => {
    await expect(
      transport(fakeFetch(async () => response({}, 200, headers))).fetchEventPage(
        request(),
        options(),
      ),
    ).rejects.toMatchObject({ code: "calendar_unavailable" });
  });

  it("rejects invalid UTF-8 and stream failures with sanitized errors", async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error(PRIVATE));
      },
    });
    for (const body of [new Uint8Array([0xff, 0xfe]), broken]) {
      const fetch = fakeFetch(
        async () => new Response(body, { headers: { "content-type": "application/json" } }),
      );
      await expect(transport(fetch).fetchEventPage(request(), options())).rejects.toMatchObject({
        code: "calendar_unavailable",
      });
    }
  });

  it("decodes valid UTF-8 split across response chunks", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ items: [event("event1", { summary: "Meet José" })] }),
    );
    const split = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const fetch = fakeFetch(
      async () =>
        new Response(body, { headers: { "content-type": "application/json; charset=UTF-8" } }),
    );
    await expect(transport(fetch).fetchEventPage(request(), options())).resolves.toMatchObject({
      items: [{ summary: "Meet José" }],
    });
  });

  it("bounds endlessly empty stream chunks even when they would starve a timer", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array());
      },
      cancel,
    });
    const fetch = fakeFetch(
      async () => new Response(body, { headers: { "content-type": "application/json" } }),
    );
    await expect(transport(fetch).fetchEventPage(request(), options())).rejects.toMatchObject({
      code: "calendar_unavailable",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("fits the loader pagination port and discards failed later pages", async () => {
    const fetch = fakeFetch()
      .mockResolvedValueOnce(response({ items: [event()], nextPageToken: "next" }))
      .mockResolvedValueOnce(response({ error: PRIVATE }, 503));
    const result = await loadCalendarWeek(
      {
        sunday: "2026-09-06",
        timezone: ZONE,
        calendars: [
          {
            calendarId: "team",
            displayName: "Team",
            timeZone: ZONE,
            isVisible: true,
            canEdit: false,
            color: { background: null, foreground: null },
          },
        ],
      },
      transport(fetch).fetchEventPage,
      options(),
    );
    expect(result.events).toEqual([]);
    expect(result.partialErrors).toMatchObject([{ code: "calendar_unavailable" }]);
    expect(new URL(String(fetch.mock.calls[1]![0])).searchParams.get("pageToken")).toBe("next");
  });
});

describe("timeouts and cancellation", () => {
  it("performs no network work for an already-cancelled caller", async () => {
    const controller = new AbortController();
    controller.abort(PRIVATE);
    const fetch = fakeFetch();
    await expect(
      transport(fetch).fetchEventPage(request(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError", message: "Calendar request cancelled." });
    await expect(
      transport(fetch).listCalendars({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("settles on cancellation even if fetch ignores it, and observes a late rejection", async () => {
    const pending = deferred<Response>();
    const fetch = fakeFetch(() => pending.promise);
    const controller = new AbortController();
    const read = transport(fetch).fetchEventPage(request(), { signal: controller.signal });
    const rejected = expect(read).rejects.toMatchObject({
      name: "AbortError",
      message: "Calendar request cancelled.",
    });
    controller.abort(new Error(PRIVATE));
    await rejected;
    expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    pending.reject(new Error(PRIVATE));
    await Promise.resolve();
  });

  it("cancels a late successful response from a fetch that ignored the deadline", async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const fetch = fakeFetch(() => pending.promise);
    const read = transport(fetch).fetchEventPage(request(), options());
    const rejected = expect(read).rejects.toMatchObject({ code: "calendar_unavailable" });
    await vi.advanceTimersByTimeAsync(GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS);
    await rejected;
    const cancel = vi.fn();
    pending.resolve(new Response(new ReadableStream<Uint8Array>({ cancel })));
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles when a response stream and its cancellation both hang", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}),
      cancel,
    });
    const fetch = fakeFetch(
      async () => new Response(body, { headers: { "content-type": "application/json" } }),
    );
    const read = transport(fetch).fetchEventPage(request(), options());
    const rejected = expect(read).rejects.toMatchObject({ code: "calendar_unavailable" });
    await vi.advanceTimersByTimeAsync(GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates caller cancellation while the response stream is pending", async () => {
    const reading = deferred<void>();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          reading.resolve();
          return new Promise<void>(() => {});
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const fetch = fakeFetch(
      async () => new Response(body, { headers: { "content-type": "application/json" } }),
    );
    const controller = new AbortController();
    const read = transport(fetch).fetchEventPage(request(), { signal: controller.signal });
    const rejected = expect(read).rejects.toMatchObject({
      name: "AbortError",
      message: "Calendar request cancelled.",
    });
    await reading.promise;
    controller.abort(PRIVATE);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds the complete calendar list as well as each request", async () => {
    vi.useFakeTimers();
    let index = 0;
    const fetch = fakeFetch(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(response({ items: [], nextPageToken: `page${++index}` }));
          }, GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS - 1),
        ),
    );
    const read = transport(fetch).listCalendars(options());
    const rejected = expect(read).rejects.toMatchObject({ code: "calendar_unavailable" });
    await vi.advanceTimersByTimeAsync(GOOGLE_CALENDAR_LIST_TIMEOUT_MS);
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.lastCall![1]?.signal?.aborted).toBe(true);
    await vi.runAllTimersAsync();
  });

  it("does not log transport exceptions or response bodies", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = fakeFetch(async () => {
      throw new Error(`${PRIVATE} ${TOKEN}`);
    });
    await expect(transport(fetch).fetchEventPage(request(), options())).rejects.toMatchObject({
      code: "calendar_unavailable",
      message: "Calendar could not be loaded.",
    });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("does not trust an injected provider error's mutable message or cause", async () => {
    const unsafe = new CalendarProviderError("calendar_unavailable");
    unsafe.message = PRIVATE;
    unsafe.cause = TOKEN;
    const fetch = fakeFetch(async () => {
      throw unsafe;
    });
    const error = await transport(fetch)
      .fetchEventPage(request(), options())
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "calendar_unavailable",
      message: "Calendar could not be loaded.",
    });
    expect(error).not.toHaveProperty("cause");
    expect(error).not.toBe(unsafe);
  });
});

describe("Google event color overrides", () => {
  it("uses exact label fills, isolates calendars, and reuses each palette across pages", async () => {
    const fetch = fakeFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/events"))
        return response({
          items: [
            event("class", { eventLabelId: "basil", colorId: "10" }),
            event("work", { eventLabelId: "cherry" }),
            event("unknown", { eventLabelId: "unknown", colorId: "10" }),
            event("unsafe", { eventLabelId: "unsafe" }),
          ],
        });
      expect(url.searchParams.get("fields")).toBe(
        "labelProperties(eventLabels(id,backgroundColor))",
      );
      return response({
        labelProperties: {
          eventLabels: [
            {
              id: "basil",
              backgroundColor: url.pathname.includes("other") ? "#123456" : "#0b8043",
              name: PRIVATE,
            },
            { id: "cherry", backgroundColor: "#d81b60" },
            { id: "unsafe", backgroundColor: "url(private)" },
            null,
          ],
        },
        description: PRIVATE,
      });
    });
    const reader = transport(fetch);
    const page = (await reader.fetchEventPage(request(), options())) as { items: unknown[] };
    await reader.fetchEventPage(request({ pageToken: "next" }), options());
    const other = (await reader.fetchEventPage(
      request({ calendarId: "other@example.test" }),
      options(),
    )) as { items: unknown[] };
    expect(
      fetch.mock.calls.filter(([input]) => !new URL(String(input)).pathname.endsWith("/events")),
    ).toHaveLength(2);
    const metadata = {
      calendarId: "work",
      displayName: "Work",
      color: { background: "#336699", foreground: "#ffffff" },
      isVisible: true as const,
    };
    const normalized = page.items.map((item) => normalizeGoogleEvent(item, metadata));
    expect(normalized[0]).toMatchObject({
      status: "event",
      event: { calendarColor: { background: "#0b8043" } },
    });
    expect(normalized[1]).toMatchObject({
      status: "event",
      event: { calendarColor: { background: "#d81b60" } },
    });
    for (const result of normalized.slice(2))
      expect(result).toMatchObject({ status: "event", event: { calendarColor: metadata.color } });
    expect(normalizeGoogleEvent(other.items[0], metadata)).toMatchObject({
      status: "event",
      event: { calendarColor: { background: "#123456" } },
    });
    expect(JSON.stringify(page)).not.toContain(PRIVATE);
    expect(JSON.stringify(page)).not.toContain("eventLabelId");
  });

  it.each([
    {},
    { labelProperties: { eventLabels: "invalid" } },
    {
      labelProperties: {
        eventLabels: Array(201).fill({ id: "basil", backgroundColor: "#0b8043" }),
      },
    },
  ])("tolerates missing or malformed label palettes", async (body) => {
    const fetch = fakeFetch(async (input) =>
      new URL(String(input)).pathname.endsWith("/events")
        ? response({ items: [event("class", { eventLabelId: "basil" })] })
        : response(body),
    );
    const page = (await transport(fetch).fetchEventPage(request(), options())) as {
      items: unknown[];
    };
    expect(page.items).toEqual([event("class")]);
  });

  it.each([403, 503])("keeps events when optional label metadata returns %s", async (status) => {
    const fetch = fakeFetch(async (input) =>
      new URL(String(input)).pathname.endsWith("/events")
        ? response({ items: [event("class", { eventLabelId: "basil" })] })
        : response({}, status),
    );
    expect(await transport(fetch).fetchEventPage(request(), options())).toEqual({
      items: [event("class")],
    });
  });

  it("propagates revoked grants while resolving label colors", async () => {
    const fetch = fakeFetch(async (input) =>
      new URL(String(input)).pathname.endsWith("/events")
        ? response({ items: [event("class", { eventLabelId: "basil" })] })
        : response({}, 401),
    );
    await expect(transport(fetch).fetchEventPage(request(), options())).rejects.toMatchObject({
      code: "reconnect_required",
    });
  });

  it("resolves overrides from one request-local palette and falls back for unknown colors", async () => {
    const fetch = fakeFetch(async (input) =>
      String(input).includes("/colors?")
        ? response({
            event: {
              "9": { background: "#5484ed", foreground: "#1d1d1d" },
              bad: { background: "url(private)" },
            },
          })
        : response({
            items: [
              event("override", { colorId: "9" }),
              event("default"),
              event("unknown", { colorId: "99" }),
              event("bad", { colorId: "bad" }),
            ],
          }),
    );
    const reader = transport(fetch);
    const page = (await reader.fetchEventPage(request(), options())) as { items: unknown[] };
    await reader.fetchEventPage(request({ pageToken: "next" }), options());
    expect(fetch.mock.calls.filter(([input]) => String(input).includes("/colors?")).length).toBe(1);
    const metadata = {
      calendarId: "work",
      displayName: "Work",
      color: { background: "#336699", foreground: "#ffffff" },
      isVisible: true as const,
    };
    const normalized = page.items.map((item) => normalizeGoogleEvent(item, metadata));
    expect(normalized[0]).toMatchObject({
      status: "event",
      event: { calendarColor: { background: "#5484ed" } },
    });
    for (const result of normalized.slice(1))
      expect(result).toMatchObject({ status: "event", event: { calendarColor: metadata.color } });
  });

  it("keeps events available if optional palette metadata is unavailable", async () => {
    const fetch = fakeFetch(async (input) =>
      String(input).includes("/colors?")
        ? response({}, 503)
        : response({ items: [event("override", { colorId: "9" })] }),
    );
    const page = (await transport(fetch).fetchEventPage(request(), options())) as {
      items: unknown[];
    };
    expect(page.items).toEqual([event("override")]);
  });
});
