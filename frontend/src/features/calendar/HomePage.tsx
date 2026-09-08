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
import { HomeHeader } from "./HomeHeader";
import type { HomeAppearanceService } from "./homeAppearance";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { calendarAccent, calendarEventStyle } from "./calendarColors";
import "./calendar.css";

export interface HomePageProps {
  appearanceService?: HomeAppearanceService;
  todoService: TodoService;
  calendarService: CalendarService;
  profile: Profile;
  projects: readonly ProjectSummary[];
  workspaceSessionKey: string;
  refreshKey?: string | number;
}
export function HomePage({ todoService, calendarService, profile, projects, workspaceSessionKey, refreshKey, appearanceService }: HomePageProps) {
  const page = useRef<HTMLDivElement>(null);
  return <div className="home-page" ref={page}>
    <HomeHeader service={appearanceService} userId={profile.userId} scrollRef={page} />
    <div className="home-workspace">
      <CalendarPanel service={calendarService} timezone={profile.timezone} />
      <TodayPanel
        heading="Tasks"
        allowTomorrow
        service={todoService}
        profile={profile}
        projects={projects}
        workspaceSessionKey={workspaceSessionKey}
        refreshKey={refreshKey} />
    </div>
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
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ loading: true, week: previous.week?.range.monday === monday && previous.week.timezone === timezone ? previous.week : null, error: null, connect: false }));
    void service.status(controller.signal).then(async (status) => {
      if (!status || status.connectionState !== "connected") {
        if (!controller.signal.aborted) setState({ loading: false, week: null, error: null, connect: true });
        return;
      }
      const week = await service.week(monday, controller.signal);
      if (!controller.signal.aborted) setState({ loading: false, week, error: null, connect: false });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState((previous) => ({
        loading: false,
        week: error instanceof CalendarServiceError && ["reconnect_required", "unauthenticated"].includes(error.code) ? null : previous.week,
        error: error instanceof Error ? error.message : "Calendar is unavailable.",
        connect: error instanceof CalendarServiceError && error.code === "reconnect_required",
      }));
    });
    return () => controller.abort();
  }, [service, monday, revision, timezone]);
  // Do not flash a previous week's events while the new request effect starts.
  const visibleWeek = state.week?.range.monday === monday && state.week.timezone === timezone ? state.week : null;
  const dates = weekDates(monday);
  const label = Temporal.PlainDate.from(monday).toLocaleString("en", { month: "long", day: "numeric" });
  const last = Temporal.PlainDate.from(dates[6]).toLocaleString("en", { month: "short", day: "numeric", year: "numeric" });
  return <section className="calendar-panel" aria-label="Weekly calendar">

    <header className="calendar-header">
      <div>
        <h2>
          {`${label} – ${last}`}
        </h2>
      </div>

      <div className="calendar-controls">
        {editable && <button className="calendar-add" disabled={!visibleWeek || state.loading} onClick={() => setEditor({ slot: { day: dates.includes(today) ? today : monday, startMinute: 540, endMinute: 600 } })}><WorkspaceIcon name="plus" />Add event</button>}
        <button className="calendar-icon-button" aria-label="Previous week" title="Previous week" onClick={() => setMonday(addSqlDateDays(monday, -7))}><WorkspaceIcon name="left" /></button>
        <button onClick={() => setMonday(startOfWeekMonday(today))}>Today</button>
        <button className="calendar-icon-button" aria-label="Next week" title="Next week" onClick={() => setMonday(addSqlDateDays(monday, 7))}><WorkspaceIcon name="right" /></button>
        <button className="calendar-icon-button" aria-label="Refresh" title="Refresh calendar" onClick={() => { service.invalidate?.(); setRevision((value) => value + 1); }} disabled={state.loading}><WorkspaceIcon name="refresh" /></button>
      </div>

    </header>

    {notice && <p className="calendar-warning" role="status">{notice}</p>}
    {editor && <EventEditor service={service} timezone={timezone} {...editor} onClose={() => setEditor(null)} onSaved={message => { setEditor(null); setNotice(message); service.invalidate?.(); setRevision(value => value + 1); }} />}
    {state.loading && !visibleWeek && <p className="calendar-message" role="status">Loading your week…</p>}

    {state.loading && visibleWeek && <p className="calendar-empty" role="status">Refreshing your week…</p>}

    {state.connect && <div className="calendar-message">
      <h3>Connect your calendar</h3>
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
      <div className="calendar-subheader">
        <ul className="calendar-legend" aria-label="Visible calendars">
          {visibleWeek.visibleCalendars.map(calendar => <li key={calendar.calendarId}>
            <span className="calendar-swatch" style={{ backgroundColor: calendarAccent(calendar.calendarId, calendar.color) }} aria-hidden="true" />
            <span title={calendar.displayName}>{calendar.displayName}</span>
          </li>)}
        </ul>
        <span className="calendar-view-label">Week</span>
      </div>
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
    <footer className="calendar-footer"><WorkspaceIcon name="clock" /><span>{timezone.replace(/_/g, " ")}</span></footer>
  </section>;
}
export function WeekGrid({ week, now, onCreate, onEdit }: { week: WeekViewModel; now: Date; onCreate?: (slot: CalendarSlot) => void; onEdit?: (event: CalendarEvent) => void }) {
  const [selection, setSelection] = useState<{ day: string; anchor: number; minute: number } | null>(null);
  const drag = useRef<{ day: string; anchor: number; minute: number } | null>(null);
  const minuteAt = (element: HTMLElement, y: number) => Math.max(0, Math.min(1425, Math.floor((y - element.getBoundingClientRect().top) / 15) * 15));
  const clearSelection = () => { drag.current = null; setSelection(null); };
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 8 * 60 - 8; }, []);
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
        {days.map((day) => <div key={day} className={day === today ? "is-today" : ""} aria-current={day === today ? "date" : undefined}>
          <span>
            {Temporal.PlainDate.from(day).toLocaleString("en", { weekday: "short" })}
          </span>
          <strong>
            {Temporal.PlainDate.from(day).day}
          </strong>
        </div>)}
      </div>
    </div>

    {(allDaySegments.length > 0) && <div className="week-all-day">
      <span>All day</span>
      <div className="week-days week-all-day-lanes">
          {allDaySegments.map(({ event, startColumn, endColumn, lane }) => <a
            className="calendar-event calendar-event--all-day"
            key={`${event.calendarId}/${event.eventId}`}
            role={onEdit ? "button" : undefined}
            onClick={e => { if (onEdit) { e.preventDefault(); onEdit(event); } }}
            onKeyDown={e => { if (onEdit && e.key === ' ') { e.preventDefault(); onEdit(event); } }}
            href={link(event.googleEventUrl)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...calendarEventStyle(event.calendarId, event.calendarColor), gridColumn: `${startColumn + 1} / ${endColumn + 1}`, gridRow: lane + 1 }}
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
            {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
          </span>)}
        </div>
        <div className="week-days week-timed-days">
          {days.map((day) => <div key={day} className={`week-day-column${onCreate ? " week-day-column--editable" : ""}${day === today ? " week-day-column--today" : ""}`}
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
              style={{ ...calendarEventStyle(segment.event.calendarId, segment.event.calendarColor), top: segment.start, height: segment.end - segment.start, left: `${segment.column / segment.columns * 100}%`, width: `${100 / segment.columns}%` }}>
              <strong>
                {segment.event.title}
              </strong>
              <span>
                {time(segment.event.startAt).replace(":00", "")}
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
