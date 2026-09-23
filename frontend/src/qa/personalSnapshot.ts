import { addSqlDateDays, startOfWeekMonday, type SqlDate } from "../features/todos/dateDomain";
import type { Idea, Project, Todo } from "../types/domain";

/**
 * The `personal` scenario's seed: a private reproduction of the real account,
 * written by `npm run qa:snapshot` to a gitignored file. A glob rather than an
 * import, so a checkout without the file still builds and the scenario reports
 * that it has nothing to show.
 */
export interface PersonalSnapshotEvent {
  title: string;
  color: string | null;
  /** Index of the source calendar, not its Google id. */
  calendar: number;
  kind: "timed" | "all_day";
  /** Days from the captured week's Sunday. */
  startDay: number;
  endDay: number;
  startMinute?: number;
  endMinute?: number;
}
interface PersonalSnapshotFile {
  version: 1;
  capturedOn: SqlDate;
  timezone: string;
  projects: Project[];
  ideas: Idea[];
  classes: { id: string; name: string | null }[];
  todos: Todo[];
  events: PersonalSnapshotEvent[];
}
export type PersonalSnapshot = Omit<PersonalSnapshotFile, "version">;

const files = import.meta.glob<PersonalSnapshotFile>("../../qa/local/workspace-snapshot.json", {
  eager: true,
  import: "default",
});

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

export function snapshotTimezone(): string | null {
  return Object.values(files)[0]?.timezone ?? null;
}

/**
 * The snapshot with every date carried forward by whole weeks, so the week it
 * was captured in is always the week on screen: what was due Thursday is still
 * due Thursday, and what had slipped has still slipped. Null when no snapshot
 * has been captured on this machine.
 */
export function loadPersonalSnapshot(today: SqlDate): PersonalSnapshot | null {
  const file = Object.values(files)[0];
  if (!file || file.version !== 1) return null;
  const days = dayNumber(startOfWeekMonday(today)) - dayNumber(startOfWeekMonday(file.capturedOn));
  const date = (value: string | null) =>
    value === null ? null : addSqlDateDays(value as SqlDate, days);
  const instant = (value: string | null) =>
    value === null ? null : new Date(Date.parse(value) + days * DAY_MS).toISOString();
  return {
    ...file,
    todos: file.todos.map((todo) => ({
      ...todo,
      dueDate: date(todo.dueDate),
      completedAt: instant(todo.completedAt),
      recurrence: todo.recurrence
        ? { ...todo.recurrence, until: date(todo.recurrence.until) }
        : null,
    })),
  };
}
