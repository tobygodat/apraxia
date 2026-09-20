// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { CalendarService } from "./calendarService";
import type { TodoService } from "../todos/todoService";
import { CalendarPanel, HomePage, WeekGrid } from "./HomePage";
import type { AllDayCalendarEvent, CalendarEvent, WeekViewModel } from "../../types/domain";
import { addSqlDateDays } from "../todos/dateDomain";
import { cacheNavigationService, NavigationCache } from "../../apps/navigationCache";
import { ColdLoadGate } from "../../apps/coldLoad";
afterEach(cleanup);
it("loads Sunday through Saturday in the profile timezone and keeps navigation and Today aligned", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-13T04:30:00Z"));
  try {
    const week = vi.fn(async (sunday: string): Promise<WeekViewModel> => ({
      range: { sunday, saturday: addSqlDateDays(sunday, 6) },
      timezone: "America/New_York",
      events: [],
      partialErrors: [],
      visibleCalendars: [],
    }));
    const service = {
      status: async () => ({ connectionState: "connected" }),
      week,
    } as unknown as CalendarService;
    const { container } = render(
      <MemoryRouter>
        <CalendarPanel service={service} timezone="America/New_York" />
      </MemoryRouter>,
    );
    await screen.findByLabelText("Current time: 12:30 AM");
    expect(week.mock.calls[0]?.[0]).toBe("2026-09-13");
    expect(
      Array.from(
        container.querySelectorAll(".week-head .week-days > div"),
        (day) => day.textContent,
      ),
      // Today is the one day named in words as well as marked.
    ).toEqual(["Sun13today", "Mon14", "Tue15", "Wed16", "Thu17", "Fri18", "Sat19"]);
    expect(
      container
        .querySelector(".week-head .week-days > div:first-child")
        ?.getAttribute("aria-current"),
    ).toBe("date");
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(week.mock.lastCall?.[0]).toBe("2026-09-06"));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(week.mock.lastCall?.[0]).toBe("2026-09-13"));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(week.mock.lastCall?.[0]).toBe("2026-09-20"));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await screen.findByLabelText("Current time: 12:30 AM");
    expect(week.mock.lastCall?.[0]).toBe("2026-09-13");
  } finally {
    vi.useRealTimers();
  }
});

