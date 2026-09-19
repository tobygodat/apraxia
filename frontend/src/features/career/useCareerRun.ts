import { useCallback, useEffect, useRef, useState } from "react";
import { serviceErrorMessage } from "../../lib/serviceError";

/**
 * One piece of work at a time, with the page's error line and the word for what
 * is happening. Navigating away aborts whatever is in flight, so a reply that
 * arrives after the page is gone never writes to it.
 */
export function useCareerRun(fallback: string) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [],
  );
  const run = useCallback(
    async (label: string, work: (signal: AbortSignal) => Promise<void>) => {
      if (pending.current) return;
      const controller = new AbortController();
      pending.current = controller;
      setBusy(label);
      setError("");
      try {
        await work(controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) setError(serviceErrorMessage(cause, fallback));
      } finally {
        if (pending.current === controller) {
          pending.current = null;
          setBusy("");
        }
      }
    },
    [fallback],
  );
  return { busy, error, setError, run };
}
