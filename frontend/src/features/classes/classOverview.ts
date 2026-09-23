import { addSqlDateDays, compareSqlDates } from "../todos/dateDomain";
import { formatTaskDate } from "../todos/taskFormatting";

/**
 * What the Classes list and a class header answer at a glance: what is due
 * next and how much is still open.
 */
export interface ClassOverview {
  readonly assignments: number;
  readonly open: number;
  /** The soonest dated open assignment, or null when none is scheduled. */
  readonly nextDue: { readonly title: string; readonly due: string } | null;
}

/** The assignment fields an overview needs, in browser naming. */
export interface OverviewAssignment {
  readonly id: string;
  readonly classId: string;
  readonly title: string;
  readonly due: string | null;
  readonly done: boolean;
}

/** The two halves of the summary line, already written as the user reads them. */
export interface ClassOverviewLine {
  readonly due: string;
  /** A past-due summary says so in words; the clay color only reinforces it. */
  readonly overdue: boolean;
  readonly counts: string;
}

export const emptyClassOverview: ClassOverview = {
  assignments: 0,
  open: 0,
  nextDue: null,
};

/** Undated assignments sort last without inventing a date they do not have. */
const UNDATED = "9999-99-99";

/** Totals per class id. An assignment whose class is unknown is still tallied. */
export function summarizeClasses(
  assignments: readonly OverviewAssignment[],
): Record<string, ClassOverview> {
  const totals: Record<string, ClassOverview> = {};
  const at = (classId: string) => totals[classId] ?? emptyClassOverview;
  // One ordering decides every class's next due: soonest date, then title, then
  // id, so the line never swaps between two equally urgent assignments.
  const ordered = [...assignments].sort(
    (a, b) =>
      (a.due || UNDATED).localeCompare(b.due || UNDATED) ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
  for (const assignment of ordered) {
    const current = at(assignment.classId);
    const open = !assignment.done;
    totals[assignment.classId] = {
      ...current,
      assignments: current.assignments + 1,
      open: current.open + (open ? 1 : 0),
      nextDue:
        current.nextDue ??
        (open && assignment.due ? { title: assignment.title, due: assignment.due } : null),
    };
  }
  return totals;
}

/** The summary line's own copy, in the product's existing due-date language. */
export function describeClassOverview(overview: ClassOverview, today: string): ClassOverviewLine {
  const counts = overview.open ? `${overview.open} open` : "";
  const line = (due: string, overdue = false) => ({ due, overdue, counts });
  if (!overview.assignments) return line("No assignments yet");
  if (!overview.open) return line("All assignments done");
  if (!overview.nextDue) return line("Nothing scheduled");
  const { title, due } = overview.nextDue;
  if (compareSqlDates(due, today) < 0)
    return line(`Past due ${formatTaskDate(due)} · ${title}`, true);
  if (due === today) return line(`Due today · ${title}`);
  if (due === addSqlDateDays(today, 1)) return line(`Due tomorrow · ${title}`);
  return line(`Due ${formatTaskDate(due)} · ${title}`);
}
