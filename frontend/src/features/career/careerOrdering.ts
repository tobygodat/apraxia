/**
 * What the career pages work out for themselves rather than reading from a
 * column: which round comes next, what order the table is in, and how many
 * applications sit at each stage. None of it is stored, so none of it can drift
 * from the rows it is derived from.
 */
import type { Database } from "../../types/database";

export type CareerStage = Database["public"]["Enums"]["career_stage"];

export const CAREER_STAGES: readonly CareerStage[] = [
  "interested",
  "applied",
  "screen",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
];

/** A round of a process, as far as the ordering rules are concerned. */
export interface OrderableStep {
  id: string;
  scheduledOn: string | null;
  position: number;
  doneAt: string | null;
}

/** An application row, as far as the ordering rules are concerned. */
export interface OrderableApplication {
  id: string;
  company: string;
  appliedOn: string | null;
  nextStep: { scheduledOn: string | null } | null;
}

/** How many applications sit at each stage: the line under "career". */
export function countByStage(
  applications: readonly { stage: CareerStage }[],
): Record<CareerStage, number> {
  const counts = Object.fromEntries(CAREER_STAGES.map((stage) => [stage, 0])) as Record<
    CareerStage,
    number
  >;
  for (const application of applications) counts[application.stage] += 1;
  return counts;
}

/**
 * The next step of one application: the earliest round that is not done, by
 * date. A round with no date yet waits behind the ones that have one, then
 * falls back to its own position.
 */
export function nextStepOf<Step extends OrderableStep>(steps: readonly Step[]): Step | null {
  return (
    steps
      .filter((step) => !step.doneAt)
      .sort(
        (a, b) =>
          Number(a.scheduledOn === null) - Number(b.scheduledOn === null) ||
          (a.scheduledOn ?? "").localeCompare(b.scheduledOn ?? "") ||
          a.position - b.position ||
          a.id.localeCompare(b.id),
      )[0] ?? null
  );
}

/**
 * The table's order: whoever has the soonest next step first, then the most
 * recently applied. An application with nothing scheduled is not urgent, so it
 * sorts behind every one that is, and one you have not sent yet sorts above the
 * ones you have.
 */
export function orderApplications<Row extends OrderableApplication>(rows: readonly Row[]): Row[] {
  const due = (row: Row) => row.nextStep?.scheduledOn ?? null;
  return [...rows].sort(
    (a, b) =>
      Number(due(a) === null) - Number(due(b) === null) ||
      (due(a) ?? "").localeCompare(due(b) ?? "") ||
      Number(b.appliedOn === null) - Number(a.appliedOn === null) ||
      (b.appliedOn ?? "").localeCompare(a.appliedOn ?? "") ||
      a.company.localeCompare(b.company) ||
      a.id.localeCompare(b.id),
  );
}
