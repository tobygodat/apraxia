import { describe, expect, it } from "vitest";
import type { Todo } from "../../types/domain";
import {
  buildWeeklyReviewModel,
  type WeeklyReviewModel,
  type WeeklyReviewSectionKey,
} from "./weeklyReviewModel";

const BASE_TODO: Todo = {
  id: "00000000-0000-4000-8000-000000000001",
  text: "Base task",
  completed: false,
  completedAt: null,
  dueDate: null,
  dueTime: null,
  projectId: null,
  todayRank: null,
  createdAt: "2026-09-01T12:00:00.000000Z",
  updatedAt: "2026-09-01T12:00:00.000000Z",
};

function todo(overrides: Partial<Todo> & Pick<Todo, "id" | "text">): Todo {
  return { ...BASE_TODO, ...overrides };
}

/** Monday 2026-09-14 through Sunday 2026-09-20; "today" is the Thursday. */
const WEEK_MONDAY = "2026-09-14";
const TODAY = "2026-09-17";

function build(
  todos: readonly Todo[],
  overrides: Partial<Parameters<typeof buildWeeklyReviewModel>[0]> = {},
): WeeklyReviewModel {
  return buildWeeklyReviewModel({
    todos,
    projects: [{ id: "project-a", title: "Studio refresh" }],
    classes: [{ id: "class-a", name: "MATH3012" }],
    timezone: "America/New_York",
    today: TODAY,
    weekMonday: WEEK_MONDAY,
    ...overrides,
  });
}

function section(model: WeeklyReviewModel, key: WeeklyReviewSectionKey) {
  const found = model.sections.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`Missing ${key} section.`);
  return found;
}

function texts(model: WeeklyReviewModel, key: WeeklyReviewSectionKey): string[] {
  return section(model, key).groups.flatMap((group) =>
    group.entries.map((entry) => entry.todo.text),
  );
}

