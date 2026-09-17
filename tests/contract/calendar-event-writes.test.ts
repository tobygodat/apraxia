import { describe, expect, it, vi } from "vitest";
import { executeEventCommand } from "../../server/calendar/calendarEventWrites";
import {
  eventCommandSchema,
  type EventCommand,
  type EventValues,
} from "../../shared/calendarEventContract";
import { createCalendarHandler } from "../../server/calendar/calendarHandlers";

const calendars = ["personal", "work"].map((calendarId) => ({
  calendarId,
  displayName: calendarId,
  color: { background: null, foreground: null },
  timeZone: "America/New_York",
  isVisible: true,
  canEdit: true,
}));
const values: EventValues = {
  title: "Planning",
  location: "Library",
  timeZone: "America/New_York",
  recurrence: [],
  timing: { kind: "timed", start: "2026-09-07T13:00:00Z", end: "2026-09-07T14:00:00Z" },
};
const current = {
  id: "event",
  etag: '"v1"',
  summary: "Planning",
  location: "Library",
  organizer: { self: true },
  start: { dateTime: values.timing.start },
  end: { dateTime: values.timing.end },
};
const update: EventCommand = {
  action: "update",
  calendarId: "personal",
  eventId: "event",
  etag: '"v1"',
  scope: "instance",
  destinationCalendarId: "personal",
  values,
};
const run = (command: EventCommand, fetcher: typeof fetch, available = calendars) =>
  executeEventCommand(
    command,
    available,
    "private-access-token",
    new AbortController().signal,
    fetcher,
  );
describe("Google event writes", () => {
  it("validates time ordering, recurrence, identifiers and extra fields before a write", () => {
    expect(eventCommandSchema.safeParse(update).success).toBe(true);
    for (const command of [
      { ...update, ownerId: "other" },
      { ...update, calendarId: ".." },
      { ...update, values: { ...values, timing: { ...values.timing, end: values.timing.start } } },
      { ...update, values: { ...values, recurrence: ["RRULE:FREQ=HOURLY"] } },
    ]) {
      expect(eventCommandSchema.safeParse(command).success).toBe(false);
    }
  });
  it("rejects cross-origin event POSTs before contacting Auth", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await createCalendarHandler("events", {
      environment: {
        APP_URL: "https://apraxia.example.test",
        SUPABASE_URL: "https://project.supabase.co",
        VITE_SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_ANON_KEY: "sb_publishable_test",
        VITE_SUPABASE_ANON_KEY: "sb_publishable_test",
        SUPABASE_SERVICE_ROLE_KEY: "server",
      },
      fetch: fetcher,
    })(
      new Request("https://apraxia.example.test/api/calendar/events", {
        method: "POST",
        headers: { origin: "https://other.test", "Content-Type": "application/json" },
        body: JSON.stringify(update),
      }),
    );
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("blocks writes to read-only calendars without provider traffic", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      run(
        update,
        fetcher,
        calendars.map((c) => ({ ...c, canEdit: false })),
      ),
    ).rejects.toMatchObject({ code: "calendar_readonly" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("creates with a stable client id, all-day exclusive bounds and recurrence", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "created" }));
    await run(
      {
        action: "create",
        calendarId: "personal",
        eventId: "a".repeat(32),
        values: {
          ...values,
          timing: { kind: "all_day", start: "2026-09-07", end: "2026-09-09" },
          recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5"],
        },
      },
      fetcher,
    );
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain("sendUpdates=all");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      id: "a".repeat(32),
      start: { date: "2026-09-07" },
      end: { date: "2026-09-09" },
      recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5"],
    });
  });
  it("patches only edited fields and uses If-Match to protect concurrent edits", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(current));
    await run(update, fetcher);
    const init = fetcher.mock.calls[1]![1]!;
    expect(init.method).toBe("PATCH");
    expect(new Headers(init.headers).get("If-Match")).toBe('"v1"');
    expect(JSON.parse(String(init.body))).not.toHaveProperty("attendees");
    expect(JSON.parse(String(init.body))).not.toHaveProperty("description");
    await expect(run({ ...update, etag: "old" }, fetcher)).rejects.toMatchObject({
      code: "event_conflict",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("uses the series master only when explicitly selected and preserves arbitrary recurrence", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ...current, recurringEventId: "master" }))
      .mockResolvedValueOnce(
        Response.json({ ...current, id: "master", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH"] }),
      );
    const result = await run(
      { action: "detail", calendarId: "personal", eventId: "event", scope: "series" },
      fetcher,
    );
    expect(String(fetcher.mock.calls[1]![0])).toContain("/events/master?");
    expect(result).toMatchObject({
      recurring: true,
      values: { recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH"] },
    });
  });
  it("deletes an instance with a conditional request and accepts an empty 204", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ...current, recurringEventId: "master" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      run(
        {
          action: "delete",
          calendarId: "personal",
          eventId: "event",
          etag: current.etag,
          scope: "instance",
        },
        fetcher,
      ),
    ).resolves.toEqual({ saved: true });
    expect(String(fetcher.mock.calls[1]![0])).toContain("/events/event?");
    expect(fetcher.mock.calls[1]![1]?.method).toBe("DELETE");
  });
  it("reports a partial save when a subsequent move fails, without retrying", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(current))
      .mockResolvedValueOnce(Response.json({ id: "event" }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const result = await run({ ...update, destinationCalendarId: "work" }, fetcher);
    expect(result).toMatchObject({
      saved: true,
      warning: expect.stringContaining("move could not be confirmed"),
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[2]![0])).toContain("/move?destination=work");
  });
});
