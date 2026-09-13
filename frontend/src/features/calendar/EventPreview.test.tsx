// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventPreview } from './EventPreview';
import type { CalendarEvent } from '../../types/domain';
import type { CalendarService } from './calendarService';

afterEach(cleanup);
const event: CalendarEvent = { kind: 'timed', eventId: 'event', calendarId: 'work', title: 'A long event title that must remain readable', calendarColor: { background: '#008000', foreground: null }, googleEventUrl: 'https://calendar.google.com/calendar/event?eid=event', startAt: '2026-09-07T09:00:00Z', endAt: '2026-09-07T10:00:00Z', startTimeZone: 'UTC', endTimeZone: 'UTC' };
const detail = { eventId: 'event', calendarId: 'work', etag: 'v1', recurring: true, canMove: true, values: { title: event.title, location: 'Skiles 268', timeZone: 'UTC', recurrence: [], timing: { kind: 'timed' as const, start: event.startAt, end: event.endAt } } };
it('keeps the location from the week available when extra details cannot load', async () => {
  const service = { eventDetail: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as CalendarService;
  render(<EventPreview event={{ ...event, location: 'Hall 204' }} anchor={document.body} timezone="UTC" service={service} onClose={vi.fn()} />);
  expect(screen.getByText('Hall 204')).toBeTruthy();
  await screen.findByText('Extra details could not load.');
  expect(screen.getByText('Hall 204')).toBeTruthy();
});

it('loads details and exposes editing only after writable permission is known', async () => {
  const onEdit = vi.fn();
  const service = { eventDetail: vi.fn(async () => detail), calendars: async () => [{ calendarId: 'work', canEdit: true }] } as unknown as CalendarService;
  render(<EventPreview event={event} anchor={document.body} timezone="UTC" calendarName="Work calendar" service={service} onClose={vi.fn()} onEdit={onEdit} />);
  expect(screen.queryByRole('button', { name: 'Edit event' })).toBeNull();
  expect(await screen.findByText('Skiles 268')).toBeTruthy();
  expect(screen.getByText('Repeating event')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit event' }));
  expect(onEdit).toHaveBeenCalledWith(event);
  expect(service.eventDetail).toHaveBeenCalledWith('work', 'event', 'instance', expect.any(AbortSignal));
});
it('retains basic details on load failure, supports retry, and leaves read-only events viewable', async () => {
  const service = { eventDetail: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(detail), calendars: async () => [{ calendarId: 'work', canEdit: false }] } as unknown as CalendarService;
  render(<EventPreview event={event} anchor={document.body} timezone="UTC" service={service} onClose={vi.fn()} onEdit={vi.fn()} />);
  await screen.findByText('Extra details could not load.');
  expect(screen.getByRole('heading', { name: event.title })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open in Google Calendar' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Skiles 268');
  expect(screen.queryByRole('button', { name: 'Edit event' })).toBeNull();
});
it('uses date-only all-day boundaries and rejects unsafe external links', () => {
  const onClose = vi.fn();
  const allDay: CalendarEvent = { kind: 'all_day', eventId: 'trip', calendarId: 'work', title: 'Trip', calendarColor: event.calendarColor, googleEventUrl: 'javascript:alert(1)', startDate: '2026-09-07', endDateExclusive: '2026-09-09' };
  render(<EventPreview event={allDay} anchor={document.body} timezone="America/Los_Angeles" onClose={onClose} />);
  expect(screen.getByText('Monday, September 7, 2026 – Tuesday, September 8, 2026 · All day')).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});
