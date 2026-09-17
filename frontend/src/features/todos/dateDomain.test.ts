import { describe, expect, it } from "vitest";

import {
  addSqlDateDays,
  asSqlDate,
  classifyTodoDueDate,
  compareSqlDates,
  isSqlDate,
  localToday,
  parseSqlDate,
  shiftWeekMonday,
  startOfWeekMonday,
  startOfWeekSunday,
  visibleTodoWeekDates,
} from "./dateDomain";

describe("SQL date validation", () => {
  it("accepts strict Gregorian dates and leap years", () => {
    expect(parseSqlDate("0001-01-01")).toEqual({ year: 1, month: 1, day: 1 });
    expect(parseSqlDate("2000-02-29")).toEqual({
      year: 2000,
      month: 2,
      day: 29,
    });
    expect(asSqlDate("9999-12-31")).toBe("9999-12-31");
  });

  it.each([
    "0000-01-01",
    "1900-02-29",
    "2100-02-29",
    "2026-02-29",
    "2026-04-31",
    "2026-00-10",
    "2026-13-10",
    "2026-01-00",
    "2026-1-01",
    "2026-01-1",
    "2026/01/01",
    " 2026-01-01",
    "2026-01-01T00:00:00Z",
  ])("rejects invalid SQL date %s", (value) => {
    expect(isSqlDate(value)).toBe(false);
    expect(() => parseSqlDate(value)).toThrow(RangeError);
  });

  it("rejects non-string inputs", () => {
    expect(isSqlDate(null)).toBe(false);
    expect(isSqlDate(new Date())).toBe(false);
    expect(() => parseSqlDate(20260902)).toThrow(RangeError);
  });
});

describe("date-only arithmetic", () => {
  it("compares dates without involving the host timezone", () => {
    expect(compareSqlDates("2026-01-01", "2025-12-31")).toBe(1);
    expect(compareSqlDates("2026-01-01", "2026-01-01")).toBe(0);
    expect(compareSqlDates("2025-12-31", "2026-01-01")).toBe(-1);
  });

  it("crosses leap-day and year boundaries without shifting dates", () => {
    expect(addSqlDateDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addSqlDateDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(addSqlDateDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addSqlDateDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("treats daylight-saving transition dates as ordinary calendar days", () => {
    expect(addSqlDateDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addSqlDateDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("rejects fractional offsets and calendar overflow", () => {
    expect(() => addSqlDateDays("2026-01-01", 1.5)).toThrow(RangeError);
    expect(() => addSqlDateDays("9999-12-31", 1)).toThrow(RangeError);
  });
});

describe("localToday", () => {
  it("derives New York dates at the spring daylight-saving boundary", () => {
    expect(localToday("America/New_York", new Date("2026-03-08T04:59:59Z"))).toBe("2026-03-07");
    expect(localToday("America/New_York", new Date("2026-03-08T05:00:00Z"))).toBe("2026-03-08");
    expect(localToday("America/New_York", new Date("2026-03-09T03:59:59Z"))).toBe("2026-03-08");
    expect(localToday("America/New_York", new Date("2026-03-09T04:00:00Z"))).toBe("2026-03-09");
  });

  it("derives New York dates at the fall daylight-saving boundary", () => {
    expect(localToday("America/New_York", new Date("2026-11-01T03:59:59Z"))).toBe("2026-10-31");
    expect(localToday("America/New_York", new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
    expect(localToday("America/New_York", new Date("2026-11-02T04:59:59Z"))).toBe("2026-11-01");
    expect(localToday("America/New_York", new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
  });

  it("handles opposite sides of the date line and a year boundary", () => {
    const instant = new Date("2026-12-31T12:30:00Z");
    expect(localToday("Pacific/Kiritimati", instant)).toBe("2027-01-01");
    expect(localToday("Etc/GMT+12", instant)).toBe("2026-12-31");
  });

  it("rejects invalid timezones and invalid instants", () => {
    expect(() => localToday("Not/A_Timezone", new Date())).toThrow(RangeError);
    expect(() => localToday("", new Date())).toThrow(RangeError);
    expect(() => localToday(" America/New_York", new Date())).toThrow(RangeError);
    expect(() => localToday("UTC", new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("Monday-through-Sunday weeks", () => {
  it("finds week bounds from a midweek date", () => {
    expect(startOfWeekMonday("2026-09-02")).toBe("2026-08-31");
    expect(startOfWeekMonday("2026-09-06")).toBe("2026-08-31");
  });

  it("handles weeks spanning a year boundary", () => {
    expect(startOfWeekMonday("2026-12-31")).toBe("2026-12-28");
    expect(shiftWeekMonday("2026-12-28", 1)).toBe("2027-01-04");
    expect(shiftWeekMonday("2026-12-28", -1)).toBe("2026-12-21");
  });

  it("requires week navigation to start from a Monday", () => {
    expect(() => shiftWeekMonday("2026-09-02", 1)).toThrow(RangeError);
    expect(() => shiftWeekMonday("2026-08-31", 0.5)).toThrow(RangeError);
  });
});

describe("full Todos board date visibility", () => {
  it("shows today through Sunday for the current week", () => {
    expect(visibleTodoWeekDates("2026-08-31", "2026-09-02")).toEqual([
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });

  it("shows only Sunday when today is Sunday", () => {
    expect(visibleTodoWeekDates("2026-08-31", "2026-09-06")).toEqual(["2026-09-06"]);
  });

  it.each([
    ["2026-08-24", "a previous"],
    ["2026-09-07", "a next"],
  ])("shows all Monday-through-Sunday dates for %s week", (monday) => {
    expect(visibleTodoWeekDates(monday, "2026-09-02")).toEqual([
      monday,
      addSqlDateDays(monday, 1),
      addSqlDateDays(monday, 2),
      addSqlDateDays(monday, 3),
      addSqlDateDays(monday, 4),
      addSqlDateDays(monday, 5),
      addSqlDateDays(monday, 6),
    ]);
  });

  it("rejects a visible-week value that is not Monday", () => {
    expect(() => visibleTodoWeekDates("2026-09-01", "2026-09-02")).toThrow(RangeError);
  });
});

describe("Todo due-date classification", () => {
  const today = "2026-09-02";

  it("classifies Inbox, overdue, today, and future dates", () => {
    expect(classifyTodoDueDate(null, today)).toBe("inbox");
    expect(classifyTodoDueDate(undefined, today)).toBe("inbox");
    expect(classifyTodoDueDate("2026-09-01", today)).toBe("overdue");
    expect(classifyTodoDueDate(today, today)).toBe("today");
    expect(classifyTodoDueDate("2026-09-03", today)).toBe("future");
  });

  it("does not silently accept malformed due dates or local dates", () => {
    expect(() => classifyTodoDueDate("2026-02-30", today)).toThrow(RangeError);
    expect(() => classifyTodoDueDate(null, "2026-02-30")).toThrow(RangeError);
    expect(() => classifyTodoDueDate("", today)).toThrow(RangeError);
  });
});

describe("startOfWeekSunday", () => {
  it.each([
    ["2026-09-13", "2026-09-13"],
    ["2026-09-14", "2026-09-13"],
    ["2026-09-19", "2026-09-13"],
    ["2026-09-01", "2026-08-30"],
    ["2026-01-01", "2025-12-28"],
  ])("starts the week containing %s on Sunday %s", (date, sunday) => {
    expect(startOfWeekSunday(date)).toBe(sunday);
  });
});
