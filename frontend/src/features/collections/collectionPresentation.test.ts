import { describe, expect, it } from "vitest";
import { ideaPreview } from "./collectionPresentation";
import { formatTaskDate, formatTaskTime } from "../todos/taskFormatting";

describe("collection presentation", () => {
  it("omits a repeated title while keeping the remaining idea intact", () => {
    expect(
      ideaPreview({
        title: null,
        body: "\nA walk\r\n\r\nTake the river path.\r\nBring a notebook.",
      }),
    ).toBe("Take the river path.\nBring a notebook.");
    expect(ideaPreview({ title: null, body: "Just one thought" })).toBe("");
    expect(ideaPreview({ title: "A walk", body: "Take the river path." })).toBe(
      "Take the river path.",
    );
    expect(ideaPreview({ title: "A walk", body: "A walk\nDetails" })).toBe("Details");
  });

  it("formats date-only schedules without shifting the day and keeps minute precision", () => {
    expect(formatTaskDate("2026-09-07")).toBe("Mon, Sep 7");
    expect(formatTaskDate("2024-02-29")).toBe("Thu, Feb 29");
    expect(formatTaskTime("00:05:00")).toBe("12:05 AM");
    expect(formatTaskTime("12:00:00")).toBe("12:00 PM");
    expect(formatTaskTime("17:30")).toBe("5:30 PM");
  });
});
