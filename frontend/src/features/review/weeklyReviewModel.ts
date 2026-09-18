import type { ClassSummary, ProjectSummary, Todo } from "../../types/domain";
import {
  addSqlDateDays,
  asSqlDate,
  compareSqlDates,
  localDateInZone,
  sqlDateDifferenceInDays,
  startOfWeekMonday,
  type SqlDate,
} from "../todos/dateDomain";

export type WeeklyReviewSectionKey = "finished" | "slipped" | "next";
type WeeklyReviewGroupKind = "project" | "class" | "none";

export interface WeeklyReviewEntry {
  readonly todo: Todo;
  /**
   * The account-local date the task was completed on, for `finished` entries.
   * Null everywhere else, because an open task has no completion date.
   */
  readonly completedOn: SqlDate | null;
  /** Whole days a still-open due date is past today; null when it is not. */
  readonly daysLate: number | null;
}

/** One project, one class, or the tasks belonging to neither. */
interface WeeklyReviewGroup {
  readonly key: string;
  readonly kind: WeeklyReviewGroupKind;
  readonly label: string;
  /** Where the group heading links; null for the ungrouped bucket. */
  readonly href: string | null;
  readonly entries: readonly WeeklyReviewEntry[];
}

export interface WeeklyReviewSection {
  readonly key: WeeklyReviewSectionKey;
  /** Inclusive dates the section covers, for its caption. */
  readonly from: SqlDate | null;
  readonly to: SqlDate | null;
  readonly total: number;
  /** Non-empty groups only, projects first, then classes, then ungrouped. */
  readonly groups: readonly WeeklyReviewGroup[];
}

export interface WeeklyReviewModel {
  readonly today: SqlDate;
  readonly weekMonday: SqlDate;
  readonly weekSunday: SqlDate;
  readonly isCurrentWeek: boolean;
  readonly sections: readonly WeeklyReviewSection[];
}

export interface WeeklyReviewInput {
  readonly todos: readonly Todo[];
  readonly projects: readonly ProjectSummary[];
  readonly classes: readonly ClassSummary[];
  /** The account's IANA timezone; completion instants are read in it. */
  readonly timezone: string;
  readonly today: string;
  readonly weekMonday: string;
}

const UNGROUPED_KEY = "none";

/**
 * The local date a completion happened on, or null when the row carries no
 * usable instant. A row whose `completedAt` cannot be read is left out of the
 * week rather than thrown over: this page only reports, so one unreadable
 * timestamp must not take the whole review down with it.
 */
function completionDate(todo: Todo, timezone: string): SqlDate | null {
  if (!todo.completed || todo.completedAt === null) return null;
  const instant = new Date(todo.completedAt);
  if (Number.isNaN(instant.getTime())) return null;
  return localDateInZone(timezone, instant);
}

function within(date: string, from: string, to: string): boolean {
  return compareSqlDates(date, from) >= 0 && compareSqlDates(date, to) <= 0;
}

function compareDueDates(left: Todo, right: Todo): number {
  if (left.dueDate !== right.dueDate) {
    // An undated task sorts after every dated one.
    if (left.dueDate === null) return 1;
    if (right.dueDate === null) return -1;
    return compareSqlDates(left.dueDate, right.dueDate);
  }
  // An unset time sorts after a set one, matching the Today and board order.
  if (left.dueTime !== right.dueTime) {
    if (left.dueTime === null) return 1;
    if (right.dueTime === null) return -1;
    return left.dueTime < right.dueTime ? -1 : 1;
  }
  return left.text.localeCompare(right.text);
}

function compareEntries(section: WeeklyReviewSectionKey) {
  return (left: WeeklyReviewEntry, right: WeeklyReviewEntry): number => {
    if (section === "finished" && left.completedOn !== null && right.completedOn !== null) {
      // Earliest first, so the band still reads as the week's own sequence.
      if (left.completedOn !== right.completedOn)
        return compareSqlDates(left.completedOn, right.completedOn);
    }
    return compareDueDates(left.todo, right.todo);
  };
}

function groupOf(
  todo: Todo,
  projectTitles: ReadonlyMap<string, string>,
  classNames: ReadonlyMap<string, string>,
): Pick<WeeklyReviewGroup, "key" | "kind" | "label" | "href"> {
  if (todo.classId) {
    return {
      key: `class:${todo.classId}`,
      kind: "class",
      // A class the current snapshot no longer lists still has to name itself.
      label: classNames.get(todo.classId) ?? todo.className ?? todo.classId,
      href: `/classes/${encodeURIComponent(todo.classId)}`,
    };
  }
  if (todo.projectId) {
    return {
      key: `project:${todo.projectId}`,
      kind: "project",
      label: projectTitles.get(todo.projectId) ?? todo.projectId,
      href: `/projects/${encodeURIComponent(todo.projectId)}`,
    };
  }
  return { key: UNGROUPED_KEY, kind: "none", label: "No project or class", href: null };
}

