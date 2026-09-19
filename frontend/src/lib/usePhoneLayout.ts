import { useCallback, useSyncExternalStore } from "react";

/**
 * The width at or below which the workspace lays itself out for a phone. It is
 * the breakpoint the shell and the Tasks board already use, so one query
 * describes "this is a phone" for layout that has to be decided in JavaScript
 * rather than in CSS — where the reading order, not just the painting order,
 * has to change.
 */
export const PHONE_LAYOUT_QUERY = "(max-width: 620px)";

function phoneMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(PHONE_LAYOUT_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const query = phoneMediaQuery();
  if (!query || typeof query.addEventListener !== "function") return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True while the viewport is phone-width. Environments without `matchMedia`
 * (the test renderer, a server render) report false, so the desktop layout
 * stays the default and never depends on a media query having been evaluated.
 */
export function usePhoneLayout(): boolean {
  const getSnapshot = useCallback(() => phoneMediaQuery()?.matches ?? false, []);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
