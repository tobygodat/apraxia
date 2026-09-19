import { describe, expect, it } from "vitest";
import { countByStage, type CareerStage } from "./careerOrdering";
import type { CareerApplicationRow, CareerStep } from "./careerService";
import {
  careerSummary,
  matchesStageFilter,
  nextSort,
  nextStepLabel,
  sortApplications,
} from "./careerPresentation";

function application(
  id: string,
  values: Partial<CareerApplicationRow> & { company: string },
): CareerApplicationRow {
  return {
    id,
    company: values.company,
    role: values.role ?? "engineer",
    appliedOn: values.appliedOn ?? null,
    stage: values.stage ?? "applied",
    postingUrl: null,
    location: null,
    processNotes: null,
    updatedAt: "2026-09-19T00:00:00Z",
    nextStep: values.nextStep ?? null,
  };
}

function step(scheduledOn: string | null, name = "screen"): CareerStep {
  return {
    id: `step-${name}-${scheduledOn ?? "none"}`,
    applicationId: "a",
    name,
    scheduledOn,
    position: 0,
    doneAt: null,
    notes: null,
  };
}

describe("the stage filter", () => {
  it("keeps everything when nothing is chosen", () => {
    for (const stage of ["interested", "offer", "withdrawn"] as CareerStage[])
      expect(matchesStageFilter(stage, "")).toBe(true);
  });

  it("treats closed as rejected and withdrawn together", () => {
    expect(matchesStageFilter("rejected", "closed")).toBe(true);
    expect(matchesStageFilter("withdrawn", "closed")).toBe(true);
    expect(matchesStageFilter("offer", "closed")).toBe(false);
  });

  it("matches one stage exactly otherwise", () => {
    expect(matchesStageFilter("screen", "screen")).toBe(true);
    expect(matchesStageFilter("interview", "screen")).toBe(false);
  });
});

describe("sorting by a column", () => {
  const rows = [
    application("a", { company: "Corvid", appliedOn: "2026-09-01", stage: "offer" }),
    application("b", { company: "Baseline", appliedOn: null, stage: "applied" }),
    application("c", { company: "Ashgrove", appliedOn: "2026-08-20", stage: "interested" }),
  ];

  it("falls back to the shared order with no column chosen", () => {
    expect(sortApplications(rows, null).map((row) => row.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts a column of words either way round", () => {
    expect(
      sortApplications(rows, { key: "company", direction: "asc" }).map((r) => r.company),
    ).toEqual(["Ashgrove", "Baseline", "Corvid"]);
    expect(
      sortApplications(rows, { key: "company", direction: "desc" }).map((r) => r.company),
    ).toEqual(["Corvid", "Baseline", "Ashgrove"]);
  });

  it("leaves a row with an empty date last whichever way the column runs", () => {
    expect(sortApplications(rows, { key: "applied", direction: "asc" }).map((r) => r.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(sortApplications(rows, { key: "applied", direction: "desc" }).map((r) => r.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("sorts stages in the order a process runs, not alphabetically", () => {
    expect(sortApplications(rows, { key: "stage", direction: "asc" }).map((r) => r.stage)).toEqual([
      "interested",
      "applied",
      "offer",
    ]);
  });

  it("does not disturb the rows it was given", () => {
    const before = rows.map((row) => row.id);
    sortApplications(rows, { key: "company", direction: "desc" });
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

describe("clicking a column header", () => {
  it("sorts ascending first and reverses on the second click", () => {
    const first = nextSort(null, "company");
    expect(first).toEqual({ key: "company", direction: "asc" });
    expect(nextSort(first, "company")).toEqual({ key: "company", direction: "desc" });
  });

  it("starts a different column ascending again", () => {
    expect(nextSort({ key: "company", direction: "desc" }, "applied")).toEqual({
      key: "applied",
      direction: "asc",
    });
  });
});

describe("the line of counts", () => {
  it("states each part with its number and leaves out the empty ones", () => {
    const counts = countByStage([
      { stage: "interested" },
      { stage: "interested" },
      { stage: "applied" },
      { stage: "screen" },
      { stage: "interview" },
      { stage: "offer" },
      { stage: "rejected" },
      { stage: "withdrawn" },
    ]);
    expect(careerSummary(counts)).toBe(
      "8 applications · 3 in process · 1 offer · 2 not sent yet · 2 closed",
    );
  });

  it("counts one application as one", () => {
    expect(careerSummary(countByStage([{ stage: "applied" }]))).toBe(
      "1 application · 1 in process",
    );
  });

  it("says nothing beyond the total when there is nothing", () => {
    expect(careerSummary(countByStage([]))).toBe("0 applications");
  });
});

describe("the next step", () => {
  it("is nothing at all when no round is waiting", () => {
    expect(nextStepLabel(null, "2026-09-19")).toBeNull();
  });

  it("says so when a round has no date yet", () => {
    expect(nextStepLabel(step(null, "onsite"), "2026-09-19")).toEqual({
      name: "onsite",
      when: "not scheduled",
      late: false,
    });
  });

  it("counts the days a round is past, and marks it late", () => {
    expect(nextStepLabel(step("2026-09-16"), "2026-09-19")).toEqual({
      name: "screen",
      when: "3 days late",
      late: true,
    });
    expect(nextStepLabel(step("2026-09-18"), "2026-09-19")?.when).toBe("1 day late");
  });

  it("is not late on the day it falls", () => {
    expect(nextStepLabel(step("2026-09-19"), "2026-09-19")?.late).toBe(false);
  });
});
