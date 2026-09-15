// @vitest-environment happy-dom

import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth, type AuthState } from "./AuthProvider";
import { RequireAuth } from "./RequireAuth";
import type { AuthIdentity, AuthPort, AuthStateChange, AuthStateListener } from "./authPort";
import { registerUserStateResetter } from "./userState";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function fakeAuthPort() {
  let listener: AuthStateListener | null = null;
  const unsubscribe = vi.fn();
  const restore = vi.fn<() => Promise<AuthStateChange>>();
  const subscribe = vi.fn((nextListener: AuthStateListener) => {
    listener = nextListener;
    return unsubscribe;
  });
  const signOut = vi.fn<() => Promise<void>>();
  const port: AuthPort = { restore, subscribe, signOut };

  return {
    port,
    restore,
    signOut,
    subscribe,
    unsubscribe,
    emit(change: AuthStateChange) {
      if (!listener) throw new Error("AuthProvider has not subscribed yet.");
      listener(change);
    },
  };
}

const userA: AuthIdentity = {
  userId: "user-a",
  email: "a@example.com",
  expiresAt: 1_800_000_000,
};

const userB: AuthIdentity = {
  userId: "user-b",
  email: "b@example.com",
  expiresAt: 1_800_000_100,
};

function stateLabel(state: AuthState): string {
  if (state.status === "authenticated") {
    return [
      state.status,
      state.identity.userId,
      state.identity.email ?? "no-email",
      state.signOutStatus,
    ].join(":");
  }
  if (state.status === "anonymous") {
    return `${state.status}:${state.reason}`;
  }
  return state.status;
}

function StateControls() {
  const { retryCleanup, retryRestore, signOut, state } = useAuth();

  return (
    <>
      <output data-testid="auth-state">{stateLabel(state)}</output>
      <button type="button" onClick={retryRestore}>
        Retry restore
      </button>
      <button type="button" onClick={retryCleanup}>
        Retry cleanup
      </button>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </>
  );
}

function PrivateContent() {
  return <p>private workspace</p>;
}

function TestApp({ port }: { readonly port: AuthPort }) {
  return (
    <AuthProvider port={port}>
      <StateControls />
      <RequireAuth
        restoring={<p>restoring boundary</p>}
        restoreError={<p>restore error boundary</p>}
        cleanupError={<p>cleanup error boundary</p>}
        anonymous={(reason) => <p>anonymous boundary: {reason}</p>}
      >
        {() => <PrivateContent />}
      </RequireAuth>
    </AuthProvider>
  );
}

async function expectState(label: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("auth-state").textContent).toBe(label);
  });
}

const unregisterAfterTest: Array<() => void> = [];

function registerTestResetter(reset: () => void): void {
  unregisterAfterTest.push(registerUserStateResetter(reset));
}

afterEach(() => {
  cleanup();
  while (unregisterAfterTest.length > 0) unregisterAfterTest.pop()?.();
});

describe("AuthProvider restoration", () => {
  it("restores a valid identity", async () => {
    const fake = fakeAuthPort();
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });

    render(<TestApp port={fake.port} />);

    expect(screen.getByTestId("auth-state").textContent).toBe("restoring");
    expect(screen.queryByText("private workspace")).toBeNull();
    await expectState("authenticated:user-a:a@example.com:idle");
    expect(screen.getByText("private workspace").textContent).toBe("private workspace");
  });

  it("restores a missing session as anonymous", async () => {
    const fake = fakeAuthPort();
    fake.restore.mockResolvedValueOnce({
      identity: null,
      reason: "no_session",
    });

    render(<TestApp port={fake.port} />);

    await expectState("anonymous:no_session");
    expect(screen.getByText("anonymous boundary: no_session").textContent).toBe(
      "anonymous boundary: no_session",
    );
    expect(screen.queryByText("private workspace")).toBeNull();
  });

  it("shows a restore error and retries from a clean restoring state", async () => {
    const fake = fakeAuthPort();
    const retry = deferred<AuthStateChange>();
    fake.restore
      .mockRejectedValueOnce(new Error("session storage unavailable"))
      .mockReturnValueOnce(retry.promise);

    render(<TestApp port={fake.port} />);

    await expectState("restore_error");
    expect(screen.getByText("restore error boundary").textContent).toBe("restore error boundary");
    fireEvent.click(screen.getByRole("button", { name: "Retry restore" }));
    expect(screen.getByTestId("auth-state").textContent).toBe("restoring");
    expect(screen.queryByText("private workspace")).toBeNull();

    await act(async () => {
      retry.resolve({ identity: userA, reason: "INITIAL_SESSION" });
      await retry.promise;
    });

    await expectState("authenticated:user-a:a@example.com:idle");
    expect(fake.restore).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale restore result after a newer auth event", async () => {
    const fake = fakeAuthPort();
    const restore = deferred<AuthStateChange>();
    fake.restore.mockReturnValueOnce(restore.promise);

    render(<TestApp port={fake.port} />);

    act(() => {
      fake.emit({ identity: userA, reason: "SIGNED_IN" });
    });
    await expectState("authenticated:user-a:a@example.com:idle");

    await act(async () => {
      restore.resolve({ identity: null, reason: "no_session" });
      await restore.promise;
    });

    expect(screen.getByTestId("auth-state").textContent).toBe(
      "authenticated:user-a:a@example.com:idle",
    );
    expect(screen.getByText("private workspace").textContent).toBe("private workspace");
  });
});

