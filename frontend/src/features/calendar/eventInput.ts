import { Temporal } from "@js-temporal/polyfill";
import type { EventDetail, EventValues } from "../../../../shared/calendarEventContract";
import { eventValuesSchema } from "../../../../shared/calendarEventContract";
import { ServiceError } from "../../lib/serviceError";

export interface EventInput {
  title: string;
  location: string;
  calendarId: string;
  allDay: boolean;
  start: string;
  end: string;
  timeZone: string;
  repeat: string;
  interval: number;
  repeatEnd: string;
  until: string;
  count: number;
}
export interface CalendarSlot {
  day: string;
  startMinute: number;
  endMinute: number;
  allDay?: boolean;
}
const local = (day: string, minute: number) =>
  Temporal.PlainDate.from(day)
    .toPlainDateTime()
    .add({ minutes: minute })
    .toString({ smallestUnit: "minute" });
export function newEventInput(slot: CalendarSlot, timezone: string): EventInput {
  return {
    title: "",
    location: "",
    calendarId: "",
    allDay: !!slot.allDay,
    start: local(slot.day, slot.startMinute),
    end: local(slot.day, slot.endMinute),
    timeZone: timezone,
    repeat: "none",
    interval: 1,
    repeatEnd: "never",
    until: slot.day,
    count: 10,
  };
}
/**
 * The subset of the shared RRULE grammar the editor's own fields can express.
 * Anything else stays on "keep" so the rule survives an edit untouched.
 */
const RULE =
  /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;INTERVAL=([1-9]\d?))?(?:;BYDAY=(MO,TU,WE,TH,FR))?(?:;(?:COUNT=([1-9]\d{0,3})|UNTIL=(\d{8})(?:T(\d{6})Z)?))?$/;
type RepeatFields = Pick<EventInput, "repeat" | "interval" | "repeatEnd" | "until" | "count">;
function repeatInput(rule: string, timeZone: string): Partial<RepeatFields> | null {
  const parts = RULE.exec(rule);
  if (!parts) return null;
  const [, frequency, interval, weekdays, count, untilDay, untilTime] = parts;
  if (weekdays && frequency !== "WEEKLY") return null;
  const fields: Partial<RepeatFields> = {
    repeat: weekdays ? "weekdays" : frequency,
    interval: interval ? Number(interval) : 1,
  };
  if (count) return { ...fields, repeatEnd: "count", count: Number(count) };
  if (untilDay) {
    // A date-only UNTIL is already the last repeat date; a UTC instant is the
    // end of that date in the event timezone, so read it back there.
    const day = `${untilDay.slice(0, 4)}-${untilDay.slice(4, 6)}-${untilDay.slice(6)}`;
    const until = untilTime
      ? Temporal.Instant.from(
          `${day}T${untilTime.slice(0, 2)}:${untilTime.slice(2, 4)}:${untilTime.slice(4)}Z`,
        )
          .toZonedDateTimeISO(timeZone)
          .toPlainDate()
          .toString()
      : day;
    return { ...fields, repeatEnd: "until", until };
  }
  return { ...fields, repeatEnd: "never" };
}
export function detailInput(detail: EventDetail): EventInput {
  const { values } = detail;
  const asLocal = (value: string) =>
    Temporal.Instant.from(value)
      .toZonedDateTimeISO(values.timeZone)
      .toPlainDateTime()
      .toString({ smallestUnit: "minute" });
  const allDay = values.timing.kind === "all_day";
  const start = allDay ? `${values.timing.start}T09:00` : asLocal(values.timing.start);
  return {
    // The event's own start date seeds the repeat end field, so an unreadable
    // rule still offers a plausible date instead of a placeholder year.
    ...newEventInput(
      { day: start.slice(0, 10), startMinute: 540, endMinute: 600 },
      values.timeZone,
    ),
    title: values.title,
    location: values.location,
    calendarId: detail.calendarId,
    allDay,
    start,
    end: allDay
      ? `${Temporal.PlainDate.from(values.timing.end).subtract({ days: 1 })}T10:00`
      : asLocal(values.timing.end),
    repeat: detail.recurring ? "keep" : "none",
    ...(detail.recurring ? repeatInput(values.recurrence[0] ?? "", values.timeZone) : null),
  };
}
export function inputValues(
  input: EventInput,
  instance: boolean,
  original?: EventDetail | null,
): EventValues {
  const initial = original ? detailInput(original) : null;
  // An untouched schedule is left to the server so a rule the editor rebuilt
  // from its fields can never drift from the one Google already stores.
  const unchangedRepeat =
    !!initial &&
    original!.recurring &&
    (["repeat", "interval", "repeatEnd", "until", "count"] as const).every(
      (key) => input[key] === initial[key],
    );
  let recurrence: string[] | null =
    input.repeat === "keep" || instance || unchangedRepeat ? null : [];
  if (recurrence && input.repeat !== "none") {
    let rule = `RRULE:FREQ=${input.repeat === "weekdays" ? "WEEKLY" : input.repeat};INTERVAL=${input.interval}`;
    if (input.repeat === "weekdays") rule += ";BYDAY=MO,TU,WE,TH,FR";
    if (input.repeatEnd === "count") rule += `;COUNT=${input.count}`;
    if (input.repeatEnd === "until") {
      if (input.until < input.start.slice(0, 10))
        throw new ServiceError("invalid_input", "Repeat end must be on or after the start date.");
      const end = Temporal.PlainDate.from(input.until);
      rule += input.allDay
        ? `;UNTIL=${end.toString().replace(/-/g, "")}`
        : `;UNTIL=${end.toPlainDateTime("23:59:59").toZonedDateTime(input.timeZone).toInstant().toString().replace(/-/g, "").replace(/:/g, "")}`;
    }
    recurrence = [rule];
  }
  const at = (value: string) => {
    try {
      return Temporal.PlainDateTime.from(value)
        .toZonedDateTime(input.timeZone, { disambiguation: "reject" })
        .toInstant()
        .toString();
    } catch {
      throw new ServiceError(
        "invalid_input",
        "This time is skipped or occurs twice because of daylight saving. Choose an unambiguous time.",
      );
    }
  };
  const unchangedTiming =
    initial &&
    input.start === initial.start &&
    input.end === initial.end &&
    input.allDay === initial.allDay &&
    input.timeZone === initial.timeZone;
  const timing: EventValues["timing"] = unchangedTiming
    ? original!.values.timing
    : input.allDay
      ? {
          kind: "all_day",
          start: input.start.slice(0, 10),
          end: Temporal.PlainDate.from(input.end.slice(0, 10)).add({ days: 1 }).toString(),
        }
      : { kind: "timed", start: at(input.start), end: at(input.end) };
  const parsed = eventValuesSchema.safeParse({
    title: input.title,
    location: input.location,
    timing,
    timeZone: input.timeZone,
    recurrence,
  });
  if (!parsed.success)
    throw new ServiceError(
      "invalid_input",
      "Check the repeat settings and make sure the end is after the start.",
    );
  return parsed.data;
}
