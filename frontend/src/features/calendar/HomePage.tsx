import { useEffect, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { Link } from "react-router-dom";
import type { CalendarEvent, Profile, ProjectSummary, WeekViewModel } from "../../types/domain";
import { TodayPanel } from "../todos/TodayPanel";
import type { TodoService } from "../todos/todoService";
import { addSqlDateDays, localToday, startOfWeekMonday } from "../todos/dateDomain";
import { CalendarServiceError, type CalendarService } from "./calendarService";
import { layoutAllDayEvents, layoutTimedEvents, wallMinute, weekDates } from "./eventLayout";
import { EventEditor } from "./EventEditor";
import type { CalendarSlot } from "./eventInput";
import "./calendar.css";

export interface HomePageProps {
  todoService: TodoService;
  calendarService: CalendarService;
  profile: Profile;
  projects: readonly ProjectSummary[];
  workspaceSessionKey: string;
  refreshKey?: string | number;
}
export function HomePage({ todoService, calendarService, profile, projects, workspaceSessionKey, refreshKey }: HomePageProps) {
  return <div className="home-workspace">

    <CalendarPanel service={calendarService} timezone={profile.timezone} />

    <TodayPanel
      service={todoService}
      profile={profile}
      projects={projects}
      workspaceSessionKey={workspaceSessionKey}
      refreshKey={refreshKey} />

  </div>;
}
export function CalendarPanel({ service, timezone }: { service: CalendarService; timezone: string }) {
  const [now, setNow] = useState(() => new Date());
  const today = localToday(timezone, now);
  const [monday, setMonday] = useState(() => startOfWeekMonday(today));
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{ slot: CalendarSlot; event?: CalendarEvent } | null>(null);
  const [notice, setNotice] = useState('');
  const editable = !!service.mutateEvent && !!service.eventDetail;
  const [state, setState] = useState<{ loading: boolean; week: WeekViewModel | null; error: string | null; connect: boolean }>({ loading: true, week: null, error: null, connect: false });
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  const [lastLoadedAt, setLastLoadedAt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ loading: true, week: previous.week?.range.monday === monday && previous.week.timezone === timezone ? previous.week : null, error: null, connect: false }));
    // Home owns one direct week read. Settings owns connection status; this
    // prevents a slow status read from serializing every Home load.
    const load = service.week
      ? service.week(monday, controller.signal)
      // Compatibility for isolated fixture doubles from older clients. The
      // production service always has week().
      : service.status(controller.signal).then(() => ({ range: { monday, sunday: monday }, timezone, events: [], visibleCalendars: [], partialErrors: [] }));
    void load.then((week) => {
      if (!controller.signal.aborted) { setLastLoadedAt(Date.now()); setState({ loading: false, week, error: null, connect: false }); }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState((previous) => ({
        loading: false,
        week: error instanceof CalendarServiceError && ["reconnect_required", "disconnected", "unauthenticated"].includes(error.code) ? null : previous.week,
        error: error instanceof Error ? error.message : "Calendar is unavailable.",
        connect: error instanceof CalendarServiceError && ["reconnect_required", "disconnected"].includes(error.code),
      }));
    });
    return () => controller.abort();
  }, [service, monday, revision, timezone]);
  useEffect(() => {
    let timer: number | undefined;
    const refreshIfNeeded = () => {
      if (document.visibilityState !== "visible" || timer !== undefined) return;
      if (!state.error && Date.now() - lastLoadedAt <= 60_000) return;
      timer = window.setTimeout(() => { timer = undefined; setRevision(value => value + 1); }, 100);
    };
    window.addEventListener("focus", refreshIfNeeded);
    document.addEventListener("visibilitychange", refreshIfNeeded);
    return () => { if (timer !== undefined) clearTimeout(timer); window.removeEventListener("focus", refreshIfNeeded); document.removeEventListener("visibilitychange", refreshIfNeeded); };
  }, [lastLoadedAt, state.error]);
  // Do not flash a previous week's events while the new request effect starts.
  const visibleWeek = state.week?.range.monday === monday && state.week.timezone === timezone ? state.week : null;
  const dates = weekDates(monday);
  const label = Temporal.PlainDate.from(monday).toLocaleString("en", { month: "long", day: "numeric" });
  const last = Temporal.PlainDate.from(dates[6]).toLocaleString("en", { month: "short", day: "numeric", year: "numeric" });
  return <section className="calendar-panel" aria-label="Weekly calendar">

    <header className="calendar-header">
      <div>
        <h1>
          {`${label} – ${last}`}
        </h1>
        <p>
          {timezone.replace(/_/g, " ")}
        </p>
      </div>

      <div className="calendar-controls">
        {editable && <button disabled={!visibleWeek || state.loading} onClick={() => setEditor({ slot: { day: dates.includes(today) ? today : monday, startMinute: 540, endMinute: 600 } })}>Add event</button>}
        <button aria-label="Previous week" onClick={() => setMonday(addSqlDateDays(monday, -7))}>←</button>
        <button onClick={() => setMonday(startOfWeekMonday(today))}>Today</button>
        <button aria-label="Next week" onClick={() => setMonday(addSqlDateDays(monday, 7))}>→</button>
        <button onClick={() => { service.invalidate?.(); setRevision((value) => value + 1); }} disabled={state.loading}>Refresh</button>
      </div>

    </header>

    {notice && <p className="calendar-warning" role="status">{notice}</p>}
    {editor && <EventEditor service={service} timezone={timezone} {...editor} onClose={() => setEditor(null)} onSaved={message => { setEditor(null); setNotice(message); service.invalidate?.(); setRevision(value => value + 1); }} />}
    {state.loading && !visibleWeek && <p className="calendar-message" role="status">Loading your week…</p>}

    {state.loading && visibleWeek && <p className="calendar-empty" role="status">Refreshing your week…</p>}

    {state.connect && <div className="calendar-message">
      <h2>Your week, alongside Today</h2>
      <p>
        {state.error ?? "Connect Google Calendar to see your events here."}
      </p>
      <Link to="/settings">Connect Calendar</Link>
    </div>}

    {state.error && !state.connect && <div className={visibleWeek ? "calendar-warning" : "calendar-message"} role="alert">
      <p>
        {state.error}
        {visibleWeek ? " Showing your last loaded events." : ""}
      </p>
      <button onClick={() => setRevision((value) => value + 1)}>Try again</button>
    </div>}

    {visibleWeek && <>
      {!!visibleWeek.partialErrors.length && <div className="calendar-warning" role="status">
        {visibleWeek.partialErrors.map((error) => <p key={error.calendarId}>
          {`${error.calendarDisplayName}: ${error.userMessage}`}
        </p>)}
      </div>}
      {visibleWeek.events.length === 0 && <p className="calendar-empty">
        {visibleWeek.visibleCalendars.length ? "No events this week." : <>No calendars are visible. <Link to="/settings">Choose calendars</Link></>}
      </p>}
      <WeekGrid key={monday} week={visibleWeek} now={now} onCreate={editable ? slot => setEditor({ slot }) : undefined} onEdit={editable ? event => setEditor({ event, slot: { day: monday, startMinute: 540, endMinute: 600 } }) : undefined} />
    </>}

  </section>;
}
export function WeekGrid({ week, now, onCreate, onEdit }: { week: WeekViewModel; now: Date; onCreate?: (slot: CalendarSlot) => void; onEdit?: (event: CalendarEvent) => void }) {
  const [selection, setSelection] = useState<{ day: string; anchor: number; minute: number } | null>(null);
  const drag = useRef<{ day: string; anchor: number; minute: number } | null>(null);
  const minuteAt = (element: HTMLElement, y: number) => Math.max(0, Math.min(1425, Math.floor((y - element.getBoundingClientRect().top) / 15) * 15));
  const clearSelection = () => { drag.current = null; setSelection(null); };
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 8 * 60; }, []);
  const days = weekDates(week.range.monday);
  const segments = layoutTimedEvents(week.events, week.range.monday, week.timezone);
  const allDaySegments = layoutAllDayEvents(week.events, week.range.monday);
  const today = localToday(week.timezone, now);
  const currentMinute = wallMinute(Temporal.Instant.from(now.toISOString()), week.timezone);
  const time = (at: string) => new Intl.DateTimeFormat("en", { timeZone: week.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
  const link = (url: string) => { try { const parsed = new URL(url); return parsed.protocol === "https:" ? url : undefined; } catch { return undefined; } };
  return <div className="week-grid">

    <div className="week-head">
      <span />
      <div className="week-days">
        {days.map((day) => <div key={day} className={day === today ? "is-today" : ""}>
          <span>
            {Temporal.PlainDate.from(day).toLocaleString("en", { weekday: "short" })}
          </span>
          <strong>
            {Temporal.PlainDate.from(day).day}
          </strong>
        </div>)}
      </div>
    </div>

    {(allDaySegments.length > 0 || onCreate) && <div className="week-all-day">
      <span>All day</span>
      <div className="week-days week-all-day-lanes">
          {onCreate && days.map((day, index) => <button key={day} className="week-all-day-add" aria-label={`Add all-day event on ${day}`} style={{ gridColumn: index + 1, gridRow: 1 }} onClick={() => onCreate({ day, startMinute: 540, endMinute: 600, allDay: true })}>+</button>)}
          {allDaySegments.map(({ event, startColumn, endColumn, lane }) => <a
            className="calendar-event calendar-event--all-day"
            key={`${event.calendarId}/${event.eventId}`}
            role={onEdit ? "button" : undefined}
            onClick={e => { if (onEdit) { e.preventDefault(); onEdit(event); } }}
            onKeyDown={e => { if (onEdit && e.key === ' ') { e.preventDefault(); onEdit(event); } }}
            href={link(event.googleEventUrl)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ borderLeftColor: event.calendarColor.background ?? undefined, gridColumn: `${startColumn + 1} / ${endColumn + 1}`, gridRow: lane + (onCreate ? 2 : 1) }}
            aria-label={`${event.title}, all day, ${event.startDate} through ${addSqlDateDays(event.endDateExclusive, -1)}`}
            title={event.title}>
            {event.title}
          </a>)}
      </div>
    </div>}

    <div
      className="week-scroll"
      ref={scroll}
      tabIndex={0}
      aria-label="24-hour calendar grid">
      <div className="week-hours">
        <div className="week-time-labels">
          {Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * 60 }}>
            {hour === 0 ? "12 am" : hour < 12 ? `${hour} am` : hour === 12 ? "12 pm" : `${hour - 12} pm`}
          </span>)}
        </div>
        <div className="week-days week-timed-days">
          {days.map((day) => <div key={day} className={onCreate ? "week-day-column week-day-column--editable" : "week-day-column"}
            onPointerDown={e => {
              if (!onCreate || e.button !== 0 || (e.target as HTMLElement).closest('a,button')) return;
              e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
              const minute = minuteAt(e.currentTarget, e.clientY);
              drag.current = { day, anchor: minute, minute }; setSelection(drag.current);
            }}
            onPointerMove={e => {
              if (!drag.current || drag.current.day !== day) return;
              const viewport = scroll.current?.getBoundingClientRect();
              if (viewport && scroll.current) {
                if (e.clientY > viewport.bottom - 30) scroll.current.scrollTop += 20;
                else if (e.clientY < viewport.top + 30) scroll.current.scrollTop -= 20;
              }
              drag.current = { ...drag.current, minute: minuteAt(e.currentTarget, e.clientY) }; setSelection(drag.current);
            }}
            onPointerUp={e => {
              const current = drag.current;
              if (!current) return;
              e.currentTarget.releasePointerCapture(e.pointerId); clearSelection();
              onCreate?.({ day, startMinute: Math.min(current.anchor, current.minute), endMinute: Math.max(current.anchor, current.minute) + 15 });
            }}
            onPointerCancel={clearSelection} onLostPointerCapture={clearSelection}
            tabIndex={onCreate ? 0 : undefined} aria-label={onCreate ? `Add event on ${day}; press Enter for event details` : undefined}
            onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Escape') clearSelection(); if (onCreate && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onCreate({ day, startMinute: 540, endMinute: 600 }); } }}>
            {selection?.day === day && <div className="calendar-selection" style={{ top: Math.min(selection.anchor, selection.minute), height: Math.abs(selection.anchor - selection.minute) + 15 }}>New event</div>}
            {segments.filter((segment) => segment.day === day).map((segment) => <a
              key={`${segment.event.calendarId}/${segment.event.eventId}`}
              className="calendar-event calendar-event--timed"
              role={onEdit ? "button" : undefined}
              onClick={e => { if (onEdit) { e.preventDefault(); onEdit(segment.event); } }}
              onKeyDown={e => { if (onEdit && e.key === ' ') { e.preventDefault(); onEdit(segment.event); } }}
              href={link(segment.event.googleEventUrl)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${segment.event.title}, ${time(segment.event.startAt)}–${time(segment.event.endAt)}`}
              title={`${segment.event.title}, ${time(segment.event.startAt)}–${time(segment.event.endAt)}`}
              style={{ top: segment.start, height: segment.end - segment.start, left: `${segment.column / segment.columns * 100}%`, width: `${100 / segment.columns}%`, borderLeftColor: segment.event.calendarColor.background ?? undefined }}>
              <strong>
                {segment.event.title}
              </strong>
              <span>
                {time(segment.event.startAt)}
              </span>
            </a>)}
            {day === today && <div
              className="week-now"
              style={{ top: currentMinute }}
              aria-label={`Current time: ${time(now.toISOString())}`} />}
          </div>)}
        </div>
      </div>
    </div>

  </div>;
}
