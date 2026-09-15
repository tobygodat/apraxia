import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  CalendarEvent,
  CalendarPreference,
  GoogleCalendarConnectionStatus,
  NewIdeaInput,
  NewMediaInput,
  NewProjectInput,
  NewTodoInput,
  ProjectSummary,
  TodayTodo,
  WeekViewModel,
} from "./domain";

describe("shared domain contracts", () => {
  it("keeps all-day dates distinct from timed timestamps", () => {
    const allDayEvent = {
      kind: "all_day",
      eventId: "event-all-day",
      calendarId: "primary",
      title: "Away",
      startDate: "2026-09-07",
      endDateExclusive: "2026-09-09",
      calendarColor: { background: "#1a73e8", foreground: "#ffffff" },
      googleEventUrl: "https://calendar.google.com/calendar/event?eid=one",
    } satisfies CalendarEvent;

    const timedEvent = {
      kind: "timed",
      eventId: "event-timed",
      calendarId: "primary",
      title: "Appointment",
      startAt: "2026-09-08T09:00:00-04:00",
      endAt: "2026-09-08T09:30:00-04:00",
      startTimeZone: "America/New_York",
      endTimeZone: "America/New_York",
      calendarColor: { background: "#188038", foreground: "#ffffff" },
      googleEventUrl: "https://calendar.google.com/calendar/event?eid=two",
    } satisfies CalendarEvent;

    expect(allDayEvent.kind).toBe("all_day");
    expect(timedEvent.kind).toBe("timed");
    expectTypeOf(allDayEvent).not.toHaveProperty("startAt");
    expectTypeOf(timedEvent).not.toHaveProperty("startDate");
  });

  it("models one inclusive Sunday-through-Saturday week with partial results", () => {
    const week = {
      range: { sunday: "2026-09-06", saturday: "2026-09-12" },
      timezone: "America/New_York",
      events: [],
      visibleCalendars: [
        {
          calendarId: "primary",
          displayName: "Personal",
          color: { background: "#1a73e8", foreground: "#ffffff" },
          isVisible: true,
        },
      ],
      partialErrors: [
        {
          calendarId: "secondary",
          calendarDisplayName: "Birthdays",
          code: "calendar_unavailable",
          userMessage: "Birthdays could not be loaded.",
          retryable: true,
        },
      ],
    } satisfies WeekViewModel;

    expect(week.range).toEqual({
      sunday: "2026-09-06",
      saturday: "2026-09-12",
    });
    expect(week.visibleCalendars[0]?.isVisible).toBe(true);
    expect(week.partialErrors).toHaveLength(1);
  });

  it("makes Today completion state an explicit invariant", () => {
    const todo = {
      id: "87d45aa9-0012-4fea-8ee5-e394cb159bf7",
      text: "Renew passport",
      completed: false,
      completedAt: null,
      dueDate: "2026-09-02",
      dueTime: null,
      projectId: null,
      projectTitle: null,
      todayRank: null,
      isOverdue: false,
      isManuallyOrdered: false,
      createdAt: "2026-09-01T14:00:00Z",
      updatedAt: "2026-09-01T14:00:00Z",
    } satisfies TodayTodo;

    expect(todo.completed).toBe(false);
    expect(todo.completedAt).toBeNull();
  });

  it("excludes a time-without-date create request", () => {
    expectTypeOf<{ text: "Invalid"; dueTime: "09:00" }>().not.toMatchTypeOf<NewTodoInput>();
  });

  it("does not allow browser create inputs to choose an owner", () => {
    type HasUserId<T> = "userId" extends keyof T ? true : false;

    expectTypeOf<HasUserId<NewTodoInput>>().toEqualTypeOf<false>();
    expectTypeOf<HasUserId<NewIdeaInput>>().toEqualTypeOf<false>();
    expectTypeOf<HasUserId<NewMediaInput>>().toEqualTypeOf<false>();
    expectTypeOf<HasUserId<NewProjectInput>>().toEqualTypeOf<false>();
  });

  it("keeps user ownership and Google credentials out of browser contracts", () => {
    type ForbiddenConnectionKey = Extract<
      keyof GoogleCalendarConnectionStatus,
      "userId" | "accessToken" | "refreshToken" | "encryptedRefreshToken"
    >;

    expectTypeOf<ForbiddenConnectionKey>().toEqualTypeOf<never>();
    expectTypeOf<"userId" extends keyof CalendarPreference ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<ProjectSummary>().toEqualTypeOf<{
      id: string;
      title: string;
    }>();
  });
});
