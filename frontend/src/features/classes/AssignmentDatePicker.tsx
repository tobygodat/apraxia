import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { addSqlDateDays, localToday } from "../todos/dateDomain";
import "./assignmentDatePicker.css";

const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const dateObject = (value: string) => new Date(`${value}T12:00:00Z`);
const monthStart = (value: string) => `${value.slice(0, 7)}-01`;
export function formatAssignmentDate(value: string) {
  return value ? dateObject(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";
}
function shiftMonth(value: string, offset: number) {
  const date = dateObject(monthStart(value));
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}

/** Date-only picker for the assignments. */
export function AssignmentDatePicker({ value, label, disabled, busy, buttonRef, onChange, onKeyDown, today = localToday(Intl.DateTimeFormat().resolvedOptions().timeZone) }: {
  value: string; label: string; disabled?: boolean; busy?: boolean; today?: string;
  buttonRef?(node: HTMLButtonElement | null): void;
  onChange(value: string): void;
  onKeyDown?(event: KeyboardEvent<HTMLButtonElement>): void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const dialogId = useId();
  useLayoutEffect(() => {
    if (!open && restoreFocus.current) { anchor.current?.focus(); restoreFocus.current = false; }
  }, [open]);
  function close() {
    // Keep focus within an enclosing draft row while the portal unmounts.
    anchor.current?.focus();
    restoreFocus.current = true;
    setOpen(false);
  }
  return <>
    <button type="button" ref={node => { anchor.current = node; buttonRef?.(node); }}
      className="assignment-cell assignment-date-trigger" aria-label={label} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? dialogId : undefined} disabled={disabled} aria-disabled={busy || disabled}
      onClick={() => { if (!busy) setOpen(previous => !previous); }} onKeyDown={event => {
        if (busy) return;
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
        else onKeyDown?.(event);
      }}>{formatAssignmentDate(value)}</button>
    {open && createPortal(<DateCalendar today={today} id={dialogId} value={value} anchor={anchor.current!}
      onClose={close} onChange={date => { onChange(date); close(); }} />, document.body)}
  </>;
}

function DateCalendar({ id, value, anchor, onChange, onClose, today }: {
  id: string; value: string; anchor: HTMLButtonElement; today: string;
  onChange(value: string): void; onClose(): void;
}) {
  const [month, setMonth] = useState(monthStart(value || today));
  const [focused, setFocused] = useState(value || today);
  const panel = useRef<HTMLDivElement>(null);
  const days = useRef(new Map<string, HTMLButtonElement>());
  const focusDay = useRef(true);
  const callbacks = useRef({ onClose });
  callbacks.current = { onClose };
  const first = addSqlDateDays(month, -dateObject(month).getUTCDay());
  const dates = Array.from({ length: 42 }, (_, index) => addSqlDateDays(first, index));

  useLayoutEffect(() => {
    const element = panel.current!;
    function place() {
      const rect = anchor.getBoundingClientRect();
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const below = rect.bottom + 6;
      const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - 6);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !element.contains(event.target) && !anchor.contains(event.target)) callbacks.current.onClose();
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [anchor]);
  useLayoutEffect(() => {
    if (focusDay.current) { days.current.get(focused)?.focus(); focusDay.current = false; }
  }, [focused, month]);

  function moveFocus(date: string) {
    focusDay.current = true;
    setFocused(date);
    setMonth(monthStart(date));
  }
  function moveMonth(offset: number) {
    const next = shiftMonth(month, offset);
    setMonth(next);
    setFocused(next);
  }
  function dayKey(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    let next: string | undefined;
    if (offset !== undefined) next = addSqlDateDays(date, offset);
    if (event.key === "Home") next = addSqlDateDays(date, -dateObject(date).getUTCDay());
    if (event.key === "End") next = addSqlDateDays(date, 6 - dateObject(date).getUTCDay());
    if (event.key === "PageUp" || event.key === "PageDown") next = shiftMonth(date, event.key === "PageUp" ? -1 : 1);
    if (next) { event.preventDefault(); moveFocus(next); }
  }
  return <div ref={panel} id={id} className="assignment-calendar" role="dialog" aria-label="Choose assignment date"
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const buttons = [...panel.current!.querySelectorAll<HTMLButtonElement>("button:not([tabindex='-1']):not(:disabled)")];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
    <div className="assignment-calendar-heading">
      <strong aria-live="polite">{dateObject(month).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}</strong>
      <button type="button" className="assignment-calendar-today" onClick={() => onChange(today)}>Today</button>
      <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}><WorkspaceIcon name="left" /></button>
      <button type="button" aria-label="Next month" onClick={() => moveMonth(1)}><WorkspaceIcon name="right" /></button>
    </div>
    <div className="assignment-calendar-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
    <div className="assignment-calendar-days" role="group" aria-label="Dates">
      {dates.map(date => <button type="button" key={date}
        ref={node => { if (node) days.current.set(date, node); else days.current.delete(date); }}
        tabIndex={date === focused ? 0 : -1} aria-label={dateObject(date).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
        aria-pressed={date === value} aria-current={date === today ? "date" : undefined}
        data-outside-month={monthStart(date) !== month || undefined}
        onFocus={() => setFocused(date)} onKeyDown={event => dayKey(event, date)} onClick={() => onChange(date)}>
        {dateObject(date).getUTCDate()}
      </button>)}
    </div>
    <div className="assignment-calendar-footer"><button type="button" disabled={!value} onClick={() => onChange("")}>Clear date</button></div>
  </div>;
}
