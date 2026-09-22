import { describe, expect, it } from "vitest";
import { groupIdeasByProject, ideaPreview } from "./collectionPresentation";
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

  it("groups ideas by project while preserving each project's idea order", () => {
    const idea = (id: string, projectId: string | null) => ({
      id,
      title: id,
      body: id,
      projectId,
      createdAt: "",
      updatedAt: "",
    });
    const groups = groupIdeasByProject(
      [idea("loose", null), idea("second", "b"), idea("first", "b"), idea("missing", "gone")],
      [
        { id: "b", title: "Studio" },
        { id: "a", title: "Garden" },
      ],
    );

    expect(groups.map(({ title }) => title)).toEqual([
      "Studio",
      "Unavailable project",
      "Unassigned",
    ]);
    expect(groups[0].ideas.map(({ id }) => id)).toEqual(["second", "first"]);
    expect(groups[1].projectAvailable).toBe(false);
  });

  it("formats date-only schedules without shifting the day and keeps minute precision", () => {
    expect(formatTaskDate("2026-09-07")).toBe("Mon, Sep 7");
    expect(formatTaskDate("2024-02-29")).toBe("Thu, Feb 29");
    expect(formatTaskTime("00:05:00")).toBe("12:05 AM");
    expect(formatTaskTime("12:00:00")).toBe("12:00 PM");
    expect(formatTaskTime("17:30")).toBe("5:30 PM");
  });
});
