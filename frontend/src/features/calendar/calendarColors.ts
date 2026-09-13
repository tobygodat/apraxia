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

/** Preserve Google fills and choose the higher-contrast text color. */
export function calendarEventStyle(calendarId: string, color: CalendarColor): CSSProperties {
  const accent = calendarAccent(calendarId, color);
  const linear = [1, 3, 5].map(index => Number.parseInt(accent.slice(index, index + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
  return {
    "--calendar-event-color": accent,
    "--calendar-event-bg": accent,
    "--calendar-event-hover": accent,
    "--calendar-event-text": luminance > .179 ? "#000000" : "#ffffff",
  } as CSSProperties;
}
