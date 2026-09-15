import { useCallback, useSyncExternalStore } from "react";
import { localToday, type SqlDate } from "./dateDomain";

const LOCAL_DATE_REFRESH_MS = 60_000;

function subscribeToLocalDateClock(onStoreChange: () => void): () => void {
  const intervalId = window.setInterval(onStoreChange, LOCAL_DATE_REFRESH_MS);
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") onStoreChange();
  };

  window.addEventListener("focus", onStoreChange);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    window.clearInterval(intervalId);
    window.removeEventListener("focus", onStoreChange);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

/**
 * The current date in the loaded profile's timezone, never a converted due date.
 * While browser timers run, a local-midnight change is observed within 60 seconds.
 * Focus/visibility refreshes cover throttled or sleeping tabs. Each sample derives
 * the date from the real instant, so 23-hour and 25-hour DST days need no special
 * arithmetic. The primitive snapshot changes synchronously with the timezone prop
 * and is not shared between mounted workspaces.
 */
export function useLocalToday(timeZone: string): SqlDate {
  const getSnapshot = useCallback(() => localToday(timeZone), [timeZone]);

  return useSyncExternalStore(subscribeToLocalDateClock, getSnapshot, getSnapshot);
}
