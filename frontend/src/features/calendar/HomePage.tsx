import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Temporal } from "@js-temporal/polyfill";
import { Link } from "react-router-dom";
import type {
  CalendarEvent,
  ClassSummary,
  Profile,
  ProjectSummary,
  WeekViewModel,
} from "../../types/domain";
import { usePhoneLayout } from "../../lib/usePhoneLayout";
import { TodayPanel } from "../todos/TodayPanel";
import type { TodoService } from "../todos/todoService";
import { addSqlDateDays, localToday, startOfWeekSunday } from "../todos/dateDomain";
import type { CalendarService } from "./calendarService";
import { peekRead } from "../../apps/navigationCache";
import { useColdLoad } from "../../apps/coldLoad";
import { hasServiceErrorCode, serviceErrorMessage } from "../../lib/serviceError";
import {
  layoutAllDayEvents,
  layoutTimedEvents,
  overflowClusters,
  wallMinute,
  weekDates,
} from "./eventLayout";
import { EventEditor } from "./EventEditor";
import { EventPreview } from "./EventPreview";
import type { CalendarSlot } from "./eventInput";
import { HomeHeader } from "./HomeHeader";
import type { HomeAppearanceService } from "./homeAppearance";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { calendarEventStyle } from "./calendarColors";
import { formatEventTimeRange } from "./eventDisplay";
import "./calendar.css";

const VISIBLE_HOURS = 15;
/** Below this the hour rows stop being readable, so the grid scrolls instead. */
const MIN_HOUR_HEIGHT = 32;
const DAY_START_MINUTE = 0;
const MAX_EVENT_LANES = 3;
const HOUR_LABEL_HIDE_MINUTES = 25;

// Fit VISIBLE_HOURS to the panel, but never squeeze the rows past legibility:
// a short panel shows fewer hours and scrolls within itself for the rest.
const timeScale = (panelHeight: number) =>
  Math.max(panelHeight / (VISIBLE_HOURS * 60), MIN_HOUR_HEIGHT / 60);

