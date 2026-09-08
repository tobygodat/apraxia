import type { CSSProperties } from "react";
import type { CalendarColor } from "../../types/domain";

const FALLBACK_COLORS = ["#8ab4f8", "#e6b566", "#ca9ce1", "#78bdb4", "#e69b91", "#b5b9df"];

/** Keep a calendar's Google color; use a stable fallback when it has no usable color. */
export function calendarAccent(calendarId: string, color: CalendarColor): string {
  const supplied = color.background?.trim();
  if (supplied && /^#[\da-f]{6}$/i.test(supplied)) return supplied.toLowerCase();
  if (supplied && /^#[\da-f]{3}$/i.test(supplied)) return `#${supplied.slice(1).split("").map(value => value + value).join("")}`.toLowerCase();
  let hash = 0;
  for (const character of calendarId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

function tint(color: string, amount: number): string {
  return `#${[1, 3, 5].map(index => Math.round(25 + (Number.parseInt(color.slice(index, index + 2), 16) - 25) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/** Dark tints preserve legibility even for white, yellow, or black source colors. */
export function calendarEventStyle(calendarId: string, color: CalendarColor): CSSProperties {
  const accent = calendarAccent(calendarId, color);
  return {
    "--calendar-event-color": accent,
    "--calendar-event-bg": tint(accent, .22),
    "--calendar-event-hover": tint(accent, .32),
  } as CSSProperties;
}