describe("buildWeeklyReviewModel", () => {
  it("rejects a week that does not start on a Monday", () => {
    expect(() => build([], { weekMonday: "2026-09-15" })).toThrow(RangeError);
  });

  it("reports the reviewed week's boundaries", () => {
    const model = build([]);
    expect(model.weekMonday).toBe(WEEK_MONDAY);
    expect(model.weekSunday).toBe("2026-09-20");
    expect(model.isCurrentWeek).toBe(true);
  });

  it("counts a completion by the account's local date, not the machine's", () => {
    // 03:30 UTC on the 21st is still Sunday the 20th in New York, so this
    // completion belongs to the reviewed week.
    const late = todo({
      id: "late-sunday",
      text: "Send the venue confirmation",
      completed: true,
      completedAt: "2026-09-21T03:30:00.000000Z",
    });
    expect(texts(build([late]), "finished")).toEqual(["Send the venue confirmation"]);
    expect(texts(build([late], { timezone: "UTC" }), "finished")).toEqual([]);
  });

  it("leaves completions from other weeks out", () => {
    const model = build([
      todo({
        id: "in-week",
        text: "Inside",
        completed: true,
        completedAt: "2026-09-16T14:00:00.000000Z",
      }),
      todo({
        id: "before",
        text: "Before",
        completed: true,
        completedAt: "2026-09-13T14:00:00.000000Z",
      }),
      todo({
        id: "after",
        text: "After",
        completed: true,
        completedAt: "2026-09-22T14:00:00.000000Z",
      }),
    ]);
    expect(texts(model, "finished")).toEqual(["Inside"]);
  });

  it("orders finished entries by the day they happened", () => {
    const model = build([
      todo({
        id: "friday",
        text: "Friday",
        completed: true,
        completedAt: "2026-09-18T14:00:00.000000Z",
      }),
      todo({
        id: "tuesday",
        text: "Tuesday",
        completed: true,
        completedAt: "2026-09-15T14:00:00.000000Z",
      }),
    ]);
    expect(texts(model, "finished")).toEqual(["Tuesday", "Friday"]);
  });

  it("keeps a completion whose stored instant cannot be read out of the week", () => {
    const model = build([
      todo({ id: "broken", text: "Broken", completed: true, completedAt: "not a timestamp" }),
    ]);
    expect(texts(model, "finished")).toEqual([]);
  });

  it("splits open dated tasks at today when reviewing the current week", () => {
    const model = build([
      todo({ id: "overdue", text: "Return the library books", dueDate: "2026-09-15" }),
      todo({ id: "today", text: "Compare the lighting options", dueDate: TODAY }),
      todo({ id: "next-week", text: "Measure the shelves", dueDate: "2026-09-24" }),
      todo({ id: "far", text: "Too far out", dueDate: "2026-10-05" }),
      todo({ id: "inbox", text: "Ask Sam about the reading group" }),
    ]);
    expect(texts(model, "slipped")).toEqual(["Return the library books"]);
    expect(texts(model, "next")).toEqual(["Compare the lighting options", "Measure the shelves"]);
    expect(section(model, "next").from).toBe(TODAY);
    expect(section(model, "next").to).toBe("2026-09-27");
  });

  it("splits at the following Monday when reviewing a finished week", () => {
    const model = build(
      [
        todo({ id: "in-week", text: "Due in the reviewed week", dueDate: "2026-09-10" }),
        todo({ id: "after", text: "Due the week after", dueDate: "2026-09-15" }),
      ],
      { weekMonday: "2026-09-07" },
    );
    expect(model.isCurrentWeek).toBe(false);
    expect(texts(model, "slipped")).toEqual(["Due in the reviewed week"]);
    expect(texts(model, "next")).toEqual(["Due the week after"]);
    expect(section(model, "next").from).toBe("2026-09-14");
  });

  it("measures how late a slipped task is against today", () => {
    const model = build([todo({ id: "late", text: "Late", dueDate: "2026-09-11" })]);
    expect(section(model, "slipped").groups[0]?.entries[0]?.daysLate).toBe(6);
  });

  it("still marks an overdue task as late when a finished week puts it in Next", () => {
    const model = build([todo({ id: "late", text: "Late", dueDate: "2026-09-15" })], {
      weekMonday: "2026-09-07",
    });
    expect(texts(model, "next")).toEqual(["Late"]);
    expect(section(model, "next").groups[0]?.entries[0]?.daysLate).toBe(2);
  });

  it("leaves a task due today or later with no late count", () => {
    const model = build([
      todo({ id: "today", text: "Today", dueDate: TODAY }),
      todo({ id: "soon", text: "Soon", dueDate: "2026-09-19" }),
    ]);
    expect(section(model, "next").groups[0]?.entries.map((entry) => entry.daysLate)).toEqual([
      null,
      null,
    ]);
  });

  it("counts a due date at the far edge of the calendar without walking to it", () => {
    const started = Date.now();
    const model = build([todo({ id: "ancient", text: "Ancient", dueDate: "0001-01-01" })]);
    expect(section(model, "slipped").groups[0]?.entries[0]?.daysLate).toBe(739_875);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("orders slipped tasks oldest first and next tasks by date then time", () => {
    const model = build([
      todo({ id: "s1", text: "Recent slip", dueDate: "2026-09-16" }),
      todo({ id: "s2", text: "Old slip", dueDate: "2026-09-02" }),
      todo({ id: "n1", text: "Evening", dueDate: "2026-09-18", dueTime: "17:00:00" }),
      todo({ id: "n2", text: "Morning", dueDate: "2026-09-18", dueTime: "09:00:00" }),
      todo({ id: "n3", text: "Unscheduled hour", dueDate: "2026-09-18" }),
    ]);
    expect(texts(model, "slipped")).toEqual(["Old slip", "Recent slip"]);
    expect(texts(model, "next")).toEqual(["Morning", "Evening", "Unscheduled hour"]);
  });

  it("groups by project and class, with the ungrouped bucket last", () => {
    const model = build([
      todo({ id: "a", text: "Loose", dueDate: "2026-09-15" }),
      todo({ id: "b", text: "Project work", dueDate: "2026-09-15", projectId: "project-a" }),
      todo({
        id: "c",
        text: "Problem set",
        dueDate: "2026-09-15",
        classId: "class-a",
        className: "MATH3012",
      }),
    ]);
    expect(
      section(model, "slipped").groups.map((group) => [group.kind, group.label, group.href]),
    ).toEqual([
      ["project", "Studio refresh", "/projects/project-a"],
      ["class", "MATH3012", "/classes/class-a"],
      ["none", "No project or class", null],
    ]);
  });

  it("names a class the snapshot no longer lists from the task's own row", () => {
    const model = build(
      [
        todo({
          id: "c",
          text: "Problem set",
          dueDate: "2026-09-15",
          classId: "class-gone",
          className: "PHYS2211",
        }),
      ],
      { classes: [] },
    );
    expect(section(model, "slipped").groups[0]?.label).toBe("PHYS2211");
  });

  it("counts each section and leaves a section without tasks empty", () => {
    const model = build([todo({ id: "late", text: "Late", dueDate: "2026-09-15" })]);
    expect(section(model, "slipped").total).toBe(1);
    expect(section(model, "finished").total).toBe(0);
    expect(section(model, "finished").groups).toEqual([]);
  });
});
