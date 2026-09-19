import { expect, it } from "vitest";
import {
  describeClassOverview,
  emptyClassOverview,
  summarizeClasses,
  type OverviewAssignment,
} from "./classOverview";

const TODAY = "2026-09-18";
const assignment = (overrides: Partial<OverviewAssignment> = {}): OverviewAssignment => ({
  id: "a1",
  classId: "math",
  title: "Problem set 4",
  due: "2026-09-25",
  done: false,
  ...overrides,
});

it("counts each class separately and keeps a completed assignment out of the open total", () => {
  const totals = summarizeClasses(
    [
      assignment({ id: "a1", due: "2026-09-25" }),
      assignment({ id: "a2", title: "Problem set 3", due: "2026-09-16", done: true }),
      assignment({ id: "a3", classId: "hist", title: "Essay", due: "2026-09-30" }),
    ],
    { math: 2, hist: 0 },
  );
  expect(totals.math).toEqual({
    assignments: 2,
    open: 1,
    notes: 2,
    nextDue: { title: "Problem set 4", due: "2026-09-25" },
  });
  expect(totals.hist).toEqual({
    assignments: 1,
    open: 1,
    notes: 0,
    nextDue: { title: "Essay", due: "2026-09-30" },
  });
});

it("picks the soonest open assignment, skipping finished and undated ones", () => {
  const totals = summarizeClasses(
    [
      assignment({ id: "a1", title: "Read chapter 5", due: null }),
      assignment({ id: "a2", title: "Midterm", due: "2026-10-02" }),
      assignment({ id: "a3", title: "Problem set 2", due: "2026-09-11", done: true }),
      assignment({ id: "a4", title: "Problem set 3", due: "2026-09-16" }),
    ],
    {},
  );
  expect(totals.math.nextDue).toEqual({ title: "Problem set 3", due: "2026-09-16" });
  expect(totals.math.open).toBe(3);
});

it("settles two assignments due the same day on title, so the line does not swap", () => {
  const rows = [
    assignment({ id: "b", title: "Quiz 2", due: "2026-09-20" }),
    assignment({ id: "a", title: "Lab report", due: "2026-09-20" }),
  ];
  expect(summarizeClasses(rows, {}).math.nextDue?.title).toBe("Lab report");
  expect(summarizeClasses([...rows].reverse(), {}).math.nextDue?.title).toBe("Lab report");
});

it("records a class that has notes but no assignments", () => {
  expect(summarizeClasses([], { hist: 3 }).hist).toEqual({ ...emptyClassOverview, notes: 3 });
});

it("writes the due half in the product's own date language", () => {
  const due = (value: string | null, done = false) =>
    describeClassOverview(summarizeClasses([assignment({ due: value, done })], {}).math, TODAY);
  expect(due("2026-09-16")).toMatchObject({
    due: "Past due Wed, Sep 16 · Problem set 4",
    overdue: true,
  });
  expect(due("2026-09-18")).toMatchObject({ due: "Due today · Problem set 4", overdue: false });
  expect(due("2026-09-19")).toMatchObject({ due: "Due tomorrow · Problem set 4" });
  expect(due("2026-09-25")).toMatchObject({ due: "Due Fri, Sep 25 · Problem set 4" });
  expect(due(null)).toMatchObject({ due: "Nothing scheduled" });
  expect(due("2026-09-25", true)).toMatchObject({ due: "All assignments done" });
});

it("names an empty class and one that only has notes", () => {
  expect(describeClassOverview(emptyClassOverview, TODAY)).toEqual({
    due: "Nothing saved yet",
    overdue: false,
    counts: "",
  });
  expect(describeClassOverview({ ...emptyClassOverview, notes: 1 }, TODAY)).toEqual({
    due: "No assignments yet",
    overdue: false,
    counts: "1 PDF",
  });
});

it("counts only what there is to count", () => {
  const counts = (overview: Parameters<typeof describeClassOverview>[0]) =>
    describeClassOverview(overview, TODAY).counts;
  expect(counts({ assignments: 4, open: 3, notes: 2, nextDue: null })).toBe("3 open · 2 PDFs");
  expect(counts({ assignments: 4, open: 3, notes: 0, nextDue: null })).toBe("3 open");
  expect(counts({ assignments: 4, open: 0, notes: 5, nextDue: null })).toBe("5 PDFs");
});
