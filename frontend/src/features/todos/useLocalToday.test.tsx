// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalToday } from "./useLocalToday";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useLocalToday", () => {
  it("derives the date from the supplied profile timezone, not UTC", () => {
    vi.setSystemTime(new Date("2026-09-03T02:00:00Z"));

    const { result } = renderHook(() => useLocalToday("America/New_York"));

    expect(result.current).toBe("2026-09-02");
  });

  it("changes timezone synchronously without returning the previous zone's date", () => {
    vi.setSystemTime(new Date("2026-09-03T02:00:00Z"));
    const { result, rerender } = renderHook(({ timeZone }) => useLocalToday(timeZone), {
      initialProps: { timeZone: "America/New_York" },
    });
    expect(result.current).toBe("2026-09-02");

    rerender({ timeZone: "Asia/Tokyo" });
    expect(result.current).toBe("2026-09-03");

    rerender({ timeZone: "America/Los_Angeles" });
    expect(result.current).toBe("2026-09-02");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("observes a midnight change within the documented 60-second sampling bound", () => {
    vi.setSystemTime(new Date("2026-09-03T03:59:59.999Z"));
    const { result } = renderHook(() => useLocalToday("America/New_York"));
    expect(result.current).toBe("2026-09-02");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("2026-09-02");

    act(() => vi.advanceTimersByTime(59_999));
    expect(result.current).toBe("2026-09-03");
  });

  it("changes date after the 23-hour spring-forward day", () => {
    vi.setSystemTime(new Date("2026-03-08T05:00:00Z"));
    const { result } = renderHook(() => useLocalToday("America/New_York"));
    expect(result.current).toBe("2026-03-08");

    act(() => vi.advanceTimersByTime(23 * 60 * 60 * 1_000 - 1));
    expect(result.current).toBe("2026-03-08");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("2026-03-09");
  });

  it("waits through the 25-hour fall-back day before changing date", () => {
    vi.setSystemTime(new Date("2026-11-01T04:00:00Z"));
    const { result } = renderHook(() => useLocalToday("America/New_York"));
    expect(result.current).toBe("2026-11-01");

    act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1_000));
    expect(result.current).toBe("2026-11-01");

    act(() => vi.advanceTimersByTime(60 * 60 * 1_000));
    expect(result.current).toBe("2026-11-02");
  });

  it("refreshes immediately on window focus after the clock advances during sleep", () => {
    vi.setSystemTime(new Date("2026-09-02T16:00:00Z"));
    const { result } = renderHook(() => useLocalToday("America/New_York"));

    vi.setSystemTime(new Date("2026-09-04T16:00:00Z"));
    act(() => window.dispatchEvent(new Event("focus")));

    expect(result.current).toBe("2026-09-04");
  });

  it("refreshes immediately when a sleeping document becomes visible", () => {
    vi.setSystemTime(new Date("2026-09-02T16:00:00Z"));
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { result } = renderHook(() => useLocalToday("America/New_York"));

    vi.setSystemTime(new Date("2026-09-03T16:00:00Z"));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe("2026-09-02");

    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe("2026-09-03");
  });

  it("removes its timer and foreground listeners when unmounted", () => {
    vi.setSystemTime(new Date("2026-09-02T16:00:00Z"));
    const addWindowListener = vi.spyOn(window, "addEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useLocalToday("America/New_York"));
    const focusListener = addWindowListener.mock.calls.find(
      ([eventName]) => eventName === "focus",
    )?.[1];
    const visibilityListener = addDocumentListener.mock.calls.find(
      ([eventName]) => eventName === "visibilitychange",
    )?.[1];
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindowListener).toHaveBeenCalledWith("focus", focusListener);
    expect(removeDocumentListener).toHaveBeenCalledWith("visibilitychange", visibilityListener);
  });
});
