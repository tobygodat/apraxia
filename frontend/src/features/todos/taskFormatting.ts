import { parseSqlDate } from "./dateDomain";

export function formatTaskDate(value: string): string {
  const { year, month, day } = parseSqlDate(value);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  }).format(date);
}

export function formatTaskTime(value: string): string {
  const [hour = "00", minute = "00"] = value.split(":");
  const numericHour = Number(hour);
  return `${numericHour % 12 || 12}:${minute} ${numericHour >= 12 ? "PM" : "AM"}`;
}
