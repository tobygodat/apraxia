/**
 * The lines the career pages read out: a date as a person writes it, how long
 * until a round, and the summary under a company's name. Interface words stay in
 * their own case here and are lowercased by the Paper sheet, the way every other
 * surface does it.
 */
import { compareSqlDates, sqlDateDifferenceInDays } from "../todos/dateDomain";
import { formatTaskDate } from "../todos/taskFormatting";
import type { CareerApplication, CareerResource, CareerStep } from "./careerService";

/**
 * `sep 04`. Day-first would read as a number; the month makes it a date. The
 * case is corrected here rather than with `text-transform`, because these pages
 * have no classic twin whose wording an edit could change, and a line that mixes
 * a date with a round's own name cannot be lowercased by the element.
 */
export function formatCareerDate(value: string): string {
  return formatTaskDate(value, { month: "short", day: "2-digit" }).toLowerCase();
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
  const date = formatCareerDate(value);
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
    return { label: step.scheduledOn ? formatCareerDate(step.scheduledOn) : "done", late: false };
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
    application.appliedOn ? `applied ${formatCareerDate(application.appliedOn)}` : "not sent yet",
    application.stage,
  ];
  if (nextStep) {
    const timing = dateTiming(nextStep.scheduledOn, today, "not scheduled");
    parts.push(`next, ${nextStep.name} ${timing.label}`);
  }
  if (application.location) parts.push(application.location);
  return parts.join(" · ");
}

/** `pdf · 214 KB`, or the host of a link. */
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
  parts.push(`added ${formatCareerDate(resource.createdAt.slice(0, 10))}`);
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
