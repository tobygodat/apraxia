import { AuthError, type AuthChangeEvent, type Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { AuthStateChange } from "./authPort";
import { createSupabaseAuthPort, type SupabaseAuthClient } from "./supabaseAuthPort";

function session(overrides: Partial<Session> = {}): Session {
  return {
    access_token: "secret-access-token",
    refresh_token: "secret-refresh-token",
    expires_in: 3_600,
    expires_at: 1_798_765_432,
    token_type: "bearer",
    user: {
      id: "user-123",
      email: "user@example.com",
      app_metadata: {},
      user_metadata: { privatePreference: "do-not-copy" },
      aud: "authenticated",
      created_at: "2026-09-02T12:00:00.000Z",
    },
    ...overrides,
  };
}

interface FakeAuthOptions {
  restoredSession?: Session | null;
  restoreError?: AuthError | null;
  signOutError?: AuthError | null;
}

function fakeClient({
  restoredSession = null,
  restoreError = null,
  signOutError = null,
}: FakeAuthOptions = {}) {
  let authListener: ((event: AuthChangeEvent, currentSession: Session | null) => void) | undefined;
  const unsubscribe = vi.fn();
  const getSession = vi.fn<SupabaseAuthClient["auth"]["getSession"]>(async () => {
    if (restoreError) {
      return { data: { session: null }, error: restoreError };
    }

    if (restoredSession) {
      return { data: { session: restoredSession }, error: null };
    }

    return { data: { session: null }, error: null };
  });
  const onAuthStateChange = vi.fn(
    (listener: (event: AuthChangeEvent, currentSession: Session | null) => void) => {
      authListener = listener;

      return {
        data: {
          subscription: {
            id: "test-subscription",
            callback: listener,
            unsubscribe,
          },
        },
      };
    },
  );
  const signOut = vi.fn<SupabaseAuthClient["auth"]["signOut"]>(async (_options) => ({
    error: signOutError,
  }));
  const client: SupabaseAuthClient = {
    auth: {
      getSession,
      onAuthStateChange,
      signOut,
    },
  };

  return {
    client,
    emit(event: AuthChangeEvent, currentSession: Session | null) {
      if (!authListener) throw new Error("Subscribe before emitting auth events.");
      authListener(event, currentSession);
    },
    getSession,
    onAuthStateChange,
    signOut,
    unsubscribe,
  };
}

describe("createSupabaseAuthPort", () => {
  it("restores a session as an exactly sanitized identity", async () => {
    const fake = fakeClient({ restoredSession: session() });
    const port = createSupabaseAuthPort(fake.client);

    const change = await port.restore();

    expect(change).toEqual({
      identity: {
        userId: "user-123",
        email: "user@example.com",
        expiresAt: 1_798_765_432,
      },
      reason: "INITIAL_SESSION",
    });
    expect(Object.keys(change.identity ?? {}).sort()).toEqual(["email", "expiresAt", "userId"]);
    expect(JSON.stringify(change)).not.toContain("secret-access-token");
    expect(JSON.stringify(change)).not.toContain("secret-refresh-token");
    expect(fake.getSession).toHaveBeenCalledOnce();
  });

  it("distinguishes restoration with no session", async () => {
    const fake = fakeClient();
    const port = createSupabaseAuthPort(fake.client);

    await expect(port.restore()).resolves.toEqual({
      identity: null,
      reason: "no_session",
    });
  });

  it("propagates session restoration errors", async () => {
    const restoreError = new AuthError("session storage failed");
    const fake = fakeClient({ restoreError });
    const port = createSupabaseAuthPort(fake.client);

    await expect(port.restore()).rejects.toBe(restoreError);
  });

  it("reports Supabase auth reasons without exposing sessions or tokens", () => {
    const fake = fakeClient();
    const port = createSupabaseAuthPort(fake.client);
    const listener = vi.fn<(change: AuthStateChange) => void>();
    port.subscribe(listener);
    const activeSession = session();

    for (const reason of [
      "INITIAL_SESSION",
      "SIGNED_IN",
      "TOKEN_REFRESHED",
      "USER_UPDATED",
    ] as const) {
      fake.emit(reason, activeSession);
    }
    fake.emit("SIGNED_OUT", null);

    expect(listener.mock.calls.map(([change]) => change.reason)).toEqual([
      "INITIAL_SESSION",
      "SIGNED_IN",
      "TOKEN_REFRESHED",
      "USER_UPDATED",
      "SIGNED_OUT",
    ]);
    expect(listener).toHaveBeenLastCalledWith({
      identity: null,
      reason: "SIGNED_OUT",
    });

    for (const [change] of listener.mock.calls) {
      expect(JSON.stringify(change)).not.toContain("secret-access-token");
      expect(JSON.stringify(change)).not.toContain("secret-refresh-token");
    }
  });

  it("unsubscribes from auth changes cleanly and only once", () => {
    const fake = fakeClient();
    const port = createSupabaseAuthPort(fake.client);
    const unsubscribe = port.subscribe(vi.fn());

    unsubscribe();
    unsubscribe();

    expect(fake.onAuthStateChange).toHaveBeenCalledOnce();
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
  });

  it("signs out only the local session", async () => {
    const fake = fakeClient();
    const port = createSupabaseAuthPort(fake.client);

    await expect(port.signOut()).resolves.toBeUndefined();
    expect(fake.signOut).toHaveBeenCalledOnce();
    expect(fake.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("propagates sign-out errors", async () => {
    const signOutError = new AuthError("local sign-out failed");
    const fake = fakeClient({ signOutError });
    const port = createSupabaseAuthPort(fake.client);

    await expect(port.signOut()).rejects.toBe(signOutError);
  });
});
