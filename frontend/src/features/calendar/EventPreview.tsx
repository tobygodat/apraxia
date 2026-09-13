import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Temporal } from '@js-temporal/polyfill';
import type { CalendarEvent } from '../../types/domain';
import type { EventDetail } from '../../../../shared/calendarEventContract';
import type { CalendarService } from './calendarService';
import { calendarEventStyle } from './calendarColors';
import { WorkspaceIcon } from '../../components/WorkspaceIcon';

export function EventPreview({ event, anchor, timezone, service, calendarName, onClose, onEdit }: {
  event: CalendarEvent; anchor: HTMLElement; timezone: string; service?: CalendarService;
  calendarName?: string; onClose: () => void; onEdit?: (event: CalendarEvent) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!!service?.eventDetail);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (service?.eventDetail) {
      setLoading(true); setError('');
      void service.eventDetail(event.calendarId, event.eventId, 'instance', controller.signal)
        .then(value => { if (!controller.signal.aborted) setDetail(value); })
        .catch(() => { if (!controller.signal.aborted) setError('Extra details could not load.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    if (service && onEdit) void service.calendars(controller.signal)
      .then(values => { if (!controller.signal.aborted) setCanEdit(values.some(value => value.calendarId === event.calendarId && value.canEdit)); })
      .catch(() => { /* Keep viewing available when permissions cannot load. */ });
    return () => controller.abort();
  }, [event, service, onEdit, revision]);
  useLayoutEffect(() => {
    const place = () => {
      if (!panel.current) return;
      const rect = anchor.getBoundingClientRect();
      // Layout dimensions stay stable while the entrance transform runs.
      const width = panel.current.offsetWidth;
      const height = panel.current.offsetHeight;
      const left = rect.left - width - 12;
      setPosition({ left: Math.max(12, Math.min(left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(rect.top, window.innerHeight - height - 12)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, detail, loading, error]);
  useEffect(() => {
    panel.current?.focus();
    const outside = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);
      if (anchor.isConnected) anchor.focus();
    };
  }, [anchor, onClose]);
  const date = (value: string) => Temporal.PlainDate.from(value).toLocaleString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timed = (value: string) => new Intl.DateTimeFormat('en', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  const endTime = (value: string) => new Intl.DateTimeFormat('en', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  const sameDay = event.kind === 'timed' && Temporal.Instant.from(event.startAt).toZonedDateTimeISO(timezone).toPlainDate().equals(Temporal.Instant.from(event.endAt).toZonedDateTimeISO(timezone).toPlainDate());
  let url: string | undefined;
  try { if (new URL(event.googleEventUrl).protocol === 'https:') url = event.googleEventUrl; } catch { /* No unsafe external links. */ }
  return createPortal(<div ref={panel} role="dialog" aria-label="Event details" tabIndex={-1} className="event-preview" style={position}>
    <div className="event-preview-heading">
      <span className="event-preview-swatch" style={calendarEventStyle(event.calendarId, event.calendarColor)} aria-hidden="true" />
      <h2>{event.title || 'Untitled event'}</h2>
      <div className="event-preview-actions">
        {canEdit && onEdit && <button aria-label="Edit event" title="Edit event" onClick={() => onEdit(event)}><WorkspaceIcon name="edit" /></button>}
        <button aria-label="Close" title="Close" onClick={onClose}><svg className="workspace-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      </div>
    </div>
    <p>{event.kind === 'timed' ? `${timed(event.startAt)} – ${sameDay ? endTime(event.endAt) : timed(event.endAt)}` : `${date(event.startDate)}${event.endDateExclusive === Temporal.PlainDate.from(event.startDate).add({ days: 1 }).toString() ? '' : ` – ${date(Temporal.PlainDate.from(event.endDateExclusive).subtract({ days: 1 }).toString())}`} · All day`}</p>
    {event.kind === 'timed' && <p className="event-preview-secondary">{timezone.replace(/_/g, ' ')}</p>}
    {detail?.recurring && <p>Repeating event</p>}
    {detail?.values.location && <p className="event-preview-location">{detail.values.location}</p>}
    {calendarName && <p className="event-preview-calendar"><WorkspaceIcon name="calendar" />{calendarName}</p>}
    {loading && <p className="event-preview-secondary" role="status">Loading details…</p>}
    {error && <p role="status">{error} <button onClick={() => setRevision(value => value + 1)}>Retry</button></p>}
    {url && <a href={url} target="_blank" rel="noopener noreferrer">Open in Google Calendar</a>}
  </div>, document.body);
}
