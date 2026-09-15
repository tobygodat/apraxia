// @vitest-environment happy-dom

import { StrictMode, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ColdLoadGate, useColdLoad, useColdLoadState } from "./coldLoad";

beforeEach(() => {
  // Force the setTimeout(0) fallback path so the deferred "still zero next
  // frame?" check is deterministic under fake timers, matching what the
  // gate falls back to when requestAnimationFrame isn't available.
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("cancelAnimationFrame", undefined);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Registers as pending until `resolve` is called, then unregisters. */
function PendingChild({ onResolve }: { onResolve: (resolve: () => void) => void }) {
  const [pending, setPending] = useState(true);
  useColdLoad(pending);
  useEffect(() => {
    onResolve(() => setPending(false));
  }, [onResolve]);
  return <p>content</p>;
}

/** A child whose pending state is externally controlled via `onReady`. */
function ControllableChild({
  label,
  initialPending,
  onReady,
}: {
  label: string;
  initialPending: boolean;
  onReady: (setPending: (pending: boolean) => void) => void;
}) {
  const [pending, setPending] = useState(initialPending);
  useColdLoad(pending);
  useEffect(() => {
    onReady(setPending);
  }, [onReady]);
  return <p>{label}</p>;
}

describe("ColdLoadGate", () => {
  // The initial `pending` state is `false`, so the very first commit never
  // renders `data-cold`; only the mount effect (running after every
  // first-commit child has registered via its own layout effect, since
  // layout effects fire child-first) can mark the gate cold, and it does so
  // synchronously (state set from a layout effect flushes before paint).
  // That's what a cold child's gate still shows `data-cold` right after
  // `render()` with no extra `act()`/timer advance below, and why a warm
  // gate (nothing ever registers) never gets the attribute at all.
  it("hides children while a registered part is pending, and marks the gate aria-busy", () => {
    render(
      <ColdLoadGate>
        <PendingChild onResolve={() => undefined} />
      </ColdLoadGate>,
    );
    const wrapper = screen.getByText("content").parentElement!;
    expect(wrapper.getAttribute("data-cold")).toBe("true");
    expect(wrapper.getAttribute("aria-busy")).toBe("true");
  });

  it("never marks a warm gate cold when nothing registers as pending in the first commit", () => {
    render(
      <ColdLoadGate>
        <p>ready immediately</p>
      </ColdLoadGate>,
    );
    const wrapper = screen.getByText("ready immediately").parentElement!;
    // No act()/timer advance: this must already be true synchronously, right
    // after the initial render, with no data-cold ever having been set.
    expect(wrapper.getAttribute("data-cold")).toBeNull();
    // ...and it stays that way: nothing ever flips the attribute on and back
    // off later, so the CSS fade (which only plays on a data-cold removal)
    // never has anything to trigger on for a warm gate.
    act(() => vi.advanceTimersByTime(2500));
    expect(wrapper.getAttribute("data-cold")).toBeNull();
  });

  it("does not reveal synchronously when pending reaches zero, only after the next frame", () => {
    let resolve: (() => void) | undefined;
    render(
      <ColdLoadGate>
        <PendingChild
          onResolve={(r) => {
            resolve = r;
          }}
        />
      </ColdLoadGate>,
    );
    const wrapper = screen.getByText("content").parentElement!;
    expect(wrapper.getAttribute("data-cold")).toBe("true");

    act(() => resolve?.());
    // Still cold immediately after the count hits zero: the reveal is deferred.
    expect(wrapper.getAttribute("data-cold")).toBe("true");

    act(() => vi.advanceTimersByTime(0));
    expect(wrapper.getAttribute("data-cold")).toBeNull();
    expect(wrapper.getAttribute("aria-busy")).toBeNull();
  });

  it("stays cold when a successor registers before the deferred check runs", () => {
    let setA: ((pending: boolean) => void) | undefined;
    let setB: ((pending: boolean) => void) | undefined;
    render(
      <ColdLoadGate>
        <ControllableChild
          label="a"
          initialPending={true}
          onReady={(setPending) => {
            setA = setPending;
          }}
        />
        <ControllableChild
          label="b"
          initialPending={false}
          onReady={(setPending) => {
            setB = setPending;
          }}
        />
      </ColdLoadGate>,
    );
    const wrapper = screen.getByText("a").parentElement!;
    expect(wrapper.getAttribute("data-cold")).toBe("true");

    // Child A unregisters in one commit...
    act(() => setA?.(false));
    // ...and child B registers as pending in the next commit, before the
    // scheduled "still zero?" check has a chance to run.
    act(() => setB?.(true));

    act(() => vi.advanceTimersByTime(0));
    expect(wrapper.getAttribute("data-cold")).toBe("true");

    act(() => setB?.(false));
    act(() => vi.advanceTimersByTime(0));
    expect(wrapper.getAttribute("data-cold")).toBeNull();
  });

  it("stays revealed even if pending goes up again later", () => {
    function TwoPhaseChild() {
      const [pending, setPending] = useState(true);
      useColdLoad(pending);
      useEffect(() => {
        setPending(false);
      }, []);
      return (
        <button type="button" onClick={() => setPending(true)}>
          go pending again
        </button>
      );
    }
    render(
      <ColdLoadGate>
        <TwoPhaseChild />
      </ColdLoadGate>,
    );
    act(() => vi.advanceTimersByTime(0));
    const wrapper = screen.getByRole("button").parentElement!;
    expect(wrapper.getAttribute("data-cold")).toBeNull();
    act(() => screen.getByRole("button").click());
    expect(wrapper.getAttribute("data-cold")).toBeNull();
  });

  it("reveals via the timeout when pending work never finishes", () => {
    render(
      <ColdLoadGate timeoutMs={500}>
        <PendingChild onResolve={() => undefined} />
      </ColdLoadGate>,
    );
    const wrapper = screen.getByText("content").parentElement!;
    expect(wrapper.getAttribute("data-cold")).toBe("true");
    act(() => vi.advanceTimersByTime(500));
    expect(wrapper.getAttribute("data-cold")).toBeNull();
  });
});

describe("useColdLoadState", () => {
  function StateProbe() {
    const { pending } = useColdLoadState();
    return <p>pending:{String(pending)}</p>;
  }

  it("reports pending while a gate has outstanding work, then not pending once revealed", () => {
    let resolve: (() => void) | undefined;
    render(
      <ColdLoadGate>
        <PendingChild
          onResolve={(r) => {
            resolve = r;
          }}
        />
        <StateProbe />
      </ColdLoadGate>,
    );
    expect(screen.getByText("pending:true")).toBeTruthy();
    act(() => resolve?.());
    // Still pending: the deferred check hasn't run yet.
    expect(screen.getByText("pending:true")).toBeTruthy();
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByText("pending:false")).toBeTruthy();
  });

  it("stays pending after a timeout reveal while the pending count is still above zero", () => {
    render(
      <ColdLoadGate timeoutMs={500}>
        <PendingChild onResolve={() => undefined} />
        <StateProbe />
      </ColdLoadGate>,
    );
    expect(screen.getByText("pending:true")).toBeTruthy();

    act(() => vi.advanceTimersByTime(500));
    // Timed out and revealed the content, but the child never resolved: the
    // bar must keep running rather than the app going quiet on a stuck load.
    expect(screen.getByText("pending:true")).toBeTruthy();
  });

  it("clears a gate's contribution when it unmounts while still pending", () => {
    const { unmount } = render(
      <ColdLoadGate>
        <PendingChild onResolve={() => undefined} />
        <StateProbe />
      </ColdLoadGate>,
    );
    expect(screen.getByText("pending:true")).toBeTruthy();

    unmount();
    render(<StateProbe />);
    expect(screen.getByText("pending:false")).toBeTruthy();
  });

  it("is ref-counted: an outer gate revealing doesn't hide the bar while another gate is still cold", () => {
    let resolveA: (() => void) | undefined;
    render(
      <>
        <ColdLoadGate>
          <PendingChild
            onResolve={(r) => {
              resolveA = r;
            }}
          />
        </ColdLoadGate>
        <ColdLoadGate>
          <PendingChild onResolve={() => undefined} />
        </ColdLoadGate>
        <StateProbe />
      </>,
    );
    expect(screen.getByText("pending:true")).toBeTruthy();

    // The first gate's work finishes and it reveals...
    act(() => resolveA?.());
    act(() => vi.advanceTimersByTime(0));
    // ...but the second gate is still cold, so the bar must stay up.
    expect(screen.getByText("pending:true")).toBeTruthy();
  });
});

// React 18 StrictMode (dev only) mounts, runs every effect's cleanup once,
// then re-runs the effects, to surface effects that don't tolerate being
// torn down and set back up. The gate's mount/unmount effect has to survive
// that without getting permanently stuck "unmounted", and the bar store has
// to end up with this gate's entry re-added.
describe("ColdLoadGate under StrictMode", () => {
  it("still reveals a cold gate once its pending child releases", () => {
    let resolve: (() => void) | undefined;
    render(
      <StrictMode>
        <ColdLoadGate>
          <PendingChild
            onResolve={(r) => {
              resolve = r;
            }}
          />
        </ColdLoadGate>
      </StrictMode>,
    );
    const wrapper = screen.getByText("content").parentElement!;
    expect(wrapper.getAttribute("data-cold")).toBe("true");

    act(() => resolve?.());
    act(() => vi.advanceTimersByTime(0));
    expect(wrapper.getAttribute("data-cold")).toBeNull();
  });

  it("reports the bar store as pending while the gate is cold", () => {
    function StateProbe() {
      const { pending } = useColdLoadState();
      return <p>pending:{String(pending)}</p>;
    }
    render(
      <StrictMode>
        <ColdLoadGate>
          <PendingChild onResolve={() => undefined} />
          <StateProbe />
        </ColdLoadGate>
      </StrictMode>,
    );
    expect(screen.getByText("pending:true")).toBeTruthy();
  });
});