describe("AuthProvider sign-out", () => {
  it("falls back to a signed-out state when successful sign-out emits no event", async () => {
    const fake = fakeAuthPort();
    const signOut = deferred<void>();
    const reset = vi.fn();
    registerTestResetter(reset);
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });
    fake.signOut.mockReturnValueOnce(signOut.promise);
    render(<TestApp port={fake.port} />);
    await expectState("authenticated:user-a:a@example.com:idle");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByTestId("auth-state").textContent).toBe(
      "authenticated:user-a:a@example.com:pending",
    );
    expect(screen.getByText("private workspace").textContent).toBe("private workspace");

    await act(async () => {
      signOut.resolve();
      await signOut.promise;
    });

    await expectState("anonymous:signed_out");
    expect(screen.queryByText("private workspace")).toBeNull();
    expect(reset).toHaveBeenCalledOnce();

    act(() => {
      fake.emit({ identity: null, reason: "SIGNED_OUT" });
    });
    expect(screen.getByTestId("auth-state").textContent).toBe("anonymous:signed_out");
    expect(reset).toHaveBeenCalledOnce();
  });

  it("keeps an explicit sign-out pending through a same-user refresh", async () => {
    const fake = fakeAuthPort();
    const signOut = deferred<void>();
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });
    fake.signOut.mockReturnValueOnce(signOut.promise);
    render(<TestApp port={fake.port} />);
    await expectState("authenticated:user-a:a@example.com:idle");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    act(() => {
      fake.emit({
        identity: { ...userA, expiresAt: userA.expiresAt! + 3_600 },
        reason: "TOKEN_REFRESHED",
      });
    });
    expect(screen.getByTestId("auth-state").textContent).toBe(
      "authenticated:user-a:a@example.com:pending",
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(fake.signOut).toHaveBeenCalledOnce();

    await act(async () => {
      signOut.resolve();
      await signOut.promise;
    });
    await expectState("anonymous:signed_out");
  });

  it("treats an unexpected SIGNED_OUT event as an expired session", async () => {
    const fake = fakeAuthPort();
    const reset = vi.fn();
    registerTestResetter(reset);
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });
    render(<TestApp port={fake.port} />);
    await expectState("authenticated:user-a:a@example.com:idle");

    act(() => {
      fake.emit({ identity: null, reason: "SIGNED_OUT" });
    });

    await expectState("anonymous:expired");
    expect(screen.queryByText("private workspace")).toBeNull();
    expect(reset).toHaveBeenCalledOnce();
    expect(fake.signOut).not.toHaveBeenCalled();
  });

  it("keeps the latest same-user identity and private content when sign-out fails", async () => {
    const fake = fakeAuthPort();
    const signOut = deferred<void>();
    const reset = vi.fn();
    const refreshedIdentity = {
      ...userA,
      email: "fresh@example.com",
      expiresAt: userA.expiresAt! + 3_600,
    };
    registerTestResetter(reset);
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });
    fake.signOut.mockReturnValueOnce(signOut.promise);
    render(<TestApp port={fake.port} />);
    await expectState("authenticated:user-a:a@example.com:idle");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByText("private workspace").textContent).toBe("private workspace");
    act(() => {
      fake.emit({ identity: refreshedIdentity, reason: "TOKEN_REFRESHED" });
    });

    await act(async () => {
      signOut.reject(new Error("network failure"));
      try {
        await signOut.promise;
      } catch {
        // The provider converts the rejected port operation into UI state.
      }
    });

    // A failed sign-out must not sign the user out locally: the session is
    // still live, so private content stays mounted and state stays untouched.
    await expectState("authenticated:user-a:fresh@example.com:error");
    expect(screen.getByText("private workspace").textContent).toBe("private workspace");
    expect(reset).not.toHaveBeenCalled();
  });
});