it("uses one, two or three clipped rows with time and location in the requested order", () => {
  const events: CalendarEvent[] = [15, 50, 75, 180].map((minutes, index) => ({
    kind: "timed",
    calendarId: "personal",
    eventId: String(index),
    title: `A complete event title for a ${minutes} minute appointment`,
    ...(minutes < 180 ? { location: "Hall 204" } : {}),
    calendarColor: { background: "#0b8043", foreground: null },
    googleEventUrl: "https://calendar.google.com",
    startAt: `2026-09-${String(7 + index).padStart(2, "0")}T09:00:00Z`,
    endAt: new Date(Date.UTC(2026, 8, 7 + index, 9, minutes)).toISOString(),
    startTimeZone: null,
    endTimeZone: null,
  }));
  const week: WeekViewModel = {
    range: { sunday: "2026-09-06", saturday: "2026-09-12" },
    timezone: "UTC",
    visibleCalendars: [],
    partialErrors: [],
    events,
  };
  render(<WeekGrid week={week} now={new Date("2026-09-07T12:00:00Z")} />);
  const rows = [1, 2, 3, 3];
  const details = [[], ["9am, Hall 204"], ["9 – 10:15am", "Hall 204"], ["9am – 12pm"]];
  for (const [index, event] of events.entries()) {
    const card = screen.getByRole("button", { name: new RegExp(event.title) });
    expect(card.querySelector("strong")?.textContent?.trim()).toBe(event.title);
    expect(card.classList.contains(`calendar-event--rows-${rows[index]}`)).toBe(true);
    if (index === 0) expect(card.textContent).toBe(`${event.title}, 9am, Hall 204`);
    else
      expect([...card.children].slice(1).map((child) => child.textContent)).toEqual(details[index]);
    expect(card.getAttribute("title")).toContain(event.title);
    fireEvent.click(card);
    expect(screen.getByRole("heading", { name: event.title })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  }
});

it("marks an event named Work, and leaves every other name alone", () => {
  const titles = ["Work", "  work  ", "Work on the thesis", "Homework"];
  const events: CalendarEvent[] = titles.map((title, index) => ({
    kind: "timed",
    calendarId: "personal",
    eventId: String(index),
    title,
    calendarColor: { background: "#0b8043", foreground: null },
    googleEventUrl: "https://calendar.google.com",
    startAt: `2026-09-${String(7 + index).padStart(2, "0")}T09:00:00Z`,
    endAt: `2026-09-${String(7 + index).padStart(2, "0")}T10:00:00Z`,
    startTimeZone: null,
    endTimeZone: null,
  }));
  const week: WeekViewModel = {
    range: { sunday: "2026-09-06", saturday: "2026-09-12" },
    timezone: "UTC",
    visibleCalendars: [],
    partialErrors: [],
    events,
  };
  const { container } = render(<WeekGrid week={week} now={new Date("2026-09-07T12:00:00Z")} />);
  // One event per day, in day order, so the rendered order is the list's own.
  const cards = [...container.querySelectorAll(".calendar-event--timed")];
  expect(cards.map((card) => card.querySelector("strong")?.textContent)).toEqual(titles);
  // The whole title has to be the word, so a shift is marked and a task that
  // merely mentions work is not.
  expect(cards.map((card) => card.classList.contains("calendar-event--work"))).toEqual([
    true,
    true,
    false,
    false,
  ]);
});

it("prints the current time on the line it marks rather than in the hour gutter", () => {
  const week: WeekViewModel = {
    range: { sunday: "2026-09-06", saturday: "2026-09-12" },
    timezone: "UTC",
    visibleCalendars: [],
    partialErrors: [],
    events: [],
  };
  const { container } = render(<WeekGrid week={week} now={new Date("2026-09-07T15:48:00Z")} />);
  const line = container.querySelector(".week-now");
  expect(line?.getAttribute("aria-label")).toBe("Current time: 3:48 PM");
  expect(line?.querySelector(".week-now__label")?.textContent).toBe("now · 3:48 PM");
});

it("opens a full preview for timed and all-day events and keeps Google navigation explicit", () => {
  const events: CalendarEvent[] = [
    {
      kind: "all_day",
      calendarId: "work",
      eventId: "trip",
      title: "Studio week",
      calendarColor: { background: "#c5b293", foreground: null },
      googleEventUrl: "https://calendar.google.com/calendar/event?eid=trip",
      startDate: "2026-09-07",
      endDateExclusive: "2026-09-09",
    },
    {
      kind: "timed",
      calendarId: "personal",
      eventId: "coffee",
      title: "Coffee",
      calendarColor: { background: "#91b0d7", foreground: null },
      googleEventUrl: "https://calendar.google.com/calendar/event?eid=coffee",
      startAt: "2026-09-07T09:00:00Z",
      endAt: "2026-09-07T10:00:00Z",
      startTimeZone: null,
      endTimeZone: null,
    },
  ];
  const week: WeekViewModel = {
    range: { sunday: "2026-09-06", saturday: "2026-09-12" },
    timezone: "UTC",
    visibleCalendars: [],
    partialErrors: [],
    events,
  };
  const now = new Date("2026-09-07T12:00:00Z");
  render(<WeekGrid week={week} now={now} />);
  for (const event of events) {
    const anchor = screen.getByRole("button", { name: new RegExp(event.title) });
    expect(anchor.style.getPropertyValue("--calendar-event-color")).toBe(
      event.calendarColor.background,
    );
    fireEvent.click(anchor);
    expect(screen.getByRole("dialog", { name: "Event details" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: event.title })).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open in Google Calendar" });
    expect(link.getAttribute("href")).toBe(event.googleEventUrl);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  }
});
it("loads Today while Calendar status is still pending", async () => {
  const loadToday = vi.fn(async () => []);
  const calendar = { status: () => new Promise(() => {}) } as unknown as CalendarService;
  render(
    <MemoryRouter>
      <HomePage
        todoService={{ loadToday } as unknown as TodoService}
        calendarService={calendar}
        profile={{ userId: "user", timezone: "UTC", createdAt: "", updatedAt: "" }}
        projects={[]}
        workspaceSessionKey="session"
      />
    </MemoryRouter>,
  );
  await waitFor(() => expect(loadToday).toHaveBeenCalled());
  expect(screen.getByText("Loading your week…")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
});
it("stays cold-load pending until the week resolves, then reveals", async () => {
  let resolveWeek: ((week: WeekViewModel) => void) | undefined;
  const service = {
    status: async () => ({ connectionState: "connected" }),
    week: () =>
      new Promise<WeekViewModel>((resolve) => {
        resolveWeek = resolve;
      }),
  } as unknown as CalendarService;
  const { container } = render(
    <MemoryRouter>
      <ColdLoadGate>
        <CalendarPanel service={service} timezone="UTC" />
      </ColdLoadGate>
    </MemoryRouter>,
  );
  expect(container.querySelector(".cold-load")?.getAttribute("data-cold")).toBe("true");
  resolveWeek?.({
    range: { sunday: "2026-09-06", saturday: "2026-09-12" },
    timezone: "UTC",
    events: [],
    partialErrors: [],
    visibleCalendars: [],
  });
  await waitFor(() =>
    expect(container.querySelector(".cold-load")?.getAttribute("data-cold")).toBeNull(),
  );
});

it("preserves a loaded week on refresh failure, then hides it when navigating", async () => {
  const week = vi.fn(async (sunday: string) => ({
    range: { sunday, saturday: sunday },
    timezone: "UTC",
    visibleCalendars: [],
    partialErrors: [],
    events: [
      {
        kind: "timed",
        calendarId: "primary",
        eventId: "event",
        title: "Coffee with Sam",
        startAt: `${sunday}T09:00:00Z`,
        endAt: `${sunday}T10:00:00Z`,
        startTimeZone: null,
        endTimeZone: null,
        calendarColor: { background: null, foreground: null },
        googleEventUrl: "https://calendar.google.com",
      },
    ],
  }));
  const service = {
    status: async () => ({ connectionState: "connected" }),
    week,
  } as unknown as CalendarService;
  render(
    <MemoryRouter>
      <CalendarPanel service={service} timezone="UTC" />
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: /Coffee with Sam/ });
  expect(screen.queryByText("All day")).toBeNull();
  week.mockRejectedValueOnce(new Error("Calendar is unavailable."));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText(/Showing your last loaded events/);
  expect(screen.getByRole("button", { name: /Coffee with Sam/ })).toBeTruthy();
  week.mockImplementationOnce(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Next week" }));
  expect(screen.queryByRole("button", { name: /Coffee with Sam/ })).toBeNull();
});

it("renders a warmed week immediately from a navigation cache with no loading flash", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
  try {
    const week = vi.fn(async (sunday: string): Promise<WeekViewModel> => ({
      range: { sunday, saturday: addSqlDateDays(sunday, 6) },
      timezone: "UTC",
      events: [
        {
          kind: "timed",
          calendarId: "primary",
          eventId: "event",
          title: "Coffee with Sam",
          startAt: `${sunday}T09:00:00Z`,
          endAt: `${sunday}T10:00:00Z`,
          startTimeZone: null,
          endTimeZone: null,
          calendarColor: { background: null, foreground: null },
          googleEventUrl: "https://calendar.google.com",
        },
      ],
      partialErrors: [],
      visibleCalendars: [],
    }));
    const source = {
      status: async () => ({ connectionState: "connected" }),
      week,
    } as unknown as CalendarService;
    const cache = new NavigationCache();
    const service = cacheNavigationService(
      source,
      cache,
      "calendar",
      ["status", "week"],
      [],
    ) as unknown as CalendarService;
    // Warm the cache the way an earlier navigation to this week would.
    await service.status();
    await service.week("2026-09-06");
    render(
      <MemoryRouter>
        <CalendarPanel service={service} timezone="UTC" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /Coffee with Sam/ })).toBeTruthy();
    expect(screen.queryByText("Loading your week…")).toBeNull();
    expect(screen.queryByText("Refreshing your week…")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("does not seed a week cached under a different timezone", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
  try {
    const week = vi.fn(async (sunday: string): Promise<WeekViewModel> => ({
      range: { sunday, saturday: addSqlDateDays(sunday, 6) },
      timezone: "America/New_York",
      events: [],
      partialErrors: [],
      visibleCalendars: [],
    }));
    const source = {
      status: async () => ({ connectionState: "connected" }),
      week,
    } as unknown as CalendarService;
    const cache = new NavigationCache();
    const service = cacheNavigationService(
      source,
      cache,
      "calendar",
      ["status", "week"],
      [],
    ) as unknown as CalendarService;
    // Warm the cache for the same sunday but a different timezone.
    await service.status();
    await service.week("2026-09-06");
    render(
      <MemoryRouter>
        <CalendarPanel service={service} timezone="UTC" />
      </MemoryRouter>,
    );
    // The seeded week is for a different timezone, so it must not be shown;
    // the panel should load instead of flashing the wrong week's data.
    expect(screen.getByText("Loading your week…")).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

it("never shows Refreshing your week during an invalidation-driven revision bump, and keeps the week rendered", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
  try {
    let resolveSecond: ((week: WeekViewModel) => void) | undefined;
    let call = 0;
    const visibleCalendars = [
      {
        calendarId: "work",
        displayName: "Work calendar",
        color: { background: null, foreground: null },
        isVisible: true,
      },
    ] as const;
    const week = vi.fn(async (sunday: string): Promise<WeekViewModel> => {
      call += 1;
      if (call === 1) {
        return {
          range: { sunday, saturday: addSqlDateDays(sunday, 6) },
          timezone: "UTC",
          events: [],
          partialErrors: [],
          visibleCalendars,
        };
      }
      return new Promise((resolve) => {
        resolveSecond = resolve;
      });
    });
    const source = {
      status: async () => ({ connectionState: "connected" }),
      week,
    } as unknown as CalendarService;
    const cache = new NavigationCache();
    const service = cacheNavigationService(
      source,
      cache,
      "calendar",
      ["status", "week"],
      [],
    ) as unknown as CalendarService;
    await service.status();
    await service.week("2026-09-06");
    render(
      <MemoryRouter>
        <CalendarPanel service={{ ...service, invalidate: cache.invalidate }} timezone="UTC" />
      </MemoryRouter>,
    );
    await screen.findByText("No events this week.");
    expect(screen.queryByText("Refreshing your week…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    // Background refresh with a visible week is silent: no "Refreshing your
    // week…" message, and the previously loaded week stays on screen while
    // the refetch is in flight.
    await waitFor(() => expect(resolveSecond).toBeDefined());
    expect(screen.queryByText("Refreshing your week…")).toBeNull();
    expect(screen.getByText("No events this week.")).toBeTruthy();
    resolveSecond?.({
      range: { sunday: "2026-09-06", saturday: "2026-09-12" },
      timezone: "UTC",
      events: [],
      partialErrors: [],
      visibleCalendars,
    });
    await waitFor(() => expect(screen.queryByText("Refreshing your week…")).toBeNull());
  } finally {
    vi.useRealTimers();
  }
});

it("shows the all-day row only while an all-day event overlaps the displayed week", () => {
  const event: AllDayCalendarEvent = {
    kind: "all_day",
    calendarId: "primary",
    eventId: "trip",
    title: "Trip",
    calendarColor: { background: null, foreground: null },
    googleEventUrl: "https://calendar.google.com",
    startDate: "2026-08-30",
    endDateExclusive: "2026-09-02",
  };
  const week: WeekViewModel = {
    range: { sunday: "2026-08-30", saturday: "2026-09-05" },
    timezone: "UTC",
    visibleCalendars: [],
    partialErrors: [],
    events: [],
  };
  const now = new Date("2026-09-05T12:00:00Z");
  const { rerender } = render(<WeekGrid week={week} now={now} />);
  expect(screen.queryByText("All day")).toBeNull();

  rerender(<WeekGrid week={{ ...week, events: [event] }} now={now} />);
  expect(screen.getByText("All day")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Trip, all day/ })).toBeTruthy();

  rerender(
    <WeekGrid
      week={{ ...week, events: [event], range: { sunday: "2026-09-06", saturday: "2026-09-12" } }}
      now={now}
    />,
  );
  expect(screen.queryByText("All day")).toBeNull();
  expect(screen.queryByRole("button", { name: /Trip, all day/ })).toBeNull();
});

it("scales events, hour labels, current time, initial scroll and drag creation together", () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1440);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
  const week: WeekViewModel = {
    range: { sunday: "2026-09-06", saturday: "2026-09-12" },
    timezone: "UTC",
    visibleCalendars: [],
    partialErrors: [],
    events: [
      {
        kind: "timed",
        calendarId: "work",
        eventId: "meeting",
        title: "Meeting",
        calendarColor: { background: "#123456", foreground: null },
        googleEventUrl: "https://calendar.google.com/calendar/event?eid=meeting",
        startAt: "2026-09-07T09:00:00Z",
        endAt: "2026-09-07T10:00:00Z",
        startTimeZone: null,
        endTimeZone: null,
      },
    ],
  };
  const onCreate = vi.fn();
  const { container } = render(
    <WeekGrid week={week} now={new Date("2026-09-07T12:00:00Z")} onCreate={onCreate} />,
  );
  const meeting = screen.getByRole("button", { name: /Meeting/ });
  expect(meeting.style.top).toBe("540px");
  expect(meeting.style.height).toBe("58px");
  expect(screen.getByText("9 AM", { selector: ".week-time-labels span" }).style.top).toBe("540px");
  expect((container.querySelector(".week-now") as HTMLElement).style.top).toBe("720px");
  expect(container.querySelector(".week-scroll")?.scrollTop).toBe(540);
  const day = screen.getByLabelText("Add event on 2026-09-07; press Enter for event details");
  day.setPointerCapture = vi.fn();
  day.releasePointerCapture = vi.fn();
  vi.spyOn(day, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
  fireEvent.pointerDown(day, { button: 0, pointerId: 1, clientY: 640 });
  fireEvent.pointerMove(day, { pointerId: 1, clientY: 685 });
  expect((container.querySelector(".calendar-selection") as HTMLElement).style.height).toBe("60px");
  fireEvent.pointerUp(day, { pointerId: 1 });
  expect(onCreate).toHaveBeenCalledWith({ day: "2026-09-07", startMinute: 540, endMinute: 600 });
});

it("shows only month and year and omits the calendar source legend", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
  try {
    const service = {
      status: async () => ({ connectionState: "connected" }),
      week: async (sunday: string) => ({
        range: { sunday, saturday: "2026-09-05" },
        timezone: "UTC",
        events: [],
        partialErrors: [],
        visibleCalendars: [
          {
            calendarId: "work",
            displayName: "Work calendar",
            color: { background: null, foreground: null },
            isVisible: true,
          },
        ],
      }),
    } as unknown as CalendarService;
    render(
      <MemoryRouter>
        <CalendarPanel service={service} timezone="UTC" />
      </MemoryRouter>,
    );
    await screen.findByText("No events this week.");
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeTruthy();
    expect(screen.queryByLabelText("Visible calendars")).toBeNull();
    expect(screen.queryByText("Work calendar")).toBeNull();
    // The footer says where the week's hours are kept.
    expect(screen.getByText("UTC")).toBeTruthy();
    // The arrows belong to Today, so one group moves the week.
    const actions = [...document.querySelectorAll(".calendar-toolbar-actions > button")].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );
    expect(actions.slice(0, 3)).toEqual(["Previous week", "Today", "Next week"]);
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

it("includes early events and the current-time marker before 8 AM", () => {
  const event = {
    kind: "timed" as const,
    calendarId: "work",
    eventId: "early",
    title: "Early",
    calendarColor: { background: null, foreground: null },
    googleEventUrl: "https://calendar.google.com/calendar/event?eid=early",
    startAt: "2026-09-07T07:00:00Z",
    endAt: "2026-09-07T08:00:00Z",
    startTimeZone: null,
    endTimeZone: null,
  };
  const week: WeekViewModel = {
    range: { sunday: "2026-09-06", saturday: "2026-09-12" },
    timezone: "UTC",
    visibleCalendars: [],
    partialErrors: [],
    events: [
      event,
      { ...event, eventId: "overlap", title: "Continues", endAt: "2026-09-07T09:00:00Z" },
    ],
  };
  render(<WeekGrid week={week} now={new Date("2026-09-07T07:30:00Z")} />);
  expect(screen.getByRole("button", { name: /Early/ })).toBeTruthy();
  expect(screen.getByText("7 AM", { selector: ".week-time-labels span" })).toBeTruthy();
  expect(screen.getByText("8 AM", { selector: ".week-time-labels span" }).style.top).toBe("240px");
  const ongoing = screen.getByRole("button", { name: /Continues/ });
  expect(ongoing.style.top).toBe("210px");
  expect(ongoing.style.height).toBe("58px");
  expect(screen.getByLabelText(/Current time: 7:30 AM/)).toBeTruthy();
});

it("keeps an overnight event accessible when only its final minute falls in this week", () => {
  const week: WeekViewModel = {
    range: { sunday: "2026-09-06", saturday: "2026-09-12" },
    timezone: "UTC",
    visibleCalendars: [],
    partialErrors: [],
    events: [
      {
        kind: "timed",
        calendarId: "personal",
        eventId: "clipped",
        title: "Early shift",
        calendarColor: { background: null, foreground: null },
        googleEventUrl: "https://calendar.google.com",
        startAt: "2026-09-05T23:00:00Z",
        endAt: "2026-09-06T00:01:00Z",
        startTimeZone: null,
        endTimeZone: null,
      },
    ],
  };
  render(<WeekGrid week={week} now={new Date("2026-09-07T12:00:00Z")} />);
  const card = screen.getByRole("button", { name: /Early shift, 11:00 PM–12:01 AM/ });
  expect(card.style.top).toBe("0px");
  expect(Number.parseFloat(card.style.height)).toBeGreaterThan(0);
  fireEvent.click(card);
  expect(screen.getByRole("heading", { name: "Early shift" })).toBeTruthy();
});

it("clamps late-night scrolling at midnight and preserves manual scrolling until Today is requested", () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(720);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  const week: WeekViewModel = {
    range: { sunday: "2026-09-06", saturday: "2026-09-12" },
    timezone: "America/New_York",
    visibleCalendars: [],
    partialErrors: [],
    events: [],
  };
  const { rerender } = render(<WeekGrid week={week} now={new Date("2026-09-08T03:50:00Z")} />);
  const viewport = screen.getByLabelText("Calendar grid from midnight to midnight");
  expect(viewport.scrollTop).toBe(420);
  expect(screen.getByLabelText("Current time: 11:50 PM")).toBeTruthy();
  viewport.scrollTop = 100;
  rerender(<WeekGrid week={{ ...week }} now={new Date("2026-09-08T03:51:00Z")} />);
  expect(viewport.scrollTop).toBe(100);
  rerender(<WeekGrid week={week} now={new Date("2026-09-08T03:51:00Z")} scrollRevision={1} />);
  expect(viewport.scrollTop).toBe(420);
});
it("puts the task panel ahead of the calendar on a phone, and behind it otherwise", async () => {
  const loadToday = vi.fn(async () => []);
  const calendar = { status: () => new Promise(() => {}) } as unknown as CalendarService;
  const home = (
    <MemoryRouter>
      <HomePage
        todoService={{ loadToday } as unknown as TodoService}
        calendarService={calendar}
        profile={{ userId: "user", timezone: "UTC", createdAt: "", updatedAt: "" }}
        projects={[]}
        workspaceSessionKey="session"
      />
    </MemoryRouter>
  );
  const panelOrder = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(".today-panel, .calendar-panel"), (panel) =>
      panel.classList.contains("today-panel") ? "today" : "calendar",
    );

  const desktop = render(home);
  await waitFor(() => expect(loadToday).toHaveBeenCalled());
  expect(panelOrder(desktop.container)).toEqual(["calendar", "today"]);
  desktop.unmount();

  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({
      matches: media === "(max-width: 620px)",
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  try {
    const phone = render(home);
    await waitFor(() => expect(phone.container.querySelector(".today-panel")).toBeTruthy());
    // Reading order, not just painting order: a phone stacks these, so what is
    // due today has to come first in the markup as well.
    expect(panelOrder(phone.container)).toEqual(["today", "calendar"]);
    expect(phone.container.querySelector(".home-workspace--phone")).toBeTruthy();
  } finally {
    vi.unstubAllGlobals();
  }
});
