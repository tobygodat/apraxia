import { expect, it } from "vitest";
import { formatEventTimeRange } from "./eventDisplay";

it.each([
  ["2026-09-07T09:30:00Z", "2026-09-07T10:45:00Z", "UTC", "9:30 – 10:45am"],
  ["2026-09-07T11:00:00Z", "2026-09-07T14:00:00Z", "UTC", "11am – 2pm"],
  ["2026-09-07T23:30:00Z", "2026-09-08T00:15:00Z", "UTC", "11:30pm – 12:15am"],
  ["2026-09-07T13:00:00Z", "2026-09-07T14:00:00Z", "America/New_York", "9 – 10am"],
])("formats %s to %s in %s without losing the AM/PM boundary", (start, end, timezone, expected) => {
  expect(formatEventTimeRange(start, end, timezone)).toBe(expected);
});
