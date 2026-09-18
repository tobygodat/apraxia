import { describe, expect, it } from "vitest";

import {
  describeRecurrence,
  formatRecurrence,
  isRecurrenceFreq,
  isRecurrenceInterval,
  MAX_RECURRENCE_INTERVAL,
} from "./todoRecurrence";

describe("recurrence labels", () => {
  it("names a single period by its adverb and a longer one by its count", () => {
    expect(formatRecurrence({ freq: "weekly", interval: 1, until: null })).toBe("Weekly");
    expect(formatRecurrence({ freq: "weekly", interval: 2, until: null })).toBe("Every 2 weeks");
    expect(formatRecurrence({ freq: "daily", interval: 3, until: null })).toBe("Every 3 days");
    expect(formatRecurrence({ freq: "monthly", interval: 1, until: null })).toBe("Monthly");
  });

  it("states the end date without reading it through a machine-local Date", () => {
    expect(describeRecurrence({ freq: "weekly", interval: 1, until: null })).toBe(
      "Repeats weekly.",
    );
    // A date-only value on the first of a month must not slip a day backwards.
    expect(describeRecurrence({ freq: "weekly", interval: 2, until: "2026-12-01" })).toBe(
      "Repeats every 2 weeks until Dec 1.",
    );
  });
});

describe("recurrence guards", () => {
  it("accepts only the stored frequencies and interval range", () => {
    expect(isRecurrenceFreq("weekly")).toBe(true);
    expect(isRecurrenceFreq("yearly")).toBe(false);
    expect(isRecurrenceFreq("")).toBe(false);
    expect(isRecurrenceInterval(1)).toBe(true);
    expect(isRecurrenceInterval(MAX_RECURRENCE_INTERVAL)).toBe(true);
    expect(isRecurrenceInterval(MAX_RECURRENCE_INTERVAL + 1)).toBe(false);
    expect(isRecurrenceInterval(0)).toBe(false);
    expect(isRecurrenceInterval(1.5)).toBe(false);
    expect(isRecurrenceInterval("2")).toBe(false);
  });
});
