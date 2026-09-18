import type { TodoRecurrence, TodoRecurrenceFreq } from "../../types/domain";
import { formatTaskDate } from "./taskFormatting";

export const RECURRENCE_FREQS: readonly TodoRecurrenceFreq[] = ["daily", "weekly", "monthly"];

/** Matches the database check on `recurrence_interval`. */
export const MAX_RECURRENCE_INTERVAL = 52;

const EVERY_LABEL: Record<TodoRecurrenceFreq, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const PERIOD_LABEL: Record<TodoRecurrenceFreq, string> = {
  daily: "days",
  weekly: "weeks",
  monthly: "months",
};

/** Menu label for one frequency: "Weekly". */
export function recurrenceFreqLabel(freq: TodoRecurrenceFreq): string {
  return EVERY_LABEL[freq];
}

/** Unit shown beside an interval box: "weeks". */
export function recurrencePeriodLabel(freq: TodoRecurrenceFreq): string {
  return PERIOD_LABEL[freq];
}

export function isRecurrenceFreq(value: unknown): value is TodoRecurrenceFreq {
  return RECURRENCE_FREQS.includes(value as TodoRecurrenceFreq);
}

export function isRecurrenceInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_RECURRENCE_INTERVAL
  );
}

/** "Weekly", "Every 2 weeks" — the short form shown beside a task. */
export function formatRecurrence(recurrence: TodoRecurrence): string {
  return recurrence.interval === 1
    ? EVERY_LABEL[recurrence.freq]
    : `Every ${recurrence.interval} ${PERIOD_LABEL[recurrence.freq]}`;
}

/** The sentence form used for titles and assistive text. */
export function describeRecurrence(recurrence: TodoRecurrence): string {
  const repeats = `Repeats ${formatRecurrence(recurrence).toLowerCase()}`;
  return recurrence.until === null
    ? `${repeats}.`
    : `${repeats} until ${formatTaskDate(recurrence.until, { month: "short", day: "numeric" })}.`;
}
