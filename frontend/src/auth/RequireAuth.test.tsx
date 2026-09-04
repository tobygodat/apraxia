// @vitest-environment happy-dom

import { useEffect } from "react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "./AuthProvider";
import { RequireAuth } from "./RequireAuth";
import type {
  AuthIdentity,
  AuthPort,
  AuthStateChange,
  AuthStateListener,
} from "./authPort";
import { registerUserStateResetter } from "./userState";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function fakeAuthPort() {
  let listener: AuthStateListener | null = null;
  const restore = vi.fn<() => Promise<AuthStateChange>>();
  const unsubscribe = vi.fn();
  const port: AuthPort = {
    restore,
    subscribe(nextListener) {
      listener = nextListener;
      return unsubscribe;
    },
    signOut: vi.fn(async () => {}),
  };

  return {
    port,
    restore,
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

const unregisterAfterTest: Array<() => void> = [];

function registerTestResetter(reset: () => void): void {
  unregisterAfterTest.push(registerUserStateResetter(reset));
}

afterEach(() => {
  cleanup();
  while (unregisterAfterTest.length > 0) unregisterAfterTest.pop()?.();
  window.history.replaceState({}, "", "/");
});

function ProtectedChild({
  identity,
  mounted,
  unmounted,
}: {
  readonly identity: AuthIdentity;
  readonly mounted: (userId: string) => void;
  readonly unmounted: (userId: string) => void;
}) {
  useEffect(() => {
    mounted(identity.userId);
    return () => unmounted(identity.userId);
  }, []);

  return (
    <p>
      private:{identity.userId}:{identity.email}
    </p>
  );
}

function ProtectedApp({
  port,
  mounted,
  unmounted,
}: {
  readonly port: AuthPort;
  readonly mounted: (userId: string) => void;
  readonly unmounted: (userId: string) => void;
}) {
  return (
    <AuthProvider port={port}>
      <RequireAuth
        restoring={<p>restoring</p>}
        restoreError={<p>restore error</p>}
        cleanupError={<p>cleanup error</p>}
        anonymous={(reason) => <p>anonymous:{reason}</p>}
      >
        {(identity) => (
          <ProtectedChild
            identity={identity}
            mounted={mounted}
            unmounted={unmounted}
          />
        )}
      </RequireAuth>
    </AuthProvider>
  );
}

describe("RequireAuth", () => {
  it("never mounts protected content before authentication and preserves a deep link", async () => {
    const deepLink = "/todos?week=2026-09-07#overdue";
    window.history.replaceState({}, "", deepLink);
    const fake = fakeAuthPort();
    const restore = deferred<AuthStateChange>();
    const mounted = vi.fn();
    const unmounted = vi.fn();
    fake.restore.mockReturnValueOnce(restore.promise);

    render(
      <ProtectedApp
        port={fake.port}
        mounted={mounted}
        unmounted={unmounted}
      />,
    );

    expect(screen.getByText("restoring").textContent).toBe("restoring");
    expect(mounted).not.toHaveBeenCalled();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      deepLink,
    );

    await act(async () => {
      restore.resolve({ identity: userA, reason: "INITIAL_SESSION" });
      await restore.promise;
    });

    await waitFor(() => expect(mounted).toHaveBeenCalledWith("user-a"));
    expect(screen.getByText("private:user-a:a@example.com").textContent).toBe(
      "private:user-a:a@example.com",
    );
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      deepLink,
    );
  });

  it("updates a same-user refresh without cleanup or remounting", async () => {
    const fake = fakeAuthPort();
    const mounted = vi.fn();
    const unmounted = vi.fn();
    const reset = vi.fn();
    registerTestResetter(reset);
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });

    render(
      <ProtectedApp
        port={fake.port}
        mounted={mounted}
        unmounted={unmounted}
      />,
    );
    await waitFor(() => expect(mounted).toHaveBeenCalledWith("user-a"));

    act(() => {
      fake.emit({
        identity: {
          ...userA,
          email: "refreshed@example.com",
          expiresAt: 1_800_003_600,
        },
        reason: "TOKEN_REFRESHED",
      });
    });

    expect(screen.getByText("private:user-a:refreshed@example.com").textContent).toBe(
      "private:user-a:refreshed@example.com",
    );
    expect(reset).not.toHaveBeenCalled();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("clears user-scoped state and remounts the protected boundary for user B", async () => {
    const fake = fakeAuthPort();
    const order: string[] = [];
    const mounted = vi.fn((userId: string) => order.push(`mount:${userId}`));
    const unmounted = vi.fn((userId: string) => order.push(`unmount:${userId}`));
    const reset = vi.fn(() => order.push("clear:user-state"));
    registerTestResetter(reset);
    fake.restore.mockResolvedValueOnce({
      identity: userA,
      reason: "INITIAL_SESSION",
    });

    render(
      <ProtectedApp
        port={fake.port}
        mounted={mounted}
        unmounted={unmounted}
      />,
    );
    await waitFor(() => expect(mounted).toHaveBeenCalledWith("user-a"));
    order.length = 0;

    act(() => {
      fake.emit({ identity: userB, reason: "SIGNED_IN" });
    });

    await waitFor(() => expect(mounted).toHaveBeenCalledWith("user-b"));
    expect(screen.getByText("private:user-b:b@example.com").textContent).toBe(
      "private:user-b:b@example.com",
    );
    expect(reset).toHaveBeenCalledOnce();
    expect(unmounted).toHaveBeenCalledWith("user-a");
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(order).toEqual([
      "clear:user-state",
      "unmount:user-a",
      "mount:user-b",
    ]);
  });
});
