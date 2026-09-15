// @vitest-environment happy-dom

import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter } from "react-router-dom";

import { ConfiguredCloudApp } from "./CloudApp";
import { GOOGLE_SIGN_IN_ERROR, type GoogleSignInPort } from "../auth/googleSignIn";

function session(): Session {
  return {
    access_token: "supabase-access-token",
    refresh_token: "supabase-refresh-token",
    expires_in: 3_600,
    expires_at: 1_800_000_000,
    token_type: "bearer",
    user: {
      id: "user-a",
      email: "a@example.com",
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2026-09-02T12:00:00.000Z",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

afterEach(cleanup);

function signedOutClient() {
  let listener: ((event: AuthChangeEvent, value: Session | null) => void) | undefined;
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn((callback: typeof listener) => {
        listener = callback;
        return {
          data: {
            subscription: { id: "sign-in-test", callback, unsubscribe: vi.fn() },
          },
        };
      }),
      signOut: vi.fn(async () => ({ error: null })),
    },
  } as unknown as SupabaseClient;
  return {
    client,
    emit(event: AuthChangeEvent, value: Session | null) {
      if (!listener) throw new Error("Subscribe before emitting.");
      listener(event, value);
    },
  };
}

describe("CloudApp Google sign-in", () => {
  it("offers explicit sign-in while keeping Calendar separate and records closed", async () => {
    const fake = signedOutClient();
    const start = vi.fn<GoogleSignInPort["start"]>(async () => {});
    render(
      <BrowserRouter>
        <ConfiguredCloudApp client={fake.client} googleSignInPort={{ start }} />
      </BrowserRouter>,
    );
    const button = await screen.findByRole("button", { name: "Continue with Google" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText(/Calendar access is separate/).textContent).toContain(
      "No personal records are loaded while signed out.",
    );
    expect(start).not.toHaveBeenCalled();
    expect(screen.queryByText("Your secure session is ready")).toBeNull();
  });

  it("announces progress and prevents repeated submissions until navigation", async () => {
    const fake = signedOutClient();
    const result = deferred<void>();
    const start = vi.fn<GoogleSignInPort["start"]>(() => result.promise);
    render(
      <BrowserRouter>
        <ConfiguredCloudApp client={fake.client} googleSignInPort={{ start }} />
      </BrowserRouter>,
    );
    const button = await screen.findByRole("button", { name: "Continue with Google" });
    act(() => {
      for (let index = 0; index < 10; index += 1) fireEvent.click(button);
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-describedby")).toBe("sign-in-progress");
    expect(screen.getByRole("status").textContent).toBe("Opening Google to sign in securely.");
    await act(async () => {
      result.resolve();
      await result.promise;
    });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("shows a sanitized recoverable failure and allows another attempt", async () => {
    const fake = signedOutClient();
    const start = vi
      .fn<GoogleSignInPort["start"]>()
      .mockRejectedValueOnce(new Error("secret-provider-token personal@example.com"))
      .mockResolvedValue(undefined);
    render(
      <BrowserRouter>
        <ConfiguredCloudApp client={fake.client} googleSignInPort={{ start }} />
      </BrowserRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
    expect((await screen.findByRole("alert")).textContent).toBe(GOOGLE_SIGN_IN_ERROR);
    expect(document.body.textContent).not.toContain("secret-provider-token");
    expect(document.body.textContent).not.toContain("personal@example.com");
    const retry = screen.getByRole("button", { name: "Continue with Google" });
    expect(retry.hasAttribute("disabled")).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Opening Google…" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("aborts an unfinished attempt when the app unmounts", async () => {
    const fake = signedOutClient();
    const result = deferred<void>();
    const start = vi.fn<GoogleSignInPort["start"]>(() => result.promise);
    const view = render(
      <BrowserRouter>
        <ConfiguredCloudApp client={fake.client} googleSignInPort={{ start }} />
      </BrowserRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
    const signal = start.mock.calls[0][0];
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      result.resolve();
      await result.promise;
    });
  });

  it("allows retry after returning from Google through the browser page cache", async () => {
    const fake = signedOutClient();
    const start = vi.fn<GoogleSignInPort["start"]>(async () => {});
    render(
      <BrowserRouter>
        <ConfiguredCloudApp client={fake.client} googleSignInPort={{ start }} />
      </BrowserRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
    const previousSignal = start.mock.calls[0][0];
    const pageShow = new Event("pageshow");
    Object.defineProperty(pageShow, "persisted", { value: true });
    fireEvent(window, pageShow);
    const retry = await screen.findByRole("button", { name: "Continue with Google" });
    expect(previousSignal.aborted).toBe(true);
    expect(retry.hasAttribute("disabled")).toBe(false);
    fireEvent.click(retry);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  });

  it("aborts the old request when the sign-in port changes", async () => {
    const fake = signedOutClient();
    const oldResult = deferred<void>();
    const oldPort = { start: vi.fn<GoogleSignInPort["start"]>(() => oldResult.promise) };
    const nextPort = { start: vi.fn<GoogleSignInPort["start"]>(async () => {}) };
    const view = render(
      <BrowserRouter>
        <ConfiguredCloudApp client={fake.client} googleSignInPort={oldPort} />
      </BrowserRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
    view.rerender(
      <BrowserRouter>
        <ConfiguredCloudApp client={fake.client} googleSignInPort={nextPort} />
      </BrowserRouter>,
    );
    expect(oldPort.start.mock.calls[0][0].aborted).toBe(true);
    const button = await screen.findByRole("button", { name: "Continue with Google" });
    expect(button.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      oldResult.resolve();
      await oldResult.promise;
    });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(nextPort.start).toHaveBeenCalledTimes(1));
  });

  it("aborts when a session arrives and ignores a late rejected sign-in response", async () => {
    const fake = signedOutClient();
    let reject!: (error: Error) => void;
    const result = new Promise<void>((_resolve, nextReject) => {
      reject = nextReject;
    });
    const start = vi.fn<GoogleSignInPort["start"]>(() => result);
    render(
      <BrowserRouter>
        <ConfiguredCloudApp client={fake.client} googleSignInPort={{ start }} />
      </BrowserRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));
    act(() => fake.emit("SIGNED_IN", session()));
    expect(await screen.findByRole("navigation", { name: "Primary navigation" })).toBeTruthy();
    expect(start.mock.calls[0][0].aborted).toBe(true);
    await act(async () => {
      reject(new Error("private late error"));
      await result.catch(() => {});
    });
    expect(screen.queryByText(GOOGLE_SIGN_IN_ERROR)).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
    expect(document.body.textContent).not.toContain("private late error");
  });
});

describe("CloudApp sign-out accessibility", () => {
  it("announces pending sign-out and marks the workspace busy", async () => {
    const signOutResult = deferred<{ error: null }>();
    const client = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: session() },
          error: null,
        })),
        onAuthStateChange: vi.fn(() => ({
          data: {
            subscription: {
              id: "cloud-app-test",
              callback: vi.fn(),
              unsubscribe: vi.fn(),
            },
          },
        })),
        signOut: vi.fn(() => signOutResult.promise),
      },
    } as unknown as SupabaseClient;

    render(
      <BrowserRouter>
        <ConfiguredCloudApp client={client} />
      </BrowserRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "account" }));
    const signOutButton = await screen.findByRole("button", { name: "sign out" });
    fireEvent.click(signOutButton);

    const panel = screen
      .getByRole("navigation", { name: "Primary navigation" })
      .closest(".cloud-shell");
    expect(panel?.getAttribute("aria-busy")).toBe("true");
    expect(signOutButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "Signing out and closing this private workspace.",
    );

    await act(async () => {
      signOutResult.resolve({ error: null });
      await signOutResult.promise;
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "You’re signed out" })).toBeTruthy();
    });
  });
});
