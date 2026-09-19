/**
 * What the career table works out before it draws itself: which rows the stage
 * filter keeps, what order a clicked column puts them in, the line of counts
 * under the heading, and how one application's next step reads.
 *
 * All of it is pure, so the page's behaviour is tested here rather than through
 * the markup. The default order and the stage tally stay in `careerOrdering`,
 * which is shared with the application page.
 */
import { formatTaskDate } from "../todos/taskFormatting";
import { sqlDateDifferenceInDays } from "../todos/dateDomain";
import { CAREER_STAGES, orderApplications, type CareerStage } from "./careerOrdering";
import type { CareerApplicationRow, CareerStep } from "./careerService";

/** The two stages that mean the process is over, however it ended. */
export const CLOSED_STAGES: readonly CareerStage[] = ["rejected", "withdrawn"];

/** `""` is every application; `"closed"` is the two stages above, together. */
export type CareerStageFilter = "" | CareerStage | "closed";

/** The filter row, in the order it reads. Paper lowercases these in CSS. */
export const CAREER_FILTERS: readonly (readonly [CareerStageFilter, string])[] = [
  ["", "All"],
  ["interested", "Interested"],
  ["applied", "Applied"],
  ["screen", "Screen"],
  ["interview", "Interview"],
  ["offer", "Offer"],
  ["closed", "Closed"],
];

export type CareerSortKey = "company" | "role" | "applied" | "stage" | "next";

export interface CareerSort {
  key: CareerSortKey;
  direction: "asc" | "desc";
}

/** The column headers, left to right, with the width each one asks for. */
export const CAREER_COLUMNS: readonly {
  key: CareerSortKey;
  label: string;
  /** The right-hand column is the only one that reads better flush right. */
  align?: "right";
}[] = [
  { key: "company", label: "Company" },
  { key: "role", label: "Role" },
  { key: "applied", label: "Applied" },
  { key: "stage", label: "Stage" },
  { key: "next", label: "Next step", align: "right" },
];

export function matchesStageFilter(stage: CareerStage, filter: CareerStageFilter): boolean {
  if (!filter) return true;
  if (filter === "closed") return CLOSED_STAGES.includes(stage);
  return stage === filter;
}

/** Only a date can be absent; a company, role and stage are always there. */
function missing(row: CareerApplicationRow, key: CareerSortKey): boolean {
  if (key === "applied") return row.appliedOn === null;
  if (key === "next") return !row.nextStep?.scheduledOn;
  return false;
}

function compareBy(a: CareerApplicationRow, b: CareerApplicationRow, key: CareerSortKey): number {
  switch (key) {
    case "company":
      return a.company.localeCompare(b.company);
    case "role":
      return a.role.localeCompare(b.role);
    case "applied":
      return (a.appliedOn ?? "").localeCompare(b.appliedOn ?? "");
    case "stage":
      return CAREER_STAGES.indexOf(a.stage) - CAREER_STAGES.indexOf(b.stage);
    case "next":
      return (a.nextStep?.scheduledOn ?? "").localeCompare(b.nextStep?.scheduledOn ?? "");
  }
}

/**
 * The table's order. With no column chosen it is the shared default: soonest
 * next step first. With one chosen, a row that has nothing in that column sorts
 * last either way round, because an empty cell is not a small value.
 */
export function sortApplications(
  rows: readonly CareerApplicationRow[],
  sort: CareerSort | null,
): CareerApplicationRow[] {
  if (!sort) return orderApplications(rows);
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort(
    (a, b) =>
      Number(missing(a, sort.key)) - Number(missing(b, sort.key)) ||
      sign * compareBy(a, b, sort.key) ||
      a.company.localeCompare(b.company) ||
      a.id.localeCompare(b.id),
  );
}

/** Clicking a column: first time sorts it ascending, again reverses it. */
export function nextSort(current: CareerSort | null, key: CareerSortKey): CareerSort {
  return { key, direction: current?.key === key && current.direction === "asc" ? "desc" : "asc" };
}

/**
 * The line under the heading, stated with its numbers. A part that is zero is
 * left out rather than written as a nothing, and "in process" is the three
 * stages between sending an application and hearing a decision.
 */
export function careerSummary(counts: Record<CareerStage, number>): string {
  const total = CAREER_STAGES.reduce((sum, stage) => sum + counts[stage], 0);
  const inProcess = counts.applied + counts.screen + counts.interview;
  const closed = counts.rejected + counts.withdrawn;
  const parts = [`${total} ${total === 1 ? "application" : "applications"}`];
  if (inProcess) parts.push(`${inProcess} in process`);
  if (counts.offer) parts.push(`${counts.offer} ${counts.offer === 1 ? "offer" : "offers"}`);
  if (counts.interested) parts.push(`${counts.interested} not sent yet`);
  if (closed) parts.push(`${closed} closed`);
  return parts.join(" · ");
}

/** A date as the table writes it: `Sep 04`, which Paper lowercases. */
export function formatCareerDate(value: string): string {
  return formatTaskDate(value, { month: "short", day: "2-digit" });
}

export interface NextStepLabel {
  /** The round's own name, which is the user's words. */
  name: string;
  /** When it falls, or how far past it is. */
  when: string;
  late: boolean;
}

/** How the right-hand cell reads, or null when nothing is scheduled at all. */
export function nextStepLabel(step: CareerStep | null, today: string): NextStepLabel | null {
  if (!step) return null;
  if (!step.scheduledOn) return { name: step.name, when: "not scheduled", late: false };
  const late = sqlDateDifferenceInDays(step.scheduledOn, today);
  if (late > 0)
    return { name: step.name, when: `${late} ${late === 1 ? "day" : "days"} late`, late: true };
  return { name: step.name, when: formatCareerDate(step.scheduledOn), late: false };
}
