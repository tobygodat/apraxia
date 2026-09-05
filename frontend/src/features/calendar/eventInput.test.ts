import { expect, it } from 'vitest';
import { detailInput, inputValues, newEventInput } from './eventInput';
import type { EventDetail } from '../../../../shared/calendarEventContract';

it('converts a selected time range in the profile timezone, including midnight', () => {
  const input = newEventInput({ day: '2026-09-07', startMinute: 1380, endMinute: 1440 }, 'America/New_York');
  expect(input.end).toBe('2026-09-08T00:00');
  expect(inputValues(input, false).timing).toEqual({ kind: 'timed', start: '2026-09-08T03:00:00Z', end: '2026-09-08T04:00:00Z' });
});
it('preserves exact original instants when editing text on an ambiguous DST event', () => {
  const detail: EventDetail = { eventId: 'event', calendarId: 'personal', etag: 'v1', recurring: false, canMove: true,
    values: { title: 'Planning', location: '', timeZone: 'America/New_York', recurrence: [], timing: { kind: 'timed', start: '2026-11-01T05:30:25Z', end: '2026-11-01T06:30:25Z' } } };
  expect(inputValues({ ...detailInput(detail), title: 'Renamed' }, false, detail).timing).toEqual(detail.values.timing);
});
it('supports the advertised maximum repeat count', () => {
  expect(inputValues({ ...newEventInput({ day: '2026-09-07', startMinute: 540, endMinute: 600 }, 'UTC'), repeat: 'DAILY', repeatEnd: 'count', count: 9999 }, false).recurrence).toEqual(['RRULE:FREQ=DAILY;INTERVAL=1;COUNT=9999']);
});
it('preserves date-only all-day dates and translates inclusive end to exclusive end', () => {
  const input = newEventInput({ day: '2026-03-08', startMinute: 540, endMinute: 600, allDay: true }, 'America/New_York');
  expect(inputValues(input, false).timing).toEqual({ kind: 'all_day', start: '2026-03-08', end: '2026-03-09' });
});
it('rejects daylight saving gaps and ambiguous wall times', () => {
  for (const [day, minute] of [['2026-03-08', 150], ['2026-11-01', 90]] as const) {
    expect(() => inputValues(newEventInput({ day, startMinute: minute, endMinute: minute + 15 }, 'America/New_York'), false)).toThrow(/daylight saving/);
  }
});
it('builds repeat rules with end dates in UTC and preserves instance recurrence', () => {
  const input = { ...newEventInput({ day: '2026-09-07', startMinute: 540, endMinute: 600 }, 'America/New_York'), repeat: 'WEEKLY', repeatEnd: 'until', until: '2026-10-01', interval: 2 };
  expect(inputValues(input, false).recurrence).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261002T035959Z']);
  expect(inputValues(input, true).recurrence).toBeNull();
});
