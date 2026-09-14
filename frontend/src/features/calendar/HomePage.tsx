import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { Link } from "react-router-dom";
import type { CalendarEvent, Profile, ClassSummary, ProjectSummary, WeekViewModel } from "../../types/domain";
import { TodayPanel } from "../todos/TodayPanel";
import type { TodoService } from "../todos/todoService";
import { addSqlDateDays, localToday } from "../todos/dateDomain";
import { CalendarServiceError, type CalendarService } from "./calendarService";
import { layoutAllDayEvents, layoutTimedEvents, wallMinute, weekDates, startOfWeekSunday } from "./eventLayout";
import { EventEditor } from "./EventEditor";
import { EventPreview } from "./EventPreview";
import type { CalendarSlot } from "./eventInput";
import { HomeHeader } from "./HomeHeader";
import type { HomeAppearanceService } from "./homeAppearance";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { calendarEventStyle } from "./calendarColors";
import { formatEventTimeRange } from "./eventDisplay";
import "./calendar.css";

const PIXELS_PER_MINUTE = 0.5;
const DAY_START_MINUTE = 0;

export interface HomePageProps {
  appearanceService?: HomeAppearanceService;
  todoService: TodoService;
  calendarService: CalendarService;
  profile: Profile;
  projects: readonly ProjectSummary[];
  classes?: readonly ClassSummary[];
  workspaceSessionKey: string;
  refreshKey?: string | number;
}
export function HomePage({ todoService, calendarService, profile, projects, classes = [], workspaceSessionKey, refreshKey, appearanceService }: HomePageProps) {
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
        projects={projects} classes={classes}
        workspaceSessionKey={workspaceSessionKey}
        refreshKey={refreshKey} />
    </div>
  </div>;
}
export function CalendarPanel({ service, timezone }: { service: CalendarService; timezone: string }) {
  const [now, setNow] = useState(() => new Date());
  const today = localToday(timezone, now);
  const [sunday, setSunday] = useState(() => startOfWeekSunday(today));
  const [revision, setRevision] = useState(0);
  const [scrollRevision, setScrollRevision] = useState(0);
  const [editor, setEditor] = useState<{ slot: CalendarSlot; event?: CalendarEvent } | null>(null);
  const [notice, setNotice] = useState('');
  const editable = !!service.mutateEvent && !!service.eventDetail;
  const [state, setState] = useState<{ loading: boolean; week: WeekViewModel | null; error: string | null; connect: boolean }>({ loading: true, week: null, error: null, connect: false });
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ loading: true, week: previous.week?.range.sunday === sunday && previous.week.timezone === timezone ? previous.week : null, error: null, connect: false }));
    void service.status(controller.signal).then(async (status) => {
      if (!status || status.connectionState !== "connected") {
        if (!controller.signal.aborted) setState({ loading: false, week: null, error: null, connect: true });
        return;
      }
      const week = await service.week(sunday, controller.signal);
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
  }, [service, sunday, revision, timezone]);
  // Do not flash a previous week's events while the new request effect starts.
  const visibleWeek = state.week?.range.sunday === sunday && state.week.timezone === timezone ? state.week : null;
  const dates = weekDates(sunday);
  const label = Temporal.PlainDate.from(dates.includes(today) ? today : dates[3]).toLocaleString("en", { month: "long", year: "numeric" });
  return <section className="calendar-panel" aria-label="Weekly calendar">

    <header className="calendar-header calendar-toolbar">
      <div className="calendar-toolbar-month">
        <button className="calendar-icon-button" aria-label="Previous week" title="Previous week" onClick={() => setSunday(addSqlDateDays(sunday, -7))}><WorkspaceIcon name="left" /></button>
        <h2 className="calendar-toolbar-title"><span>{label.slice(0, label.lastIndexOf(" "))}</span>{" "}<span className="calendar-toolbar-year">{label.slice(label.lastIndexOf(" ") + 1)}</span></h2>
        <button className="calendar-icon-button" aria-label="Next week" title="Next week" onClick={() => setSunday(addSqlDateDays(sunday, 7))}><WorkspaceIcon name="right" /></button></div>
      <div className="calendar-toolbar-actions">
        <button onClick={() => { setSunday(startOfWeekSunday(today)); setNow(new Date()); setScrollRevision(value => value + 1); }}>Today</button>
        <button className="calendar-icon-button" aria-label="Refresh" title="Refresh calendar" onClick={() => { service.invalidate?.(); setRevision((value) => value + 1); }} disabled={state.loading}><WorkspaceIcon name="refresh" /></button>{editable && <button className="calendar-add" disabled={!visibleWeek || state.loading} onClick={() => setEditor({ slot: { day: dates.includes(today) ? today : sunday, startMinute: 540, endMinute: 600 } })}><WorkspaceIcon name="plus" />Add event</button>}</div>
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
      {!!visibleWeek.partialErrors.length && <div className="calendar-warning" role="status">
        {visibleWeek.partialErrors.map((error) => <p key={error.calendarId}>
          {`${error.calendarDisplayName}: ${error.userMessage}`}
        </p>)}
      </div>}
      {visibleWeek.events.length === 0 && <p className="calendar-empty">
        {visibleWeek.visibleCalendars.length ? "No events this week." : <>No calendars are visible. <Link to="/settings">Choose calendars</Link></>}
      </p>}
      <WeekGrid key={sunday} week={visibleWeek} now={now} scrollRevision={scrollRevision} service={service} onCreate={editable ? slot => setEditor({ slot }) : undefined} onEdit={editable ? event => setEditor({ event, slot: { day: sunday, startMinute: 540, endMinute: 600 } }) : undefined} />
    </>}
    <footer className="calendar-footer"><WorkspaceIcon name="clock" /><span>{timezone.replace(/_/g, " ")}</span></footer>
  </section>;
}
export function WeekGrid({ week, now, scrollRevision = 0, service, onCreate, onEdit }: { week: WeekViewModel; now: Date; scrollRevision?: number; service?: CalendarService; onCreate?: (slot: CalendarSlot) => void; onEdit?: (event: CalendarEvent) => void }) {
  const [preview, setPreview] = useState<{ event: CalendarEvent; anchor: HTMLElement } | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);
  const [selection, setSelection] = useState<{ day: string; anchor: number; minute: number } | null>(null);
  const drag = useRef<{ day: string; anchor: number; minute: number } | null>(null);
  const minuteAt = (element: HTMLElement, y: number) => Math.max(DAY_START_MINUTE, Math.min(1425, DAY_START_MINUTE + Math.floor((y - element.getBoundingClientRect().top) / PIXELS_PER_MINUTE / 15) * 15));
  const clearSelection = () => { drag.current = null; setSelection(null); };
  const scroll = useRef<HTMLDivElement>(null);
  const lastScrollAnchor = useRef("");
  const days = weekDates(week.range.sunday);
  const segments = layoutTimedEvents(week.events, week.range.sunday, week.timezone);
  const allDaySegments = layoutAllDayEvents(week.events, week.range.sunday);
  const today = localToday(week.timezone, now);
  const currentMinute = wallMinute(Temporal.Instant.from(now.toISOString()), week.timezone);
  useLayoutEffect(() => {
    const anchor = `${week.range.sunday}/${week.timezone}/${scrollRevision}`;
    if (!scroll.current || lastScrollAnchor.current === anchor) return;
    lastScrollAnchor.current = anchor;
    const maximum = Math.max(0, scroll.current.scrollHeight - scroll.current.clientHeight);
    scroll.current.scrollTop = Math.min(Math.max(0, currentMinute * PIXELS_PER_MINUTE - 8), maximum);
  }, [week.range.sunday, week.timezone, scrollRevision, currentMinute]);
  const time = (at: string) => new Intl.DateTimeFormat("en", { timeZone: week.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
  return <div className="week-grid" style={{ "--calendar-hour-height": `${60 * PIXELS_PER_MINUTE}px` } as CSSProperties}>
    {preview && <EventPreview key={`${preview.event.calendarId}/${preview.event.eventId}`} {...preview} timezone={week.timezone} service={service}
      calendarName={week.visibleCalendars.find(calendar => calendar.calendarId === preview.event.calendarId)?.displayName}
      onClose={closePreview} onEdit={onEdit ? event => { closePreview(); onEdit(event); } : undefined} />}

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
          {allDaySegments.map(({ event, startColumn, endColumn, lane }) => <button type="button"
            className="calendar-event calendar-event--all-day"
            key={`${event.calendarId}/${event.eventId}`}
            onClick={e => setPreview({ event, anchor: e.currentTarget })}
            aria-haspopup="dialog"
            style={{ ...calendarEventStyle(event.calendarId, event.calendarColor), gridColumn: `${startColumn + 1} / ${endColumn + 1}`, gridRow: lane + 1 }}
            aria-label={`${event.title}, all day, ${event.startDate} through ${addSqlDateDays(event.endDateExclusive, -1)}`}
            title={event.title}>
            {event.title}
          </button>)}
      </div>
    </div>}

    <div
      className="week-scroll"
      ref={scroll}
      tabIndex={0}
      aria-label="Calendar grid from midnight to midnight">
      <div className="week-hours">
        <div className="week-time-labels">
          {Array.from({ length: 24 }, (_, hour) => hour).map(hour => <span key={hour} style={{ top: (hour * 60 - DAY_START_MINUTE) * PIXELS_PER_MINUTE }}>
            {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
          </span>)}
          {days.includes(today) && <span className="week-current-time" style={{ top: Math.max(8, Math.min(24 * 60 * PIXELS_PER_MINUTE - 8, currentMinute * PIXELS_PER_MINUTE)) }} aria-hidden="true">{time(now.toISOString()).replace(" ", "")}</span>}
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
            {selection?.day === day && <div className="calendar-selection" style={{ top: (Math.min(selection.anchor, selection.minute) - DAY_START_MINUTE) * PIXELS_PER_MINUTE, height: (Math.abs(selection.anchor - selection.minute) + 15) * PIXELS_PER_MINUTE }}>New event</div>}
            {segments.filter((segment) => segment.day === day && segment.end > DAY_START_MINUTE).map((segment) => {
              const start = Math.max(segment.start, DAY_START_MINUTE);
              const height = Math.max(2, (segment.end - start) * PIXELS_PER_MINUTE - 2);
              const rows = height >= 33 ? 3 : height >= 23 ? 2 : 1;
              const eventTime = formatEventTimeRange(segment.event.startAt, segment.event.endAt, week.timezone);
              const startTime = time(segment.event.startAt).replace(":00", "").replace(" ", "").toLowerCase();
              const location = segment.event.location;
              return <button type="button"
              key={`${segment.event.calendarId}/${segment.event.eventId}`}
              className={`calendar-event calendar-event--timed calendar-event--rows-${rows}`}
              onClick={e => setPreview({ event: segment.event, anchor: e.currentTarget })}
              aria-haspopup="dialog"
              aria-label={`${segment.event.title}, ${time(segment.event.startAt)}–${time(segment.event.endAt)}${segment.event.location ? `, ${segment.event.location}` : ""}`}
              title={`${segment.event.title}, ${time(segment.event.startAt)}–${time(segment.event.endAt)}${segment.event.location ? `, ${segment.event.location}` : ""}`}
              style={{ ...calendarEventStyle(segment.event.calendarId, segment.event.calendarColor),
                top: (start - DAY_START_MINUTE) * PIXELS_PER_MINUTE, height,
                left: `calc(${segment.column / segment.columns * 100}% + 1px)`, width: `calc(${100 / segment.columns}% - 3px)`,
              } as CSSProperties}>
              {rows === 1 ? <span className="calendar-event__inline"><strong>{segment.event.title}</strong>, {startTime}{location ? `, ${location}` : ""}</span> : <>
                <strong>{segment.event.title}</strong>
                <span className="calendar-event__time">{rows === 2 && location ? `${startTime}, ${location}` : eventTime}</span>
                {rows === 3 && location && <span className="calendar-event__location">{location}</span>}
              </>}
            </button>; })}
            {day === today && currentMinute >= DAY_START_MINUTE && <div
              className="week-now"
              style={{ top: Math.min(24 * 60 * PIXELS_PER_MINUTE - 4, (currentMinute - DAY_START_MINUTE) * PIXELS_PER_MINUTE) }}
              aria-label={`Current time: ${time(now.toISOString())}`} />}
          </div>)}
        </div>
      </div>
    </div>

  </div>;
}
