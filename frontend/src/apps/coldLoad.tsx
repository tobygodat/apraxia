import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Shared "cold load" primitive: a gate that hides its children (via opacity
 * and `visibility`, keeping layout intact) until every registered pending
 * part has finished, then reveals them in one commit with a short fade. Once
 * revealed, the gate stays revealed for its lifetime so background refreshes
 * never hide content that already rendered.
 */
interface ColdLoadContextValue {
  register(): () => void;
}

const ColdLoadContext = createContext<ColdLoadContextValue | null>(null);

/** Module-level store so the shell's progress bar can read gate state without React context. */
interface ColdLoadBarState {
  pending: boolean;
}

const NOT_PENDING: ColdLoadBarState = { pending: false };

/**
 * Ref-counted across every mounted `ColdLoadGate`: each gate reports its own
 * "still loading" flag (its pending count is above zero, or it has a reveal
 * check scheduled for the next frame) under its own id. The store is
 * pending as long as any gate reports true, so one gate revealing its
 * content doesn't hide the bar while another mounted gate (an outer shell
 * gate, or a newer navigation's gate) is still loading. A gate clears its
 * own id when it unmounts.
 */
class ColdLoadBarStore {
  private loadingGateIds = new Set<string>();
  private state: ColdLoadBarState = NOT_PENDING;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ColdLoadBarState => this.state;

  setGateLoading(gateId: string, isLoading: boolean): void {
    const wasLoading = this.loadingGateIds.has(gateId);
    if (isLoading === wasLoading) return;
    if (isLoading) this.loadingGateIds.add(gateId);
    else this.loadingGateIds.delete(gateId);
    const pending = this.loadingGateIds.size > 0;
    if (pending === this.state.pending) return;
    this.state = { pending };
    for (const listener of this.listeners) listener();
  }
}

const coldLoadBarStore = new ColdLoadBarStore();

/**
 * Schedules `check` for "next frame" and returns a canceller. Prefers
 * `requestAnimationFrame` so the check runs after the browser has had a
 * chance to commit and paint the current pending state; falls back to a
 * zero-delay timeout where `requestAnimationFrame` isn't available (jsdom /
 * happy-dom under fake timers in tests).
 */
function scheduleNextFrame(check: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(check);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(check, 0);
  return () => clearTimeout(id);
}

export interface ColdLoadGateProps {
  children: ReactNode;
  /** Reveals even if pending work never completes. Defaults to 2500ms. */
  timeoutMs?: number;
}

/**
 * Wraps a page (or a subtree) that should stay hidden until every part
 * registered with `useColdLoad` reports ready, then fades it in once.
 *
 * The pending count reaching zero does not reveal synchronously: a child
 * unmounting (e.g. a placeholder or Suspense fallback) and a sibling
 * registering as pending can land in separate commits, and revealing between
 * them would fade the page in before its real content has actually
 * registered. Instead, reaching zero schedules a check for the next frame;
 * the gate reveals only if the count is still zero when that check runs, and
 * any register in the meantime cancels the scheduled check.
 *
 * A warm load where nothing registers as pending during the first commit
 * never becomes cold at all (see the mount effect below), and a stuck load
 * that reveals via `timeoutMs` still leaves the shared progress bar running
 * for as long as its pending count stays above zero.
 */
