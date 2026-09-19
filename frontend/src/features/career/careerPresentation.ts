/**
 * What the career table works out before it draws itself: which rows the stage
 * filter keeps, what order a clicked column puts them in, the line of counts
 * under the heading, and how one application's next step reads.
 *
 * All of it is pure, so the page's behaviour is tested here rather than through
 * the markup. The default order and the stage tally stay in `careerOrdering`,
 * which is shared with the application page.
 *
 * The second half of the file belongs to one application's own page: how a round
 * reads, the line under a company's name, and what a file says about itself.
 */
import { formatTaskDate } from "../todos/taskFormatting";
import { compareSqlDates, sqlDateDifferenceInDays } from "../todos/dateDomain";
import { CAREER_STAGES, orderApplications, type CareerStage } from "./careerOrdering";
import type {
  CareerApplication,
  CareerApplicationRow,
  CareerResource,
  CareerStep,
} from "./careerService";

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

/* ------------------------------------------------ one application's own page */

/**
 * A date as a line of the application page writes it: lowercase, because these
 * lines carry a round's own name beside the date and `text-transform` cannot
 * tell the two apart. The table's cells hold the date alone, so they keep
 * `formatCareerDate` and are lowercased by their sheet.
 */
function spokenDate(value: string): string {
  return formatCareerDate(value).toLowerCase();
}

export interface Timing {
  label: string;
  /** Past its date and not done: the one thing `warning` is for. */
  late: boolean;
}

/**
 * How a dated row reads. Beyond a week the countdown stops helping and the date
 * carries it alone, which is also why nothing here says "in 34 days".
 */
export function dateTiming(value: string | null, today: string, missing = "not scheduled"): Timing {
  if (!value) return { label: missing, late: false };
  const date = spokenDate(value);
  const days = sqlDateDifferenceInDays(today, value);
  if (days < 0) {
    const late = -days;
    return { label: `${date} · ${late === 1 ? "yesterday" : `${late} days late`}`, late: true };
  }
  if (days === 0) return { label: `${date} · today`, late: false };
  if (days === 1) return { label: `${date} · tomorrow`, late: false };
  if (days <= 7) return { label: `${date} · in ${days} days`, late: false };
  return { label: date, late: false };
}

/** A round that is already done says when, and nothing about being late. */
export function stepTiming(step: CareerStep, today: string): Timing {
  if (step.doneAt)
    return { label: step.scheduledOn ? spokenDate(step.scheduledOn) : "done", late: false };
  return dateTiming(step.scheduledOn, today);
}

/**
 * The line under a company: when it went out, where it stands, and what is next.
 * Each part is dropped rather than filled with a placeholder, so the line never
 * says something that is not known.
 */
export function applicationSummary(
  application: CareerApplication,
  nextStep: CareerStep | null,
  today: string,
): string {
  const parts = [
    application.appliedOn ? `applied ${spokenDate(application.appliedOn)}` : "not sent yet",
    application.stage,
  ];
  if (nextStep)
    parts.push(`next, ${nextStep.name} ${dateTiming(nextStep.scheduledOn, today).label}`);
  if (application.location) parts.push(application.location);
  return parts.join(" · ");
}

/** `pdf · 214 KB · added sep 04`, or the host of a link. */
export function resourceMeta(resource: CareerResource): string {
  const parts: string[] = [];
  if (resource.kind === "link") {
    parts.push("link");
    try {
      if (resource.url) parts.push(new URL(resource.url).host.replace(/^www\./, ""));
    } catch {
      // A stored link that no longer parses still lists; it just says less.
    }
  } else {
    const extension = resource.title.split(".").pop()?.toLowerCase();
    parts.push(extension && extension !== resource.title.toLowerCase() ? extension : "file");
    if (resource.byteSize) parts.push(formatBytes(resource.byteSize));
    if (!resource.uploadedAt) parts.push("not finished uploading");
  }
  parts.push(`added ${spokenDate(resource.createdAt.slice(0, 10))}`);
  return parts.join(" · ");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(kb / 1024 < 10 ? 1 : 0)} MB`;
}

/** Tags in the order a filter row shows them: most used first, then alphabetical. */
export function tagsOf(rows: readonly { tags: readonly string[] }[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([leftTag, left], [rightTag, right]) => right - left || leftTag.localeCompare(rightTag))
    .map(([tag]) => tag);
}

/**
 * Prep items in the order the page lists them: what is still to do first, by
 * date, then what is done. `position` is the tie-break the table stores.
 */
export function orderPrep<
  Item extends { dueOn: string | null; doneAt: string | null; position: number; id: string },
>(items: readonly Item[]): Item[] {
  return [...items].sort(
    (a, b) =>
      Number(!!a.doneAt) - Number(!!b.doneAt) ||
      Number(a.dueOn === null) - Number(b.dueOn === null) ||
      (a.dueOn && b.dueOn ? compareSqlDates(a.dueOn, b.dueOn) : 0) ||
      a.position - b.position ||
      a.id.localeCompare(b.id),
  );
}
