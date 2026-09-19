import { describe, expect, it } from "vitest";

import { CAREER_STAGES, countByStage, nextStepOf, orderApplications } from "./careerOrdering";

const step = (
  id: string,
  scheduledOn: string | null,
  position: number,
  doneAt: string | null = null,
) => ({ id, scheduledOn, position, doneAt });

describe("nextStepOf", () => {
  it("takes the earliest round that is not done", () => {
    expect(
      nextStepOf([
        step("recruiter", "2026-09-20", 0, "2026-09-20T15:00:00Z"),
        step("onsite", "2026-10-20", 2),
        step("screen", "2026-10-02", 1),
      ])?.id,
    ).toBe("screen");
  });

  it("puts an unscheduled round behind every scheduled one", () => {
    expect(nextStepOf([step("unscheduled", null, 0), step("screen", "2026-10-02", 9)])?.id).toBe(
      "screen",
    );
    // With nothing scheduled at all, the page's own order decides.
    expect(nextStepOf([step("second", null, 5), step("first", null, 1)])?.id).toBe("first");
  });

  it("has no next step once every round is done", () => {
    expect(nextStepOf([step("screen", "2026-10-02", 0, "2026-10-02T18:00:00Z")])).toBeNull();
    expect(nextStepOf([])).toBeNull();
  });
});

describe("orderApplications", () => {
  const row = (
    id: string,
    company: string,
    appliedOn: string | null,
    nextOn: string | null | undefined,
  ) => ({
    id,
    company,
    appliedOn,
    nextStep: nextOn === undefined ? null : { scheduledOn: nextOn },
  });

  it("puts the soonest next step first, then the most recently applied", () => {
    expect(
      orderApplications([
        row("a", "Ramp", "2026-09-01", undefined),
        row("b", "Stripe", "2026-09-10", "2026-10-05"),
        row("c", "Linear", "2026-09-02", "2026-09-30"),
        row("d", "Figma", "2026-09-18", undefined),
      ]).map((r) => r.company),
    ).toEqual(["Linear", "Stripe", "Figma", "Ramp"]);
  });

  it("floats an application you have not sent yet above the ones you have", () => {
    expect(
      orderApplications([
        row("a", "Ramp", "2026-09-01", undefined),
        row("b", "Notion", null, undefined),
      ]).map((r) => r.company),
    ).toEqual(["Notion", "Ramp"]);
  });

  it("does not mutate the rows it was given", () => {
    const rows = [row("b", "Stripe", "2026-09-10", null), row("a", "Ramp", "2026-09-01", null)];
    orderApplications(rows);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("countByStage", () => {
  it("counts every stage, including the ones nothing sits at", () => {
    expect(countByStage([{ stage: "applied" }, { stage: "applied" }, { stage: "offer" }])).toEqual({
      interested: 0,
      applied: 2,
      screen: 0,
      interview: 0,
      offer: 1,
      rejected: 0,
      withdrawn: 0,
    });
    expect(Object.keys(countByStage([]))).toEqual([...CAREER_STAGES]);
  });
});