export function ColdLoadGate({ children, timeoutMs = 2500 }: ColdLoadGateProps) {
  const gateId = useId();
  const pendingCount = useRef(0);
  const revealedRef = useRef(false);
  const unmountedRef = useRef(false);
  const cancelScheduledCheck = useRef<(() => void) | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);

  // Reports this gate's own "still loading" flag to the shared bar store.
  // Deliberately independent of `revealed`/content visibility: a stuck load
  // that reveals via the timeout must keep the bar running while its
  // pending count is still above zero, not hide it just because the gate's
  // content stopped being cold.
  const syncBarLoading = () => {
    if (unmountedRef.current) return;
    coldLoadBarStore.setGateLoading(
      gateId,
      pendingCount.current > 0 || cancelScheduledCheck.current !== null,
    );
  };

  const cancelCheck = () => {
    cancelScheduledCheck.current?.();
    cancelScheduledCheck.current = null;
  };

  const reveal = () => {
    if (unmountedRef.current || revealedRef.current) return;
    cancelCheck();
    revealedRef.current = true;
    setRevealed(true);
    setPending(false);
    syncBarLoading();
  };

  const scheduleCheck = () => {
    if (unmountedRef.current) return;
    cancelCheck();
    cancelScheduledCheck.current = scheduleNextFrame(() => {
      cancelScheduledCheck.current = null;
      if (!unmountedRef.current && pendingCount.current === 0) reveal();
      syncBarLoading();
    });
    syncBarLoading();
  };

  // Runs once, after the gate mounts. React fires a subtree's layout effects
  // child-first, so every `useColdLoad` registration from the first commit
  // (via each child's own layout effect) has already happened by the time
  // this runs, and `pendingCount` already reflects it. A warm navigation
  // where everything is ready on arrival never becomes cold at all: no
  // `data-cold` is ever set, so the CSS opacity/visibility transition never
  // engages.
  useLayoutEffect(() => {
    if (pendingCount.current > 0) {
      setPending(true);
      syncBarLoading();
    } else {
      reveal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount by design; reveal only closes over refs/setState
  }, []);

  useLayoutEffect(() => {
    if (revealedRef.current) return undefined;
    const timer = window.setTimeout(reveal, timeoutMs);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reveal only closes over refs/setState, stable in effect
  }, [timeoutMs]);

  // React 18 StrictMode (dev only) runs every effect's cleanup once right
  // after the initial mount and then re-runs the effect, to surface effects
  // that aren't resilient to being torn down and set up again. This effect
  // has to survive that: the setup half undoes exactly what the cleanup half
  // did, so a StrictMode remount leaves the gate in the same state a normal
  // single mount would have.
  useLayoutEffect(() => {
    // Un-mark whatever the previous cleanup (real or StrictMode-simulated)
    // set, and re-publish this gate's current loading state to the store:
    // the cleanup below unconditionally removed this gate's entry, so a
    // remount has to re-add it even though nothing about the gate's own
    // pending count actually changed.
    unmountedRef.current = false;
    syncBarLoading();
    // The cleanup below also cancels any scheduled "still zero next frame?"
    // check. If one was in flight (pending count already back at zero, gate
    // not yet revealed) it has to be re-armed here, or a StrictMode remount
    // would otherwise leave the gate cold forever with nothing left to ever
    // reveal it.
    if (
      !revealedRef.current &&
      pendingCount.current === 0 &&
      cancelScheduledCheck.current === null
    ) {
      scheduleCheck();
    }
    return () => {
      unmountedRef.current = true;
      cancelCheck();
      coldLoadBarStore.setGateLoading(gateId, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncBarLoading/scheduleCheck only close over refs/setState/gateId, stable in this context
  }, [gateId]);

  const contextValue = useMemo<ColdLoadContextValue>(
    () => ({
      register() {
        cancelCheck();
        pendingCount.current += 1;
        setPending(true);
        syncBarLoading();
        let released = false;
        return () => {
          if (released) return;
          released = true;
          pendingCount.current -= 1;
          if (pendingCount.current <= 0) {
            pendingCount.current = 0;
            scheduleCheck();
          } else {
            syncBarLoading();
          }
        };
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- register only closes over refs/setState/gateId, stable in this context
    [],
  );

  const gatePending = pending && !revealed;

  return (
    <ColdLoadContext.Provider value={contextValue}>
      <div
        className="cold-load"
        data-cold={gatePending || undefined}
        aria-busy={gatePending || undefined}
      >
        {children}
      </div>
    </ColdLoadContext.Provider>
  );
}

/**
 * Registers `pending` as an outstanding part of the nearest cold-load gate.
 * No-op when rendered outside a `ColdLoadGate`.
 */
export function useColdLoad(pending: boolean): void {
  const gate = useContext(ColdLoadContext);

  useLayoutEffect(() => {
    if (!gate || !pending) return undefined;
    const release = gate.register();
    return release;
  }, [gate, pending]);
}

/**
 * Reads whether any mounted cold-load gate is still loading (pending count
 * above zero, or a reveal check scheduled), for progress indicators. Stays
 * `true` across a gate's own timeout-driven reveal as long as its pending
 * count hasn't reached zero, and is ref-counted across every mounted gate.
 */
export function useColdLoadState(): ColdLoadBarState {
  return useSyncExternalStore(coldLoadBarStore.subscribe, coldLoadBarStore.getSnapshot);
}