describe("AuthProvider fail-closed cleanup", () => {
  it("blocks an account switch until a failed cleanup is retried successfully", async () => {
    const fake = fakeAuthPort();
    let shouldFail = true;
    const reset = vi.fn(() => {
      if (shouldFail) throw new Error("private cleanup detail");
    });
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    registerTestResetter(reset);
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });
    render(<TestApp port={fake.port} />);
    await expectState("authenticated:user-a:a@example.com:idle");

    act(() => {
      fake.emit({ identity: userB, reason: "SIGNED_IN" });
    });

    await expectState("cleanup_error");
    expect(screen.getByText("cleanup error boundary").textContent).toBe("cleanup error boundary");
    expect(screen.queryByText("private workspace")).toBeNull();
    expect(screen.queryByText(/b@example\.com/)).toBeNull();
    expect(report.mock.calls.flat().join(" ")).not.toContain("private cleanup detail");

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry cleanup" }));

    await expectState("authenticated:user-b:b@example.com:idle");
    expect(screen.getByText("private workspace").textContent).toBe("private workspace");
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("blocks completed sign-out until local state cleanup succeeds", async () => {
    const fake = fakeAuthPort();
    let shouldFail = true;
    const reset = vi.fn(() => {
      if (shouldFail) throw new Error("cleanup failed");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerTestResetter(reset);
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });
    fake.signOut.mockResolvedValueOnce();
    render(<TestApp port={fake.port} />);
    await expectState("authenticated:user-a:a@example.com:idle");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await expectState("cleanup_error");
    expect(screen.queryByText("private workspace")).toBeNull();

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry cleanup" }));

    await expectState("anonymous:signed_out");
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("keeps a same-user reauthentication closed until prior state is cleared", async () => {
    const fake = fakeAuthPort();
    let shouldFail = true;
    const reset = vi.fn(() => {
      if (shouldFail) throw new Error("cleanup failed");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerTestResetter(reset);
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });
    render(<TestApp port={fake.port} />);
    await expectState("authenticated:user-a:a@example.com:idle");

    act(() => {
      fake.emit({ identity: null, reason: "SIGNED_OUT" });
    });
    await expectState("cleanup_error");

    act(() => {
      fake.emit({
        identity: { ...userA, email: "reauthenticated@example.com" },
        reason: "SIGNED_IN",
      });
    });
    expect(screen.getByTestId("auth-state").textContent).toBe("cleanup_error");
    expect(screen.queryByText("private workspace")).toBeNull();

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry cleanup" }));

    await expectState("authenticated:user-a:reauthenticated@example.com:idle");
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("rejects a thenable resetter without mounting the next account", async () => {
    const fake = fakeAuthPort();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    registerTestResetter(() => Promise.resolve());
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });
    render(<TestApp port={fake.port} />);
    await expectState("authenticated:user-a:a@example.com:idle");

    act(() => {
      fake.emit({ identity: userB, reason: "SIGNED_IN" });
    });

    await expectState("cleanup_error");
    expect(screen.queryByText("private workspace")).toBeNull();
    expect(report).toHaveBeenCalledWith("Failed to clear user-scoped application state.");
  });

  it("does not start a new sign-out while A-to-B cleanup is pending", async () => {
    const fake = fakeAuthPort();
    const reset = vi.fn(() => {
      throw new Error("cleanup failed");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerTestResetter(reset);
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });
    fake.signOut.mockRejectedValue(new Error("must not be observed"));
    render(<TestApp port={fake.port} />);
    await expectState("authenticated:user-a:a@example.com:idle");

    act(() => {
      fake.emit({ identity: userB, reason: "SIGNED_IN" });
    });
    await expectState("cleanup_error");

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await act(async () => {
      await Promise.resolve();
    });

    // The port is never reached, so neither adapter outcome is observable.
    expect(fake.signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId("auth-state").textContent).toBe("cleanup_error");
    expect(screen.queryByText("private workspace")).toBeNull();
    expect(reset).toHaveBeenCalledOnce();
  });

  it.each(["resolve", "reject"] as const)(
    "keeps A-to-B cleanup closed when an already pending sign-out %ss",
    async (outcome) => {
      const fake = fakeAuthPort();
      const signOut = deferred<void>();
      const reset = vi.fn(() => {
        throw new Error("cleanup failed");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      registerTestResetter(reset);
      fake.restore.mockResolvedValueOnce({
        identity: userA,
        reason: "INITIAL_SESSION",
      });
      fake.signOut.mockReturnValueOnce(signOut.promise);
      render(<TestApp port={fake.port} />);
      await expectState("authenticated:user-a:a@example.com:idle");

      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      act(() => {
        fake.emit({ identity: userB, reason: "SIGNED_IN" });
      });
      await expectState("cleanup_error");

      await act(async () => {
        if (outcome === "resolve") {
          signOut.resolve();
        } else {
          signOut.reject(new Error("late sign-out failure"));
        }
        try {
          await signOut.promise;
        } catch {
          // Either adapter outcome must preserve the failed account boundary.
        }
      });

      expect(fake.signOut).toHaveBeenCalledOnce();
      expect(screen.getByTestId("auth-state").textContent).toBe("cleanup_error");
      expect(screen.queryByText("private workspace")).toBeNull();
      expect(reset).toHaveBeenCalledOnce();
    },
  );
});

describe("AuthProvider teardown", () => {
  it("unsubscribes and ignores restore promises and events that settle after unmount", async () => {
    const fake = fakeAuthPort();
    const restore = deferred<AuthStateChange>();
    const observedStates = vi.fn<(state: AuthState) => void>();
    const reset = vi.fn();
    registerTestResetter(reset);
    fake.restore.mockReturnValueOnce(restore.promise);

    function StateObserver() {
      const { state } = useAuth();
      useEffect(() => observedStates(state), [state]);
      return null;
    }

    const view = render(
      <AuthProvider port={fake.port}>
        <StateObserver />
      </AuthProvider>,
    );
    expect(observedStates).toHaveBeenCalledWith({ status: "restoring" });
    const observationsBeforeUnmount = observedStates.mock.calls.length;

    view.unmount();
    expect(fake.subscribe).toHaveBeenCalledOnce();
    expect(fake.unsubscribe).toHaveBeenCalledOnce();

    act(() => {
      fake.emit({ identity: userA, reason: "SIGNED_IN" });
    });
    await act(async () => {
      restore.resolve({ identity: userA, reason: "INITIAL_SESSION" });
      await restore.promise;
    });

    expect(observedStates).toHaveBeenCalledTimes(observationsBeforeUnmount);
    expect(reset).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a pending sign-out that %ss after unmount",
    async (outcome) => {
      const fake = fakeAuthPort();
      const signOut = deferred<void>();
      const reset = vi.fn();
      registerTestResetter(reset);
      fake.restore.mockResolvedValueOnce({
        identity: userA,
        reason: "INITIAL_SESSION",
      });
      fake.signOut.mockReturnValueOnce(signOut.promise);

      const view = render(<TestApp port={fake.port} />);
      await expectState("authenticated:user-a:a@example.com:idle");
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      expect(screen.getByTestId("auth-state").textContent).toBe(
        "authenticated:user-a:a@example.com:pending",
      );

      view.unmount();
      await act(async () => {
        if (outcome === "resolve") {
          signOut.resolve();
        } else {
          signOut.reject(new Error("late sign-out failure"));
        }
        try {
          await signOut.promise;
        } catch {
          // Both late outcomes must be ignored by the unmounted provider.
        }
      });

      expect(fake.unsubscribe).toHaveBeenCalledOnce();
      expect(reset).not.toHaveBeenCalled();
    },
  );
});
