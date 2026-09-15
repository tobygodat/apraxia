const SQL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

declare const sqlDateBrand: unique symbol;

/** A validated, date-only value in the same shape as a Postgres `date`. */
export type SqlDate = string & { readonly [sqlDateBrand]: true };

export interface SqlDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export type TodoDueDateClassification = "inbox" | "overdue" | "today" | "future";

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/**
 * Parse an application date without allowing JavaScript to interpret it in a
 * machine-local timezone. Years are limited to the four-digit Gregorian range.
 */
export function parseSqlDate(value: unknown): SqlDateParts {
  if (typeof value !== "string") {
    throw new RangeError("SQL date must be a string in YYYY-MM-DD format.");
  }

  const match = SQL_DATE_PATTERN.exec(value);
  if (!match) {
    throw new RangeError("SQL date must use strict YYYY-MM-DD format.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1 || year > 9999) {
    throw new RangeError("SQL date year must be between 0001 and 9999.");
  }
  if (month < 1 || month > 12) {
    throw new RangeError("SQL date month is outside the Gregorian calendar.");
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError("SQL date day is outside the Gregorian calendar.");
  }

  return { year, month, day };
}

export function isSqlDate(value: unknown): value is SqlDate {
  try {
    parseSqlDate(value);
    return true;
  } catch {
    return false;
  }
}

export function asSqlDate(value: string): SqlDate {
  parseSqlDate(value);
  return value as SqlDate;
}

function utcDateFromSqlDate(value: string): Date {
  const { year, month, day } = parseSqlDate(value);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  // setUTCFullYear avoids Date.UTC's special handling of years 0 through 99.
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function sqlDateFromUtcDate(date: Date): SqlDate {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Date arithmetic exceeded the supported calendar range.");
  }

  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) {
    throw new RangeError("Date arithmetic exceeded the four-digit SQL date range.");
  }

  return asSqlDate(
    `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(
      2,
      "0",
    )}-${String(date.getUTCDate()).padStart(2, "0")}`,
  );
}

export function compareSqlDates(left: string, right: string): -1 | 0 | 1 {
  const leftTime = utcDateFromSqlDate(left).getTime();
  const rightTime = utcDateFromSqlDate(right).getTime();

  if (leftTime < rightTime) return -1;
  if (leftTime > rightTime) return 1;
  return 0;
}

export function addSqlDateDays(value: string, days: number): SqlDate {
  if (!Number.isSafeInteger(days)) {
    throw new RangeError("Date offset must be a safe integer number of days.");
  }

  const date = utcDateFromSqlDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return sqlDateFromUtcDate(date);
}

/** Return the date at `now` in an IANA timezone. */
export function localToday(timeZone: string, now: Date = new Date()): SqlDate {
  if (!timeZone || timeZone !== timeZone.trim()) {
    throw new RangeError("Timezone must be a non-empty IANA timezone name.");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new RangeError("Current time must be a valid Date instant.");
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en", {
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
  }

  const parts = formatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((candidate) => candidate.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");

  if (!year || !month || !day) {
    throw new RangeError("Unable to derive a local date for the timezone.");
  }

  return asSqlDate(`${year.padStart(4, "0")}-${month}-${day}`);
}

export function startOfWeekMonday(value: string): SqlDate {
  const date = utcDateFromSqlDate(value);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addSqlDateDays(value, -daysSinceMonday);
}

function assertMonday(value: string): SqlDate {
  const date = asSqlDate(value);
  if (startOfWeekMonday(date) !== date) {
    throw new RangeError("Visible week date must be a Monday.");
  }
  return date;
}

export function shiftWeekMonday(visibleWeekMonday: string, offsetWeeks: number): SqlDate {
  const monday = assertMonday(visibleWeekMonday);
  if (!Number.isSafeInteger(offsetWeeks)) {
    throw new RangeError("Week offset must be a safe integer.");
  }

  const offsetDays = offsetWeeks * 7;
  if (!Number.isSafeInteger(offsetDays)) {
    throw new RangeError("Week offset is outside the supported range.");
  }

  return addSqlDateDays(monday, offsetDays);
}

function inclusiveDateRange(start: string, end: string): SqlDate[] {
  const startDate = utcDateFromSqlDate(start);
  const endDate = utcDateFromSqlDate(end);
  const dayCount = (endDate.getTime() - startDate.getTime()) / MILLISECONDS_PER_DAY;

  if (!Number.isSafeInteger(dayCount) || dayCount < 0) {
    throw new RangeError("Date range end must be on or after its start.");
  }

  return Array.from({ length: dayCount + 1 }, (_, index) => addSqlDateDays(start, index));
}

/**
 * Dates shown by the full Todos board. The current week starts at today;
 * every other selected week shows all seven Monday-through-Sunday dates.
 */
export function visibleTodoWeekDates(visibleWeekMonday: string, today: string): SqlDate[] {
  const monday = assertMonday(visibleWeekMonday);
  const validToday = asSqlDate(today);
  const currentWeekMonday = startOfWeekMonday(validToday);
  const start = monday === currentWeekMonday ? validToday : monday;
  const sunday = addSqlDateDays(monday, 6);
  return inclusiveDateRange(start, sunday);
}

export function classifyTodoDueDate(
  dueDate: string | null | undefined,
  today: string,
): TodoDueDateClassification {
  const validToday = asSqlDate(today);
  if (dueDate === null || dueDate === undefined) return "inbox";

  const comparison = compareSqlDates(dueDate, validToday);
  if (comparison < 0) return "overdue";
  if (comparison === 0) return "today";
  return "future";
}
