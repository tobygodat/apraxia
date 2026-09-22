import { useCallback, useSyncExternalStore } from "react";

function mediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
}

/**
 * True while `query` matches, for layout that has to be decided in JavaScript
 * rather than in CSS — where the reading order, not just the painting order,
 * has to change. Environments without `matchMedia` (the test renderer, a server
 * render) report false, so the wide layout stays the default and never depends
 * on a media query having been evaluated.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaQueryList(query);
      if (!list || typeof list.addEventListener !== "function") return () => {};
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => mediaQueryList(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
