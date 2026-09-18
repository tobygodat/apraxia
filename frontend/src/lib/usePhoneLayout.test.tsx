// @vitest-environment happy-dom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PHONE_LAYOUT_QUERY, usePhoneLayout } from "./usePhoneLayout";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  return <p>{usePhoneLayout() ? "phone" : "desktop"}</p>;
}

/** A matchMedia stand-in whose match can be flipped the way a resize flips it. */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    media: PHONE_LAYOUT_QUERY,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  return {
    set(next: boolean) {
      query.matches = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

describe("usePhoneLayout", () => {
  it("reports the desktop layout where matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<Probe />);
    expect(screen.getByText("desktop")).toBeTruthy();
  });

  it("reports the phone layout while the query matches", () => {
    stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByText("phone")).toBeTruthy();
  });

  it("follows the query across a viewport change and unsubscribes on unmount", () => {
    const media = stubMatchMedia(false);
    const view = render(<Probe />);
    expect(screen.getByText("desktop")).toBeTruthy();

    act(() => media.set(true));
    expect(screen.getByText("phone")).toBeTruthy();

    view.unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
