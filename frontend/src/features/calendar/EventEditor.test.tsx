// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EventEditor } from './EventEditor';
import { WeekGrid } from './HomePage';
import type { CalendarService } from './calendarService';
import type { EventDetail } from '../../../../shared/calendarEventContract';

afterEach(cleanup);
const slot = { day: '2026-09-07', startMinute: 540, endMinute: 600 };
const detail: EventDetail = { eventId: 'event', calendarId: 'personal', etag: 'v1', recurring: true, canMove: true,
  values: { title: 'Planning', location: 'Library', timeZone: 'UTC', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'], timing: { kind: 'timed', start: '2026-09-07T09:00:00Z', end: '2026-09-07T10:00:00Z' } } };
const preferences = [{ id: 'personal', calendarId: 'personal', displayName: 'Personal', isVisible: true, canEdit: true }];
it('protects dirty drafts on Close and Escape, retaining edits until explicitly discarded', async () => {
  const onClose = vi.fn();
  render(<MemoryRouter><EventEditor service={{ calendars: async () => preferences } as unknown as CalendarService} timezone="UTC" slot={slot} onClose={onClose} onSaved={vi.fn()} /></MemoryRouter>);
  const title = await screen.findByLabelText('Title');
  fireEvent.change(title, { target: { value: 'Keep this draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect((title as HTMLInputElement).value).toBe('Keep this draft');
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
it('closes an unchanged draft without prompting after default calendar selection', async () => {
  const onClose = vi.fn();
  render(<MemoryRouter><EventEditor service={{ calendars: async () => preferences } as unknown as CalendarService} timezone="UTC" slot={slot} onClose={onClose} onSaved={vi.fn()} /></MemoryRouter>);
  await screen.findByLabelText('Title');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Discard your unsaved changes?')).toBeNull();
});
it('retains input after a failed save and reuses the same draft id on retry', async () => {
  const mutateEvent = vi.fn().mockRejectedValueOnce(new Error('Could not save')).mockResolvedValue({ saved: true });
  const onSaved = vi.fn();
  render(<MemoryRouter><EventEditor service={{ calendars: async () => preferences, mutateEvent } as unknown as CalendarService} timezone="UTC" slot={slot} onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Writing time' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
  await screen.findByText('Could not save');
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Writing time');
  fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Event saved.'));
  expect(mutateEvent.mock.calls[0][0].eventId).toBe(mutateEvent.mock.calls[1][0].eventId);
});
it('loads the chosen recurring scope and requires confirmation before deleting a series', async () => {
  const eventDetail = vi.fn(async () => detail); const mutateEvent = vi.fn(async () => ({ saved: true }));
  render(<MemoryRouter><EventEditor service={{ calendars: async () => preferences, eventDetail, mutateEvent } as unknown as CalendarService} timezone="UTC" slot={slot}
    event={{ kind: 'timed', eventId: 'event', calendarId: 'personal', title: 'Planning', startAt: detail.values.timing.start, endAt: detail.values.timing.end, startTimeZone: 'UTC', endTimeZone: 'UTC', calendarColor: { background: null, foreground: null }, googleEventUrl: 'https://calendar.google.com' }} onClose={vi.fn()} onSaved={vi.fn()} /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('Apply changes to'), { target: { value: 'series' } });
  await waitFor(() => expect(eventDetail).toHaveBeenLastCalledWith('personal', 'event', 'series', expect.any(AbortSignal)));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete event' }));
  expect(mutateEvent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  await waitFor(() => expect(mutateEvent).toHaveBeenCalledWith({ action: 'delete', eventId: 'event', calendarId: 'personal', etag: 'v1', scope: 'series' }));
});
it('keeps text edits across scope changes and confirms before discarding edited times', async () => {
  const eventDetail = vi.fn(async () => detail);
  render(<MemoryRouter><EventEditor service={{ calendars: async () => preferences, eventDetail } as unknown as CalendarService} timezone="UTC" slot={slot}
    event={{ kind: 'timed', eventId: 'event', calendarId: 'personal', title: 'Planning', startAt: detail.values.timing.start, endAt: detail.values.timing.end, startTimeZone: 'UTC', endTimeZone: 'UTC', calendarColor: { background: null, foreground: null }, googleEventUrl: 'https://calendar.google.com' }} onClose={vi.fn()} onSaved={vi.fn()} /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Updated title' } });
  fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-09-07T11:00' } });
  fireEvent.change(screen.getByLabelText('Apply changes to'), { target: { value: 'series' } });
  expect(eventDetail).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Switch scope' }));
  await waitFor(() => expect(eventDetail).toHaveBeenCalledTimes(2));
  expect((await screen.findByLabelText('Title') as HTMLInputElement).value).toBe('Updated title');
  expect((screen.getByLabelText('Ends') as HTMLInputElement).value).toBe('2026-09-07T10:00');
});
it('selects forward and backward drag ranges in 15-minute steps, with a keyboard alternative', () => {
  const onCreate = vi.fn();
  render(<WeekGrid week={{ timezone: 'UTC', range: { monday: slot.day, sunday: '2026-09-13' }, events: [], partialErrors: [], visibleCalendars: [] }} now={new Date('2026-09-07T12:00:00Z')} onCreate={onCreate} />);
  const column = screen.getByLabelText('Add event on 2026-09-07; press Enter for event details');
  column.setPointerCapture = vi.fn(); column.releasePointerCapture = vi.fn();
  for (const [start, end] of [[30, 75], [75, 30]]) {
    fireEvent.pointerDown(column, { button: 0, pointerId: 1, clientY: start });
    fireEvent.pointerMove(column, { pointerId: 1, clientY: end });
    fireEvent.pointerUp(column, { pointerId: 1, clientY: end });
    expect(onCreate).toHaveBeenLastCalledWith({ day: slot.day, startMinute: 540, endMinute: 645 });
  }
  fireEvent.keyDown(column, { key: 'Enter' });
  expect(onCreate).toHaveBeenLastCalledWith(slot);
  expect(screen.queryByLabelText('Add all-day event on 2026-09-07')).toBeNull();
});
