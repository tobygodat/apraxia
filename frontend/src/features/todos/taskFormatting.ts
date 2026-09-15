import { parseSqlDate } from "./dateDomain";

/** A date-only value as a UTC-noon instant, safe for `timeZone: "UTC"` formatters. */
function dateAtUtcNoon(value: string): Date {
  const { year, month, day } = parseSqlDate(value);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

export function formatTaskDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" },
): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(
    dateAtUtcNoon(value),
  );
}

/** 12-hour clock label for a stored `HH:MM[:SS[.ffffff]]` time. */
export function formatTaskTime(value: string): string {
  const [hour = "00", minute = "00"] = value.split(":");
  const numericHour = Number(hour);
  return `${numericHour % 12 || 12}:${minute} ${numericHour >= 12 ? "PM" : "AM"}`;
}
