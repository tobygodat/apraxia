import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { createFixtureCalendar, type FixtureStorage } from "./workspaceFixtureCalendar";
import { createFixtureAppearance, delayedFixtureService } from "./workspaceFixtureSupport";
import { layoutTimedEvents } from "../features/calendar/eventLayout";

const monday = "2026-09-14";
const timezone = "America/New_York";
function memoryStorage(): FixtureStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}
const fixture = (storage = memoryStorage()) => createFixtureCalendar({ scenario: "realistic", timezone, storage, storageKey: "test-calendar" });

describe("calendar QA coverage", () => {
  it("exercises provider event colors, crowded columns, short adjacent events, and missing titles", async () => {
    const service = fixture();
    const week = await service.week(monday);
    const work = week.events.filter(e => e.calendarId === "work");
    expect(new Set(work.map(e => e.calendarColor.background)).size).toBeGreaterThan(3);
    expect(work.some(e => e.calendarColor.background === "#7986cb")).toBe(true);
    expect(week.events.some(e => e.title === "(No title)")).toBe(true);
    expect(week.events.some(e => e.calendarId === "hidden")).toBe(false);
    expect(layoutTimedEvents(week.events, monday, timezone).some(e => e.columns >= 3)).toBe(true);
    const first = week.events.find(e => e.eventId.endsWith("adjacent-a"))!;
    const second = week.events.find(e => e.eventId.endsWith("adjacent-b"))!;
    expect(first.kind).toBe("timed");
    expect(first.endAt).toBe(second.startAt);
    const durations = week.events.filter(e => e.kind === "timed").map(e => Temporal.Instant.from(e.startAt).until(e.endAt).total("minutes"));
    for (const duration of [5, 15, 30, 50, 60, 75, 90, 120]) expect(durations).toContain(duration);
  });

  it("retains event-specific colors, edits, and visibility across service recreation", async () => {
    const storage = memoryStorage();
    const service = fixture(storage);
    const week = await service.week(monday);
    const event = week.events.find(e => e.eventId.endsWith("seminar"))!;
    const detail = await service.eventDetail!(event.calendarId, event.eventId, "instance");
    await service.mutateEvent!({ action: "update", calendarId: event.calendarId, destinationCalendarId: event.calendarId,
      eventId: event.eventId, scope: "instance", etag: detail.etag, values: { ...detail.values, title: "Edited seminar" } });
    await service.setVisibility("personal", false);
    const reloaded = await fixture(storage).week(monday);
    expect(reloaded.events.find(e => e.eventId === event.eventId)).toMatchObject({ title: "Edited seminar", calendarColor: { background: "#d50000" } });
    expect(reloaded.events.some(e => e.calendarId === "personal")).toBe(false);
    await expect(service.mutateEvent!({ action: "delete", calendarId: event.calendarId, eventId: event.eventId, scope: "instance", etag: detail.etag })).rejects.toMatchObject({ code: "event_conflict" });
  });

  it("filters previously visited weeks and does not reseed deleted events", async () => {
    const storage = memoryStorage();
    const service = fixture(storage);
    const week = await service.week(monday);
    const event = week.events.find(e => e.eventId.endsWith("seminar"))!;
    const detail = await service.eventDetail!(event.calendarId, event.eventId, "instance");
    await service.mutateEvent!({ action: "delete", calendarId: event.calendarId, eventId: event.eventId, scope: "instance", etag: detail.etag });
    const next = await service.week("2026-09-21");
    expect(next.events.some(e => e.eventId.startsWith(monday))).toBe(false);
    expect((await fixture(storage).week(monday)).events.some(e => e.eventId === event.eventId)).toBe(false);
  });

  it("rejects writes to read-only calendars and unsupported series instead of faking success", async () => {
    const service = fixture();
    const week = await service.week(monday);
    for (const [suffix, code, scope] of [["readonly", "calendar_readonly", "instance"], ["lecture", "fixture_unsupported", "series"]] as const) {
      const event = week.events.find(e => e.eventId.endsWith(suffix))!;
      const detail = await service.eventDetail!(event.calendarId, event.eventId, scope);
      await expect(service.mutateEvent!({ action: "delete", calendarId: event.calendarId, eventId: event.eventId, scope, etag: detail.etag })).rejects.toMatchObject({ code });
    }
  });
});

describe("QA appearance and delayed requests", () => {
  it("saves the full cover and crop coordinates and respects reset", async () => {
    const storage = memoryStorage();
    const signal = new AbortController().signal;
    const service = createFixtureAppearance(storage, "appearance", null);
    const value = { title: "My page", coverImage: "data:image/png;base64,YQ==", coverPositionX: 81, coverPositionY: 16 };
    await service.save("fictional", value, signal);
    expect(await createFixtureAppearance(storage, "appearance", null).load("fictional", signal)).toEqual(value);
    storage.removeItem("appearance");
    expect((await service.load("fictional", signal)).coverImage).toBeNull();
  });

  it("surfaces storage failure rather than reporting a successful save", async () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error("Storage full"); };
    const service = createFixtureAppearance(storage, "appearance", null);
    await expect(service.save("fictional", { title: "changed", coverImage: null }, new AbortController().signal)).rejects.toThrow("Storage full");
  });

  it("cancels delayed requests before running a mutation", async () => {
    let writes = 0;
    const service = delayedFixtureService({ async save(_options: { signal: AbortSignal }) { writes++; } }, 20);
    const controller = new AbortController();
    const pending = service.save({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(writes).toBe(0);
  });
});
