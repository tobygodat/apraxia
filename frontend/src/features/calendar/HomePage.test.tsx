// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { CalendarService } from "./calendarService";
import type { TodoService } from "../todos/todoService";
import { CalendarPanel, HomePage, WeekGrid } from "./HomePage";
import type { AllDayCalendarEvent, CalendarEvent, WeekViewModel } from "../../types/domain";
afterEach(cleanup);
it("opens a full preview for timed and all-day events and keeps Google navigation explicit", () => {
  const events: CalendarEvent[] = [
    { kind: "all_day", calendarId: "work", eventId: "trip", title: "Studio week", calendarColor: { background: "#c5b293", foreground: null }, googleEventUrl: "https://calendar.google.com/calendar/event?eid=trip", startDate: "2026-09-07", endDateExclusive: "2026-09-09" },
    { kind: "timed", calendarId: "personal", eventId: "coffee", title: "Coffee", calendarColor: { background: "#91b0d7", foreground: null }, googleEventUrl: "https://calendar.google.com/calendar/event?eid=coffee", startAt: "2026-09-07T09:00:00Z", endAt: "2026-09-07T10:00:00Z", startTimeZone: null, endTimeZone: null },
  ];
  const week: WeekViewModel = { range: { monday: "2026-09-07", sunday: "2026-09-13" }, timezone: "UTC", visibleCalendars: [], partialErrors: [], events };
  const now = new Date("2026-09-07T12:00:00Z");
  render(<WeekGrid week={week} now={now} />);
  for (const event of events) {
    const anchor = screen.getByRole("button", { name: new RegExp(event.title) });
    expect(anchor.style.getPropertyValue("--calendar-event-color")).toBe(event.calendarColor.background);
    fireEvent.click(anchor);
    expect(screen.getByRole('dialog', { name: 'Event details' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: event.title })).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open in Google Calendar' });
    expect(link.getAttribute('href')).toBe(event.googleEventUrl);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  }
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
  await screen.findByRole("button", { name: /Coffee with Sam/ });
  expect(screen.queryByText("All day")).toBeNull();
  week.mockRejectedValueOnce(new Error("Calendar is unavailable."));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText(/Showing your last loaded events/);
  expect(screen.getByRole("button", { name: /Coffee with Sam/ })).toBeTruthy();
  week.mockImplementationOnce(() => new Promise(() => { }));
  fireEvent.click(screen.getByRole("button", { name: "Next week" }));
  expect(screen.queryByRole("button", { name: /Coffee with Sam/ })).toBeNull();
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
  expect(screen.getByRole("button", { name: /Trip, all day/ })).toBeTruthy();

  rerender(<WeekGrid week={{ ...week, events: [event], range: { monday: "2026-09-07", sunday: "2026-09-13" } }} now={now} />);
  expect(screen.queryByText("All day")).toBeNull();
  expect(screen.queryByRole("button", { name: /Trip, all day/ })).toBeNull();
});

it("scales events, hour labels, current time, initial scroll and drag creation together", () => {
  const week: WeekViewModel = { range: { monday: "2026-09-07", sunday: "2026-09-13" }, timezone: "UTC", visibleCalendars: [], partialErrors: [], events: [
    { kind: "timed", calendarId: "work", eventId: "meeting", title: "Meeting", calendarColor: { background: "#123456", foreground: null }, googleEventUrl: "https://calendar.google.com/calendar/event?eid=meeting", startAt: "2026-09-07T09:00:00Z", endAt: "2026-09-07T10:00:00Z", startTimeZone: null, endTimeZone: null },
  ] };
  const onCreate = vi.fn();
  const { container } = render(<WeekGrid week={week} now={new Date("2026-09-07T12:00:00Z")} onCreate={onCreate} />);
  const meeting = screen.getByRole("button", { name: /Meeting/ });
  expect(meeting.style.top).toBe("30px");
  expect(meeting.style.height).toBe("30px");
  expect(screen.getByText("9 AM", { selector: ".week-time-labels span" }).style.top).toBe("30px");
  expect((container.querySelector(".week-now") as HTMLElement).style.top).toBe("120px");
  expect(container.querySelector(".week-scroll")?.scrollTop).toBe(0);
  const day = screen.getByLabelText("Add event on 2026-09-07; press Enter for event details");
  day.setPointerCapture = vi.fn(); day.releasePointerCapture = vi.fn();
  vi.spyOn(day, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
  fireEvent.pointerDown(day, { button: 0, pointerId: 1, clientY: 130 });
  fireEvent.pointerMove(day, { pointerId: 1, clientY: 152.5 });
  expect((container.querySelector(".calendar-selection") as HTMLElement).style.height).toBe("30px");
  fireEvent.pointerUp(day, { pointerId: 1 });
  expect(onCreate).toHaveBeenCalledWith({ day: "2026-09-07", startMinute: 540, endMinute: 600 });
});

it("shows only month and year and omits the calendar source legend", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
  try {
    const service = { status: async () => ({ connectionState: "connected" }), week: async (monday: string) => ({
      range: { monday, sunday: "2026-09-06" }, timezone: "UTC", events: [], partialErrors: [],
      visibleCalendars: [{ calendarId: "work", displayName: "Work calendar", color: { background: null, foreground: null }, isVisible: true }],
    }) } as unknown as CalendarService;
    render(<MemoryRouter><CalendarPanel service={service} timezone="UTC" /></MemoryRouter>);
    await screen.findByText("No events this week.");
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeTruthy();
    expect(screen.queryByLabelText("Visible calendars")).toBeNull();
    expect(screen.queryByText("Work calendar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeTruthy();
  } finally { vi.useRealTimers(); }
});

it("hides hours and events before 8 AM but clips events continuing into the visible day", () => {
  const event = { kind: "timed" as const, calendarId: "work", eventId: "early", title: "Early", calendarColor: { background: null, foreground: null }, googleEventUrl: "https://calendar.google.com/calendar/event?eid=early", startAt: "2026-09-07T07:00:00Z", endAt: "2026-09-07T08:00:00Z", startTimeZone: null, endTimeZone: null };
  const week: WeekViewModel = { range: { monday: "2026-09-07", sunday: "2026-09-13" }, timezone: "UTC", visibleCalendars: [], partialErrors: [], events: [event, { ...event, eventId: "overlap", title: "Continues", endAt: "2026-09-07T09:00:00Z" }] };
  render(<WeekGrid week={week} now={new Date("2026-09-07T07:30:00Z")} />);
  expect(screen.queryByRole("button", { name: /Early/ })).toBeNull();
  expect(screen.queryByText("7 AM", { selector: ".week-time-labels span" })).toBeNull();
  expect(screen.getByText("8 AM", { selector: ".week-time-labels span" }).style.top).toBe("0px");
  const ongoing = screen.getByRole("button", { name: /Continues/ });
  expect(ongoing.style.top).toBe("0px");
  expect(ongoing.style.height).toBe("30px");
  expect(screen.queryByLabelText(/Current time/)).toBeNull();
});