const GROUP_ORDER: Record<WeeklyReviewGroupKind, number> = { project: 0, class: 1, none: 2 };

function buildGroups(
  entries: readonly WeeklyReviewEntry[],
  section: WeeklyReviewSectionKey,
  projectTitles: ReadonlyMap<string, string>,
  classNames: ReadonlyMap<string, string>,
): WeeklyReviewGroup[] {
  type MutableGroup = Omit<WeeklyReviewGroup, "entries"> & { entries: WeeklyReviewEntry[] };
  const groups = new Map<string, MutableGroup>();
  for (const entry of entries) {
    const identity = groupOf(entry.todo, projectTitles, classNames);
    const existing = groups.get(identity.key);
    if (existing) existing.entries.push(entry);
    else groups.set(identity.key, { ...identity, entries: [entry] });
  }
  for (const group of groups.values()) group.entries.sort(compareEntries(section));
  return [...groups.values()].sort(
    (left, right) =>
      GROUP_ORDER[left.kind] - GROUP_ORDER[right.kind] || left.label.localeCompare(right.label),
  );
}

/**
 * The read-only week: what was finished inside it, what is still open and was
 * due before the stretch ahead begins, and what that stretch holds. Slipped and
 * Next partition every dated open task at one boundary, so no task can be
 * counted twice or fall between the two.
 *
 * Reviewing the current week, that boundary is today: Slipped is exactly the
 * overdue pile and Next runs from today through the end of next week. Reviewing
 * a finished week, it is the Monday after it, so Next is that following week.
 * Tasks with no due date belong to neither; the Inbox is not part of a week.
 */
export function buildWeeklyReviewModel(input: WeeklyReviewInput): WeeklyReviewModel {
  const today = asSqlDate(input.today);
  const weekMonday = asSqlDate(input.weekMonday);
  if (startOfWeekMonday(weekMonday) !== weekMonday) {
    throw new RangeError("Review week date must be a Monday.");
  }
  const weekSunday = addSqlDateDays(weekMonday, 6);
  const isCurrentWeek = weekMonday === startOfWeekMonday(today);
  const nextFrom = isCurrentWeek ? today : addSqlDateDays(weekSunday, 1);
  const nextTo = addSqlDateDays(weekSunday, 7);

  const projectTitles = new Map(input.projects.map((project) => [project.id, project.title]));
  const classNames = new Map(
    input.classes.flatMap((course) => (course.name ? [[course.id, course.name] as const] : [])),
  );

  const finished: WeeklyReviewEntry[] = [];
  const slipped: WeeklyReviewEntry[] = [];
  const next: WeeklyReviewEntry[] = [];

  for (const todo of input.todos) {
    if (todo.completed) {
      const completedOn = completionDate(todo, input.timezone);
      if (completedOn !== null && within(completedOn, weekMonday, weekSunday)) {
        finished.push({ todo, completedOn, daysLate: null });
      }
      continue;
    }
    if (todo.dueDate === null) continue;
    const dueDate = asSqlDate(todo.dueDate);
    // A deadline already past is late wherever it is shown. Reviewing a
    // finished week, its overdue tasks land in Next because they belong to the
    // stretch after it, and they still have to read as overdue.
    const late = sqlDateDifferenceInDays(dueDate, today);
    const entry = { todo, completedOn: null, daysLate: late > 0 ? late : null };
    if (compareSqlDates(dueDate, nextFrom) < 0) {
      slipped.push(entry);
      continue;
    }
    if (within(dueDate, nextFrom, nextTo)) next.push(entry);
  }

  const section = (
    key: WeeklyReviewSectionKey,
    entries: WeeklyReviewEntry[],
    from: SqlDate | null,
    to: SqlDate | null,
  ): WeeklyReviewSection => ({
    key,
    from,
    to,
    total: entries.length,
    groups: buildGroups(entries, key, projectTitles, classNames),
  });

  return {
    today,
    weekMonday,
    weekSunday,
    isCurrentWeek,
    sections: [
      section("finished", finished, weekMonday, weekSunday),
      // Slipped has no lower bound: a task due long before this week and still
      // open has slipped through it too.
      section("slipped", slipped, null, addSqlDateDays(nextFrom, -1)),
      section("next", next, nextFrom, nextTo),
    ],
  };
}
