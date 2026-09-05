import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';

const identifier = z.string().min(1).max(1024).refine(value => !/[\s\u0000-\u001f\u007f]/u.test(value) && value !== '.' && value !== '..');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try { Temporal.PlainDate.from(value, { overflow: 'reject' }); return true; } catch { return false; }
});
const instant = z.string().max(64).refine(value => {
  try { Temporal.Instant.from(value); return true; } catch { return false; }
});
const timeZone = z.string().max(128).refine(value => {
  try { return !/^[+-]/.test(value) && !!Temporal.Now.instant().toZonedDateTimeISO(value); } catch { return false; }
});
export const eventValuesSchema = z.object({
  title: z.string().trim().max(1024), location: z.string().trim().max(4096), timeZone,
  timing: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('all_day'), start: date, end: date }).strict(),
    z.object({ kind: z.literal('timed'), start: instant, end: instant }).strict(),
  ]),
  // null preserves an existing rule, including unsupported Google recurrence rules.
  recurrence: z.array(z.string().regex(/^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;INTERVAL=([1-9]|[1-9]\d))?(;BYDAY=(MO,TU,WE,TH,FR))?(;(COUNT=[1-9]\d{0,3}|UNTIL=\d{8}(T\d{6}Z)?))?$/)).max(1).nullable(),
}).strict().refine(({ timing }) => {
  try { return timing.kind === 'all_day' ? Temporal.PlainDate.compare(timing.start, timing.end) < 0 : Temporal.Instant.compare(timing.start, timing.end) < 0; } catch { return false; }
}, 'End must be after start.');
const target = { calendarId: identifier, eventId: identifier, scope: z.enum(['instance', 'series']) };
export const eventCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('detail'), ...target }).strict(),
  z.object({ action: z.literal('create'), calendarId: identifier, eventId: z.string().regex(/^[a-v0-9]{32}$/), values: eventValuesSchema }).strict(),
  z.object({ action: z.literal('update'), ...target, etag: z.string().min(1).max(256), destinationCalendarId: identifier, values: eventValuesSchema }).strict(),
  z.object({ action: z.literal('delete'), ...target, etag: z.string().min(1).max(256) }).strict(),
]);
export type EventValues = z.infer<typeof eventValuesSchema>;
export type EventCommand = z.infer<typeof eventCommandSchema>;
export interface EventDetail {
  eventId: string; calendarId: string; etag: string; recurring: boolean; canMove: boolean;
  values: Omit<EventValues, 'recurrence'> & { recurrence: string[] };
}
export interface EventMutationResult { saved: true; warning?: string }