export interface HomePageProps {
  appearanceService?: HomeAppearanceService;
  todoService: TodoService;
  calendarService: CalendarService;
  profile: Profile;
  projects: readonly ProjectSummary[];
  classes?: readonly ClassSummary[];
  workspaceSessionKey: string;
}
export function HomePage({
  todoService,
  calendarService,
  profile,
  projects,
  classes = [],
  workspaceSessionKey,
  appearanceService,
}: HomePageProps) {
  // A callback ref (rather than useRef) so the element is available to
  // HomeHeader's layout effect on the very first commit: React flushes a
  // setState made from a ref callback synchronously before paint, whereas a
  // plain ref set during the parent's commit isn't visible to a child's
  // layout effect until a later pass.
  const [page, setPage] = useState<HTMLDivElement | null>(null);
  const phoneLayout = usePhoneLayout();
  const calendar = (
    <CalendarPanel key="calendar" service={calendarService} timezone={profile.timezone} />
  );
  const today = (
    <TodayPanel
      key="today"
      heading="Tasks"
      allowTomorrow
      service={todoService}
      profile={profile}
      projects={projects}
      classes={classes}
      workspaceSessionKey={workspaceSessionKey}
    />
  );
  // Side by side the calendar is the left column and reads first. Stacked on a
  // phone it would push what is due today two screens down, so the order swaps
  // in the markup rather than in CSS: the reading and tab order swap with it.
  return (
    <div className="home-page" ref={setPage}>
      <HomeHeader service={appearanceService} userId={profile.userId} pageElement={page} />
      <div className={`home-workspace${phoneLayout ? " home-workspace--phone" : ""}`}>
        {phoneLayout ? [today, calendar] : [calendar, today]}
      </div>
    </div>
  );
}
export function CalendarPanel({
  service,
  timezone,
}: {
  service: CalendarService;
  timezone: string;
}) {
  const [now, setNow] = useState(() => new Date());
  const today = localToday(timezone, now);
  const [sunday, setSunday] = useState<string>(() => startOfWeekSunday(today));
  const [revision, setRevision] = useState(0);
  const [scrollRevision, setScrollRevision] = useState(0);
  const [editor, setEditor] = useState<{ slot: CalendarSlot; event?: CalendarEvent } | null>(null);
  const [notice, setNotice] = useState("");
  const editable = !!service.mutateEvent && !!service.eventDetail;
  const [state, setState] = useState<{
    loading: boolean;
    week: WeekViewModel | null;
    error: string | null;
    connect: boolean;
  }>(() => {
    const status = peekRead(service, "status");
    if (status && status.connectionState === "connected") {
      const week = peekRead(service, "week", sunday);
      if (week && week.timezone === timezone)
        return { loading: false, week, error: null, connect: false };
      return { loading: true, week: null, error: null, connect: false };
    }
    if (status) return { loading: false, week: null, error: null, connect: true };
    return { loading: true, week: null, error: null, connect: false };
  });
  // Remembers whether the effect below has already run once for this sunday/timezone,
  // so a seeded (cache-warm) first run does not flash a loading state.
  const firstRunKey = useRef("");
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const key = `${sunday}/${timezone}`;
    const isFirstRun = firstRunKey.current !== key;
    firstRunKey.current = key;
    setState((previous) => {
      const seededWeek =
        previous.week?.range.sunday === sunday && previous.week.timezone === timezone
          ? previous.week
          : null;
      // On the first run for this sunday/timezone, a seeded week is already visible:
      // refetch quietly instead of showing the loading/refreshing placeholder.
      if (isFirstRun && seededWeek) return previous;
      return { loading: true, week: seededWeek, error: null, connect: false };
    });
    void service
      .status(controller.signal)
      .then(async (status) => {
        if (!status || status.connectionState !== "connected") {
          if (!controller.signal.aborted)
            setState({ loading: false, week: null, error: null, connect: true });
          return;
        }
        const week = await service.week(sunday, controller.signal);
        if (!controller.signal.aborted)
          setState({ loading: false, week, error: null, connect: false });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            loading: false,
            week: hasServiceErrorCode(error, "reconnect_required", "unauthorized")
              ? null
              : previous.week,
            error: serviceErrorMessage(error, "Calendar is unavailable."),
            connect: hasServiceErrorCode(error, "reconnect_required"),
          }));
      });
    return () => controller.abort();
  }, [service, sunday, revision, timezone]);
  // Do not flash a previous week's events while the new request effect starts.
  const visibleWeek =
    state.week?.range.sunday === sunday && state.week.timezone === timezone ? state.week : null;
  useColdLoad(state.loading && !visibleWeek && !state.error && !state.connect);
  const dates = weekDates(sunday);
  const label = Temporal.PlainDate.from(dates.includes(today) ? today : dates[3]).toLocaleString(
    "en",
    { month: "long", year: "numeric" },
  );
  return (
    <section className="calendar-panel" aria-label="Weekly calendar">
      <header className="calendar-header calendar-toolbar">
        <div className="calendar-toolbar-month">
          <button
            className="calendar-icon-button"
            aria-label="Previous week"
            title="Previous week"
            onClick={() => setSunday(addSqlDateDays(sunday, -7))}
          >
            <WorkspaceIcon name="left" />
          </button>
          <h2 className="calendar-toolbar-title">
            <span>{label.slice(0, label.lastIndexOf(" "))}</span>{" "}
            <span className="calendar-toolbar-year">{label.slice(label.lastIndexOf(" ") + 1)}</span>
          </h2>
          <button
            className="calendar-icon-button"
            aria-label="Next week"
            title="Next week"
            onClick={() => setSunday(addSqlDateDays(sunday, 7))}
          >
            <WorkspaceIcon name="right" />
          </button>
        </div>
        <div className="calendar-toolbar-actions">
          <button
            onClick={() => {
              setSunday(startOfWeekSunday(today));
              setNow(new Date());
              setScrollRevision((value) => value + 1);
            }}
          >
            Today
          </button>
          <button
            className="calendar-icon-button"
            aria-label="Refresh"
            title="Refresh calendar"
            onClick={() => {
              service.invalidate?.();
              setRevision((value) => value + 1);
            }}
            disabled={state.loading}
          >
            <WorkspaceIcon name="refresh" />
          </button>
          {editable && (
            <button
              className="calendar-add"
              disabled={!visibleWeek || state.loading}
              onClick={() =>
                setEditor({
                  slot: {
                    day: dates.includes(today) ? today : sunday,
                    startMinute: 540,
                    endMinute: 600,
                  },
                })
              }
            >
              <WorkspaceIcon name="plus" />
              Add event
            </button>
          )}
        </div>
      </header>

      {notice && (
        <p className="calendar-warning" role="status">
          {notice}
        </p>
      )}
      {editor && (
        <EventEditor
          service={service}
          timezone={timezone}
          {...editor}
          onClose={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null);
            setNotice(message);
            service.invalidate?.();
            setRevision((value) => value + 1);
          }}
        />
      )}
      {state.loading && !visibleWeek && (
        <p className="cloud-shell__sr-only" role="status">
          Loading your week…
        </p>
      )}

      {state.connect && (
        <div className="calendar-message">
          <h3>Connect your calendar</h3>
          <p>{state.error ?? "Connect Google Calendar to see your events here."}</p>
          <Link to="/settings">Connect Calendar</Link>
        </div>
      )}

      {state.error && !state.connect && (
        <div className="workspace-error" role="alert">
          <p>
            {state.error}
            {visibleWeek ? " Showing your last loaded events." : ""}
          </p>
          <button onClick={() => setRevision((value) => value + 1)}>Try again</button>
        </div>
      )}

      {visibleWeek && (
        <>
          {!!visibleWeek.partialErrors.length && (
            <div className="calendar-warning" role="status">
              {visibleWeek.partialErrors.map((error) => (
                <p key={error.calendarId}>{`${error.calendarDisplayName}: ${error.userMessage}`}</p>
              ))}
            </div>
          )}
          {visibleWeek.events.length === 0 && (
            <p className="calendar-empty">
              {visibleWeek.visibleCalendars.length ? (
                "No events this week."
              ) : (
                <>
                  No calendars are visible. <Link to="/settings">Choose calendars</Link>
                </>
              )}
            </p>
          )}
          <WeekGrid
            key={sunday}
            week={visibleWeek}
            now={now}
            scrollRevision={scrollRevision}
            service={service}
            onCreate={editable ? (slot) => setEditor({ slot }) : undefined}
            onEdit={
              editable
                ? (event) =>
                    setEditor({ event, slot: { day: sunday, startMinute: 540, endMinute: 600 } })
                : undefined
            }
          />
        </>
      )}
      <footer className="calendar-footer">
        <WorkspaceIcon name="clock" />
        <span>{timezone.replace(/_/g, " ")}</span>
      </footer>
    </section>
  );
}
export function WeekGrid({
  week,
  now,
  scrollRevision = 0,
  service,
  onCreate,
  onEdit,
}: {
  week: WeekViewModel;
  now: Date;
  scrollRevision?: number;
  service?: CalendarService;
  onCreate?: (slot: CalendarSlot) => void;
  onEdit?: (event: CalendarEvent) => void;
}) {
  const [preview, setPreview] = useState<{ event: CalendarEvent; anchor: HTMLElement } | null>(
    null,
  );
  const closePreview = useCallback(() => setPreview(null), []);
  const [selection, setSelection] = useState<{
    day: string;
    anchor: number;
    minute: number;
  } | null>(null);
  const drag = useRef<{ day: string; anchor: number; minute: number } | null>(null);
  const [pixelsPerMinute, setPixelsPerMinute] = useState(0.5);
  const minuteAt = (element: HTMLElement, y: number) =>
    Math.max(
      DAY_START_MINUTE,
      Math.min(
        1425,
        DAY_START_MINUTE +
          Math.floor((y - element.getBoundingClientRect().top) / pixelsPerMinute / 15) * 15,
      ),
    );
  const clearSelection = () => {
    drag.current = null;
    setSelection(null);
  };
  const scroll = useRef<HTMLDivElement>(null);
  const lastScrollAnchor = useRef("");
  const lastTimeScale = useRef(pixelsPerMinute);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const measure = () => {
      if (element.clientHeight > 0) {
        setPixelsPerMinute(timeScale(element.clientHeight));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const days = weekDates(week.range.sunday);
  const segments = layoutTimedEvents(week.events, week.range.sunday, week.timezone);
  const allDaySegments = layoutAllDayEvents(week.events, week.range.sunday);
  const clusters = overflowClusters(segments, MAX_EVENT_LANES);
  const today = localToday(week.timezone, now);
  const currentMinute = wallMinute(Temporal.Instant.from(now.toISOString()), week.timezone);
  const showsNow = days.includes(today);
  const describe = (event: CalendarEvent & { kind: "timed" }) =>
    `${event.title}, ${time(event.startAt)}–${time(event.endAt)}${event.location ? `, ${event.location}` : ""}`;
  // Nearby starts use side-by-side lanes. Later starts can share a lane,
  // leaving a small inset so the earlier card remains visible underneath.
  const laneStyle = (column: number, lanes: number, stackDepth = 0) => {
    const inset = (Math.min(stackDepth, 4) * 0.05) / lanes;
    return {
      left: `calc(${(column / lanes + inset) * 100}% + 1px)`,
      width: `calc(${(Math.min(1.7 / lanes, 1 - column / lanes) - inset) * 100}% - 3px)`,
      "--calendar-event-layer": column + 1,
    };
  };
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    // Wait for the measured scale before choosing the initial scroll position.
    if (element.clientHeight > 0 && pixelsPerMinute !== timeScale(element.clientHeight)) return;
    const anchor = `${week.range.sunday}/${week.timezone}/${scrollRevision}`;
    const sameAnchor = lastScrollAnchor.current === anchor;
    if (sameAnchor && lastTimeScale.current === pixelsPerMinute) return;
    const minute = sameAnchor
      ? element.scrollTop / lastTimeScale.current
      : Math.max(0, currentMinute - 8 / pixelsPerMinute);
    lastScrollAnchor.current = anchor;
    lastTimeScale.current = pixelsPerMinute;
    const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = Math.min(minute * pixelsPerMinute, maximum);
  }, [week.range.sunday, week.timezone, scrollRevision, currentMinute, pixelsPerMinute]);

  const time = (at: string) =>
    new Intl.DateTimeFormat("en", {
      timeZone: week.timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(at));
  return (
    <div
      className="week-grid"
      style={{ "--calendar-hour-height": `${60 * pixelsPerMinute}px` } as CSSProperties}
    >
      {preview && (
        <EventPreview
          key={`${preview.event.calendarId}/${preview.event.eventId}`}
          {...preview}
          timezone={week.timezone}
          service={service}
          calendarName={
            week.visibleCalendars.find(
              (calendar) => calendar.calendarId === preview.event.calendarId,
            )?.displayName
          }
          onClose={closePreview}
          onEdit={
            onEdit
              ? (event) => {
                  closePreview();
                  onEdit(event);
                }
              : undefined
          }
        />
      )}

      <div className="week-head">
        <span />
        <div className="week-days">
          {days.map((day) => (
            <div
              key={day}
              className={day === today ? "is-today" : ""}
              aria-current={day === today ? "date" : undefined}
            >
              <span>{Temporal.PlainDate.from(day).toLocaleString("en", { weekday: "short" })}</span>
              <strong>{Temporal.PlainDate.from(day).day}</strong>
            </div>
          ))}
        </div>
      </div>

      {allDaySegments.length > 0 && (
        <div className="week-all-day">
          <span>All day</span>
          <div className="week-days week-all-day-lanes">
            {allDaySegments.map(({ event, startColumn, endColumn, lane }) => (
              <button
                type="button"
                className="calendar-event calendar-event--all-day"
                key={`${event.calendarId}/${event.eventId}`}
                onClick={(e) => setPreview({ event, anchor: e.currentTarget })}
                aria-haspopup="dialog"
                style={{
                  ...calendarEventStyle(event.calendarId, event.calendarColor),
                  gridColumn: `${startColumn + 1} / ${endColumn + 1}`,
                  gridRow: lane + 1,
                }}
                aria-label={`${event.title}, all day, ${event.startDate} through ${addSqlDateDays(event.endDateExclusive, -1)}`}
                title={event.title}
              >
                {event.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className="week-scroll"
        ref={scroll}
        tabIndex={0}
        aria-label="Calendar grid from midnight to midnight"
      >
        <div className="week-hours">
          <div className="week-time-labels">
            {Array.from({ length: 24 }, (_, hour) => hour).map((hour) => (
              <span
                key={hour}
                className={
                  showsNow && Math.abs(hour * 60 - currentMinute) < HOUR_LABEL_HIDE_MINUTES
                    ? "week-time-label--near-now"
                    : undefined
                }
                style={{ top: (hour * 60 - DAY_START_MINUTE) * pixelsPerMinute }}
              >
                {hour === 0
                  ? "12 AM"
                  : hour < 12
                    ? `${hour} AM`
                    : hour === 12
                      ? "12 PM"
                      : `${hour - 12} PM`}
              </span>
            ))}
            {showsNow && (
              <span
                className="week-current-time"
                style={{
                  top: Math.max(
                    8,
                    Math.min(24 * 60 * pixelsPerMinute - 8, currentMinute * pixelsPerMinute),
                  ),
                }}
                aria-hidden="true"
              >
                {time(now.toISOString()).replace(" ", "")}
              </span>
            )}
          </div>
          <div className="week-days week-timed-days">
            {days.map((day) => (
              <div
                key={day}
                className={`week-day-column${onCreate ? " week-day-column--editable" : ""}${day === today ? " week-day-column--today" : ""}`}
                onPointerDown={(e) => {
                  if (!onCreate || e.button !== 0 || (e.target as HTMLElement).closest("a,button"))
                    return;
                  e.preventDefault();
                  e.currentTarget.focus();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const minute = minuteAt(e.currentTarget, e.clientY);
                  drag.current = { day, anchor: minute, minute };
                  setSelection(drag.current);
                }}
                onPointerMove={(e) => {
                  if (!drag.current || drag.current.day !== day) return;
                  const viewport = scroll.current?.getBoundingClientRect();
                  if (viewport && scroll.current) {
                    if (e.clientY > viewport.bottom - 30) scroll.current.scrollTop += 20;
                    else if (e.clientY < viewport.top + 30) scroll.current.scrollTop -= 20;
                  }
                  drag.current = { ...drag.current, minute: minuteAt(e.currentTarget, e.clientY) };
                  setSelection(drag.current);
                }}
                onPointerUp={(e) => {
                  const current = drag.current;
                  if (!current) return;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  clearSelection();
                  onCreate?.({
                    day,
                    startMinute: Math.min(current.anchor, current.minute),
                    endMinute: Math.max(current.anchor, current.minute) + 15,
                  });
                }}
                onPointerCancel={clearSelection}
                onLostPointerCapture={clearSelection}
                tabIndex={onCreate ? 0 : undefined}
                aria-label={
                  onCreate ? `Add event on ${day}; press Enter for event details` : undefined
                }
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Escape") clearSelection();
                  if (onCreate && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onCreate({ day, startMinute: 540, endMinute: 600 });
                  }
                }}
              >
                {selection?.day === day && (
                  <div
                    className="calendar-selection"
                    style={{
                      top:
                        (Math.min(selection.anchor, selection.minute) - DAY_START_MINUTE) *
                        pixelsPerMinute,
                      height:
                        (Math.abs(selection.anchor - selection.minute) + 15) * pixelsPerMinute,
                    }}
                  >
                    New event
                  </div>
                )}
                {segments
                  .filter(
                    (segment) =>
                      segment.day === day &&
                      segment.end > DAY_START_MINUTE &&
                      (segment.columns <= MAX_EVENT_LANES || segment.column < MAX_EVENT_LANES),
                  )
                  .map((segment) => {
                    const start = Math.max(segment.start, DAY_START_MINUTE);
                    const lanes =
                      segment.columns > MAX_EVENT_LANES ? MAX_EVENT_LANES + 1 : segment.columns;
                    const height = Math.max(2, (segment.end - start) * pixelsPerMinute - 2);
                    const rows = height >= 33 ? 3 : height >= 23 ? 2 : 1;
                    const eventTime = formatEventTimeRange(
                      segment.event.startAt,
                      segment.event.endAt,
                      week.timezone,
                    );
                    const startTime = time(segment.event.startAt)
                      .replace(":00", "")
                      .replace(" ", "")
                      .toLowerCase();
                    const location = segment.event.location;
                    return (
                      <button
                        type="button"
                        key={`${segment.event.calendarId}/${segment.event.eventId}`}
                        className={`calendar-event calendar-event--timed calendar-event--rows-${rows}`}
                        onClick={(e) =>
                          setPreview({ event: segment.event, anchor: e.currentTarget })
                        }
                        aria-haspopup="dialog"
                        aria-label={describe(segment.event)}
                        title={describe(segment.event)}
                        style={
                          {
                            ...calendarEventStyle(
                              segment.event.calendarId,
                              segment.event.calendarColor,
                            ),
                            top: (start - DAY_START_MINUTE) * pixelsPerMinute,
                            height,
                            ...laneStyle(segment.column, lanes, segment.stackDepth),
                          } as CSSProperties
                        }
                      >
                        {rows === 1 ? (
                          <span className="calendar-event__inline">
                            <strong>{segment.event.title}</strong>
                            <span className="calendar-event__inline-rest">
                              , {startTime}
                              {location ? `, ${location}` : ""}
                            </span>
                          </span>
                        ) : (
                          <>
                            <strong>{segment.event.title}</strong>
                            <span className="calendar-event__time">
                              {rows === 2 && location ? `${startTime}, ${location}` : eventTime}
                            </span>
                            {rows === 3 && location && (
                              <span className="calendar-event__location">{location}</span>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                {clusters
                  .filter((cluster) => cluster.day === day)
                  .map((cluster) => {
                    const list = cluster.segments
                      .map((segment) => describe(segment.event))
                      .join("; ");
                    return (
                      <div
                        key={`more/${cluster.start}`}
                        className="calendar-event calendar-event--timed calendar-event--more"
                        tabIndex={0}
                        title={list}
                        aria-label={`${cluster.segments.length} more ${cluster.segments.length === 1 ? "event" : "events"}: ${list}`}
                        style={
                          {
                            top:
                              (Math.max(cluster.start, DAY_START_MINUTE) - DAY_START_MINUTE) *
                              pixelsPerMinute,
                            height: Math.max(
                              2,
                              (cluster.end - Math.max(cluster.start, DAY_START_MINUTE)) *
                                pixelsPerMinute -
                                2,
                            ),
                            ...laneStyle(MAX_EVENT_LANES, MAX_EVENT_LANES + 1),
                          } as CSSProperties
                        }
                      >
                        +{cluster.segments.length}
                      </div>
                    );
                  })}
                {day === today && currentMinute >= DAY_START_MINUTE && (
                  <div
                    className="week-now"
                    style={{
                      top: Math.min(
                        24 * 60 * pixelsPerMinute - 4,
                        (currentMinute - DAY_START_MINUTE) * pixelsPerMinute,
                      ),
                    }}
                    aria-label={`Current time: ${time(now.toISOString())}`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
