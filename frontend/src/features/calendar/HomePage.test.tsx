// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { CalendarService } from "./calendarService";
import type { TodoService } from "../todos/todoService";
import { CalendarPanel, HomePage, WeekGrid } from "./HomePage";
import type { AllDayCalendarEvent, CalendarEvent, WeekViewModel } from "../../types/domain";
afterEach(cleanup);
it("keeps Google links and editing targets intact for colored timed and all-day events", () => {
  const events: CalendarEvent[] = [
    { kind: "all_day", calendarId: "work", eventId: "trip", title: "Studio week", calendarColor: { background: "#c5b293", foreground: null }, googleEventUrl: "https://calendar.google.com/calendar/event?eid=trip", startDate: "2026-09-07", endDateExclusive: "2026-09-09" },
    { kind: "timed", calendarId: "personal", eventId: "coffee", title: "Coffee", calendarColor: { background: "#91b0d7", foreground: null }, googleEventUrl: "https://calendar.google.com/calendar/event?eid=coffee", startAt: "2026-09-07T09:00:00Z", endAt: "2026-09-07T10:00:00Z", startTimeZone: null, endTimeZone: null },
  ];
  const week: WeekViewModel = { range: { monday: "2026-09-07", sunday: "2026-09-13" }, timezone: "UTC", visibleCalendars: [], partialErrors: [], events };
  const now = new Date("2026-09-07T12:00:00Z");
  const { rerender } = render(<WeekGrid week={week} now={now} />);
  for (const event of events) {
    const anchor = screen.getByRole("link", { name: new RegExp(event.title) });
    expect(anchor.getAttribute("href")).toBe(event.googleEventUrl);
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor.style.getPropertyValue("--calendar-event-color")).toBe(event.calendarColor.background);
  }
  const onEdit = vi.fn();
  rerender(<WeekGrid week={week} now={now} onEdit={onEdit} />);
  fireEvent.click(screen.getByRole("button", { name: /Studio week/ }));
  fireEvent.keyDown(screen.getByRole("button", { name: /Coffee/ }), { key: " " });
  expect(onEdit.mock.calls).toEqual([[events[0]], [events[1]]]);
});
it("loads Today while Calendar status is still pending", async () => {
  const loadToday = vi.fn(async () => []);
  const calendar = { status: () => new Promise(() => { }) } as unknown as CalendarService;
  render(<MemoryRouter>
    <HomePage
      todoService={{ loadToday } as unknown as TodoService}
      calendarService={calendar}
      profile={{ userId: "user", timezone: "UTC", createdAt: "", updatedAt: "" }}
      projects={[]}
      workspaceSessionKey="session" />
  </MemoryRouter>);
  await waitFor(() => expect(loadToday).toHaveBeenCalled());
  expect(screen.getByText("Loading your week…")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
});
it("preserves a loaded week on refresh failure, then hides it when navigating", async () => {
  const week = vi.fn(async (monday: string) => ({
    range: { monday, sunday: monday }, timezone: "UTC", visibleCalendars: [], partialErrors: [],
    events: [{ kind: "timed", calendarId: "primary", eventId: "event", title: "Coffee with Sam", startAt: `${monday}T09:00:00Z`, endAt: `${monday}T10:00:00Z`, startTimeZone: null, endTimeZone: null, calendarColor: { background: null, foreground: null }, googleEventUrl: "https://calendar.google.com" }],
  }));
  const service = { status: async () => ({ connectionState: "connected" }), week } as unknown as CalendarService;
  render(<MemoryRouter>
    <CalendarPanel service={service} timezone="UTC" />
  </MemoryRouter>);
  await screen.findByRole("link", { name: /Coffee with Sam/ });
  expect(screen.queryByText("All day")).toBeNull();
  week.mockRejectedValueOnce(new Error("Calendar is unavailable."));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText(/Showing your last loaded events/);
  expect(screen.getByRole("link", { name: /Coffee with Sam/ })).toBeTruthy();
  week.mockImplementationOnce(() => new Promise(() => { }));
  fireEvent.click(screen.getByRole("button", { name: "Next week" }));
  expect(screen.queryByRole("link", { name: /Coffee with Sam/ })).toBeNull();
});

it("shows the all-day row only while an all-day event overlaps the displayed week", () => {
  const event: AllDayCalendarEvent = {
    kind: "all_day", calendarId: "primary", eventId: "trip", title: "Trip",
    calendarColor: { background: null, foreground: null }, googleEventUrl: "https://calendar.google.com",
    startDate: "2026-08-30", endDateExclusive: "2026-09-02",
  };
  const week: WeekViewModel = {
    range: { monday: "2026-08-31", sunday: "2026-09-06" }, timezone: "UTC",
    visibleCalendars: [], partialErrors: [], events: [],
  };
  const now = new Date("2026-09-05T12:00:00Z");
  const { rerender } = render(<WeekGrid week={week} now={now} />);
  expect(screen.queryByText("All day")).toBeNull();

  rerender(<WeekGrid week={{ ...week, events: [event] }} now={now} />);
  expect(screen.getByText("All day")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Trip, all day/ })).toBeTruthy();

  rerender(<WeekGrid week={{ ...week, events: [event], range: { monday: "2026-09-07", sunday: "2026-09-13" } }} now={now} />);
  expect(screen.queryByText("All day")).toBeNull();
  expect(screen.queryByRole("link", { name: /Trip, all day/ })).toBeNull();
});
