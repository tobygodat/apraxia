import { Temporal } from "@js-temporal/polyfill";
import type { AllDayCalendarEvent, CalendarEvent, TimedCalendarEvent } from "../../types/domain";

export interface AllDaySegment {
  event: AllDayCalendarEvent;
  startColumn: number;
  endColumn: number;
  lane: number;
}

/** One span per event, with exclusive end columns and stable non-overlapping lanes. */
export function layoutAllDayEvents(events: readonly CalendarEvent[], sunday: string): AllDaySegment[] {
  const first = Temporal.PlainDate.from(sunday);
  const last = first.add({ days: 7 });
  const segments: AllDaySegment[] = [];
  for (const event of events) {
    if (event.kind !== "all_day") continue;
    const start = Temporal.PlainDate.from(event.startDate);
    const end = Temporal.PlainDate.from(event.endDateExclusive);
    if (Temporal.PlainDate.compare(end, first) <= 0 || Temporal.PlainDate.compare(start, last) >= 0 || Temporal.PlainDate.compare(end, start) <= 0) continue;
    segments.push({
      event,
      startColumn: Math.max(0, first.until(start).days),
      endColumn: Math.min(7, first.until(end).days),
      lane: 0,
    });
  }
  segments.sort((a, b) => a.startColumn - b.startColumn || b.endColumn - a.endColumn || `${a.event.calendarId}/${a.event.eventId}`.localeCompare(`${b.event.calendarId}/${b.event.eventId}`));
  const laneEnds: number[] = [];
  for (const segment of segments) {
    let lane = laneEnds.findIndex(end => end <= segment.startColumn);
    if (lane < 0) lane = laneEnds.length;
    segment.lane = lane;
    laneEnds[lane] = segment.endColumn;
  }
  return segments;
}

export interface TimedSegment {
  event: TimedCalendarEvent;
  day: string;
  start: number;
  end: number;
  column: number;
  columns: number;
}
export function startOfWeekSunday(value: string): string {
  const date = Temporal.PlainDate.from(value);
  return date.subtract({ days: date.dayOfWeek % 7 }).toString();
}
export function weekDates(sunday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => Temporal.PlainDate.from(sunday).add({ days: i }).toString());
}
export function wallMinute(instant: Temporal.Instant, timezone: string): number {
  const time = instant.toZonedDateTimeISO(timezone);
  return time.hour * 60 + time.minute + time.second / 60;
}
/** Clip in instant space (including DST), then lay out in local wall-clock space. */
export function layoutTimedEvents(events: readonly CalendarEvent[], sunday: string, timezone: string): TimedSegment[] {
  return weekDates(sunday).flatMap((day) => {
    const date = Temporal.PlainDate.from(day);
    const startOfDay = date.toZonedDateTime(timezone).toInstant();
    const endOfDay = date.add({ days: 1 }).toZonedDateTime(timezone).toInstant();
    const segments: TimedSegment[] = [];
    for (const event of events) {
      if (event.kind !== "timed") continue;
      const start = Temporal.Instant.from(event.startAt);
      const end = Temporal.Instant.from(event.endAt);
      if (Temporal.Instant.compare(end, startOfDay) <= 0 || Temporal.Instant.compare(start, endOfDay) >= 0 || Temporal.Instant.compare(end, start) <= 0) continue;
      const from = Temporal.Instant.compare(start, startOfDay) < 0 ? 0 : wallMinute(start, timezone);
      const to = Temporal.Instant.compare(end, endOfDay) >= 0 ? 1440 : wallMinute(end, timezone);
      // Reserve one readable row at the compact time scale, including in overlap lanes.
      segments.push({ event, day, start: from, end: Math.min(1440, Math.max(from + 30, to)), column: 0, columns: 1 });
    }
    segments.sort((a, b) => a.start - b.start || b.end - a.end || `${a.event.calendarId}/${a.event.eventId}`.localeCompare(`${b.event.calendarId}/${b.event.eventId}`));
    let group: TimedSegment[] = [];
    let ends: number[] = [];
    const finish = () => { for (const item of group) item.columns = ends.length; group = []; ends = []; };
    for (const item of segments) {
      if (group.length && ends.every((end) => end <= item.start)) finish();
      let column = ends.findIndex((end) => end <= item.start);
      if (column < 0) column = ends.length;
      ends[column] = item.end;
      item.column = column;
      group.push(item);
    }
    finish();
    return segments;
  });
}
