import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearUserScopedState,
  registerUserStateResetter,
} from "./userState";

const unregisterAfterTest: Array<() => void> = [];

function registerForTest(
  ...parameters: Parameters<typeof registerUserStateResetter>
): void {
  unregisterAfterTest.push(registerUserStateResetter(...parameters));
}

afterEach(() => {
  for (const unregister of unregisterAfterTest.splice(0)) unregister();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("user-scoped state cleanup", () => {
  it("runs cancellation before clearing and preserves registration order", () => {
    const calls: string[] = [];

    registerForTest(() => calls.push("clear first"));
    registerForTest(() => calls.push("cancel first"), { phase: "cancel" });
    registerForTest(() => calls.push("clear second"), { phase: "clear" });
    registerForTest(() => calls.push("cancel second"), { phase: "cancel" });

    expect(clearUserScopedState().ok).toBe(true);

    expect(calls).toEqual([
      "cancel first",
      "cancel second",
      "clear first",
      "clear second",
    ]);
  });

  it("supports idempotent unregistration", () => {
    const reset = vi.fn();
    const unregister = registerUserStateResetter(reset);

    unregister();
    unregister();
    expect(clearUserScopedState().ok).toBe(true);

    expect(reset).not.toHaveBeenCalled();
  });

  it("retains a failed resetter after unmount until a retry succeeds", () => {
    let shouldFail = true;
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const reset = vi.fn(() => {
      if (shouldFail) throw new Error("cleanup failed");
    });
    const unregister = registerUserStateResetter(reset);

    const failedCleanup = clearUserScopedState();
    expect(failedCleanup.ok).toBe(false);
    unregister();
    shouldFail = false;

    expect(failedCleanup.retry().ok).toBe(true);
    expect(reset).toHaveBeenCalledTimes(2);
    expect(clearUserScopedState().ok).toBe(true);
    expect(reset).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledOnce();
  });

  it("continues through every phase when a resetter throws", () => {
    const calls: string[] = [];
    const report = vi.spyOn(console, "error").mockImplementation(() => {});

    registerForTest(() => {
      calls.push("failing cancel");
      throw new Error("sensitive reset detail");
    }, { phase: "cancel" });
    registerForTest(() => calls.push("remaining cancel"), { phase: "cancel" });
    registerForTest(() => calls.push("clear"));

    expect(clearUserScopedState().ok).toBe(false);
    expect(calls).toEqual(["failing cancel", "remaining cancel", "clear"]);
    expect(report).toHaveBeenCalledWith(
      "Failed to clear user-scoped application state.",
    );
    expect(report.mock.calls.flat().join(" ")).not.toContain(
      "sensitive reset detail",
    );
  });

  it("repeats cancellation and clearing together after a transient failure", () => {
    const calls: string[] = [];
    let cancelFails = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerForTest(() => {
      calls.push("cancel");
      if (cancelFails) throw new Error("cancel failed");
    }, { phase: "cancel" });
    registerForTest(() => calls.push("clear"));

    const firstAttempt = clearUserScopedState();
    expect(firstAttempt.ok).toBe(false);
    expect(calls).toEqual(["cancel", "clear"]);

    cancelFails = false;
    expect(firstAttempt.retry().ok).toBe(true);
    expect(calls).toEqual(["cancel", "clear", "cancel", "clear"]);
  });

  it.each([
    ["promise", () => Promise.resolve()],
    [
      "thenable",
      () => ({
        then(resolve: () => void) {
          resolve();
        },
      }),
    ],
  ])("fails closed for an asynchronous %s resetter", async (_kind, reset) => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    registerForTest(reset);

    expect(clearUserScopedState().ok).toBe(false);
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith(
      "Failed to clear user-scoped application state.",
    );
  });

  it("ignores re-entrant cleanup but remains reusable for later transitions", () => {
    const firstResetter = vi.fn(() => clearUserScopedState());
    const secondResetter = vi.fn();

    registerForTest(firstResetter, { phase: "cancel" });
    registerForTest(secondResetter);

    expect(clearUserScopedState().ok).toBe(true);
    expect(firstResetter).toHaveBeenCalledTimes(1);
    expect(secondResetter).toHaveBeenCalledTimes(1);

    expect(clearUserScopedState().ok).toBe(true);
    expect(firstResetter).toHaveBeenCalledTimes(2);
    expect(secondResetter).toHaveBeenCalledTimes(2);
  });

  it("does not touch global storage or provider-owned session keys", () => {
    const storage: Storage = {
      clear: vi.fn(),
      getItem: vi.fn(() => "provider-session"),
      key: vi.fn(() => "sb-example-auth-token"),
      length: 1,
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", storage);

    const inMemoryState = { draft: "private draft" };
    registerForTest(() => {
      inMemoryState.draft = "";
    });

    expect(clearUserScopedState().ok).toBe(true);

    expect(inMemoryState.draft).toBe("");
    expect(storage.clear).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.key).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
