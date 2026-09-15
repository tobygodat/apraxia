import { AuthError, createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createGoogleSignInPort,
  GOOGLE_SIGN_IN_ERROR,
  type GoogleSignInEnvironment,
} from "./googleSignIn";
import { createProviderSafeStorage } from "./providerSafeStorage";
import { ServiceError } from "../lib/serviceError";

type OAuthResult = Awaited<ReturnType<SupabaseClient["auth"]["signInWithOAuth"]>>;
const authorizationUrl =
  "https://project.supabase.co/auth/v1/authorize?provider=google&code_challenge=challenge&code_challenge_method=s256";

function fixture() {
  const signInWithOAuth = vi.fn<SupabaseClient["auth"]["signInWithOAuth"]>(async () => ({
    data: { provider: "google", url: authorizationUrl },
    error: null,
  }));
  const environment: GoogleSignInEnvironment = {
    applicationOrigin: vi.fn(() => "https://orbit.example"),
    supabaseOrigin: vi.fn(() => "https://project.supabase.co"),
    navigate: vi.fn(),
  };
  const port = createGoogleSignInPort({ auth: { signInWithOAuth } }, environment);
  return { port, signInWithOAuth, environment, controller: new AbortController() };
}

describe("Google application sign-in", () => {
  it("requests only identity scopes with a fixed same-origin root return", async () => {
    const fake = fixture();
    await expect(fake.port.start(fake.controller.signal)).resolves.toBeUndefined();
    expect(fake.signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: "google",
      options: {
        redirectTo: "https://orbit.example/",
        scopes: "openid email profile",
        skipBrowserRedirect: true,
      },
    });
    expect(fake.environment.navigate).toHaveBeenCalledExactlyOnceWith(authorizationUrl);
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "supports the exact loopback development origin %s",
    async (origin) => {
      const fake = fixture();
      vi.mocked(fake.environment.applicationOrigin).mockReturnValue(origin);
      await fake.port.start(fake.controller.signal);
      expect(fake.signInWithOAuth.mock.calls[0][0].options?.redirectTo).toBe(`${origin}/`);
    },
  );

  it.each([
    "http://orbit.example",
    "javascript:alert(1)",
    "https://user:password@orbit.example",
    "https://orbit.example/todos",
    "https://orbit.example?redirect=https://evil.example&user_id=victim",
    "https://orbit.example/#token=secret",
    "null",
  ])("rejects an invalid application origin without starting OAuth: %s", async (origin) => {
    const fake = fixture();
    vi.mocked(fake.environment.applicationOrigin).mockReturnValue(origin);
    await expect(fake.port.start(fake.controller.signal)).rejects.toThrow(GOOGLE_SIGN_IN_ERROR);
    expect(fake.signInWithOAuth).not.toHaveBeenCalled();
    expect(fake.environment.navigate).not.toHaveBeenCalled();
  });

  it.each([
    "https://evil.example/auth/v1/authorize",
    "https://project.supabase.co.evil.example/auth/v1/authorize",
    "http://project.supabase.co/auth/v1/authorize",
    "https://project.supabase.co/auth/v1/callback",
    "https://project.supabase.co/auth/v1/authorize/",
    "https://user:password@project.supabase.co/auth/v1/authorize",
    "https://project.supabase.co/auth/v1/authorize#secret",
    "javascript:alert(1)",
    "/auth/v1/authorize",
    "not-a-url",
    "",
  ])("rejects unexpected navigation targets: %s", async (url) => {
    const fake = fixture();
    fake.signInWithOAuth.mockResolvedValue({ data: { provider: "google", url }, error: null });
    await expect(fake.port.start(fake.controller.signal)).rejects.toThrow(GOOGLE_SIGN_IN_ERROR);
    expect(fake.environment.navigate).not.toHaveBeenCalled();
  });

  it("sanitizes returned SDK errors and does not keep their cause", async () => {
    const fake = fixture();
    fake.signInWithOAuth.mockResolvedValue({
      data: { provider: "google", url: null },
      error: new AuthError("private-provider-token https://secret.example"),
    });
    const error = await fake.port.start(fake.controller.signal).catch((caught: unknown) => caught);
    expect(error).toEqual(new ServiceError("unavailable", GOOGLE_SIGN_IN_ERROR));
    expect(error).not.toHaveProperty("cause");
    expect(fake.environment.navigate).not.toHaveBeenCalled();
  });

  it("sanitizes thrown storage, SDK, and navigation errors", async () => {
    const fake = fixture();
    fake.signInWithOAuth.mockRejectedValueOnce(new Error("secret storage content"));
    await expect(fake.port.start(fake.controller.signal)).rejects.toThrow(GOOGLE_SIGN_IN_ERROR);
    vi.mocked(fake.environment.navigate).mockImplementationOnce(() => {
      throw new Error("secret navigation content");
    });
    await expect(fake.port.start(fake.controller.signal)).rejects.toThrow(GOOGLE_SIGN_IN_ERROR);
  });

  it("does not start an already cancelled attempt", async () => {
    const fake = fixture();
    fake.controller.abort();
    await fake.port.start(fake.controller.signal);
    expect(fake.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("does not navigate when cancelled while the SDK prepares its response", async () => {
    const fake = fixture();
    let resolve!: (result: OAuthResult) => void;
    fake.signInWithOAuth.mockReturnValue(
      new Promise((next) => {
        resolve = next;
      }),
    );
    const pending = fake.port.start(fake.controller.signal);
    fake.controller.abort();
    resolve({ data: { provider: "google", url: authorizationUrl }, error: null });
    await expect(pending).resolves.toBeUndefined();
    expect(fake.environment.navigate).not.toHaveBeenCalled();
  });

  it("ignores a late rejected SDK response after cancellation", async () => {
    const fake = fixture();
    let reject!: (reason: unknown) => void;
    fake.signInWithOAuth.mockReturnValue(
      new Promise((_resolve, next) => {
        reject = next;
      }),
    );
    const pending = fake.port.start(fake.controller.signal);
    fake.controller.abort();
    reject(new Error("private late response"));
    await expect(pending).resolves.toBeUndefined();
    expect(fake.environment.navigate).not.toHaveBeenCalled();
  });

  it("times out preparation safely and never navigates on a late response", async () => {
    vi.useFakeTimers();
    try {
      const fake = fixture();
      let resolve!: (result: OAuthResult) => void;
      fake.signInWithOAuth.mockReturnValueOnce(
        new Promise((next) => {
          resolve = next;
        }),
      );
      const pending = fake.port.start(fake.controller.signal).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await pending).toEqual(new ServiceError("unavailable", GOOGLE_SIGN_IN_ERROR));
      resolve({ data: { provider: "google", url: authorizationUrl }, error: null });
      await Promise.resolve();
      expect(fake.environment.navigate).not.toHaveBeenCalled();
      await fake.port.start(new AbortController().signal);
      expect(fake.environment.navigate).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles cancellation without waiting for a hung SDK response", async () => {
    const fake = fixture();
    fake.signInWithOAuth.mockReturnValue(new Promise(() => {}));
    const pending = fake.port.start(fake.controller.signal);
    fake.controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(fake.environment.navigate).not.toHaveBeenCalled();
  });

  it("preserves the installed SDK's PKCE URL without contacting an account", async () => {
    const fake = fixture();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createClient("https://project.supabase.co", "public-test-key", {
      auth: {
        flowType: "pkce",
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: { fetch },
    });
    try {
      await createGoogleSignInPort(client, fake.environment).start(fake.controller.signal);
      const target = new URL(vi.mocked(fake.environment.navigate).mock.calls[0][0]);
      expect(target.origin).toBe("https://project.supabase.co");
      expect(target.pathname).toBe("/auth/v1/authorize");
      expect(target.searchParams.get("redirect_to")).toBe("https://orbit.example/");
      expect(target.searchParams.get("scopes")).toBe("openid email profile");
      expect(target.searchParams.get("code_challenge")).toBeTruthy();
      expect(target.searchParams.get("code_challenge_method")).toBe("s256");
      expect(target.searchParams.has("access_type")).toBe(false);
      expect(target.searchParams.has("skip_http_redirect")).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await client.auth.dispose();
    }
  });

  it("keeps the retry verifier when an older real-SDK digest finishes after timeout", async () => {
    vi.useFakeTimers();
    const stored = new Map<string, string>();
    const writes = vi.fn((key: string, value: string) => {
      stored.set(key, value);
    });
    const storage = createProviderSafeStorage({
      getItem: (key) => stored.get(key) ?? null,
      setItem: writes,
      removeItem: (key) => {
        stored.delete(key);
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = createClient("https://project.supabase.co", "public-test-key", {
      auth: {
        flowType: "pkce",
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
        storageKey: "pkce-order-test",
        storage,
      },
      global: { fetch },
    });
    const sdkSignIn = vi.spyOn(client.auth, "signInWithOAuth");
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    let releaseFirstDigest!: () => void;
    let reachedFirstDigest!: () => void;
    const firstDigestGate = new Promise<void>((resolve) => {
      releaseFirstDigest = resolve;
    });
    const firstDigestReached = new Promise<void>((resolve) => {
      reachedFirstDigest = resolve;
    });
    let first = true;
    const digestSpy = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockImplementation((algorithm, data) => {
        if (!first) return digest(algorithm, data);
        first = false;
        reachedFirstDigest();
        return firstDigestGate.then(() => digest(algorithm, data));
      });

    try {
      const fake = fixture();
      const port = createGoogleSignInPort(client, fake.environment);
      const olderAttempt = port.start(fake.controller.signal).catch((error: unknown) => error);
      await firstDigestReached;
      // The installed SDK writes all verifier keys before awaiting the digest.
      // With native synchronous storage, timer callbacks cannot interrupt those
      // storage microtasks and delay a verifier write until after the retry.
      const firstVerifier = stored.get("pkce-order-test-code-verifier");
      expect(firstVerifier).toBeTruthy();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await olderAttempt).toEqual(new ServiceError("unavailable", GOOGLE_SIGN_IN_ERROR));

      await port.start(new AbortController().signal);
      const retryVerifier = stored.get("pkce-order-test-code-verifier");
      expect(retryVerifier).toBeTruthy();
      expect(retryVerifier).not.toBe(firstVerifier);
      const writesAfterRetry = writes.mock.calls.length;
      const retryUrl = new URL(vi.mocked(fake.environment.navigate).mock.calls[0][0]);
      const verifier: string = JSON.parse(retryVerifier!);
      const hashed = await digest("SHA-256", new TextEncoder().encode(verifier));
      const expectedChallenge = btoa(String.fromCharCode(...new Uint8Array(hashed)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      expect(retryUrl.searchParams.get("code_challenge")).toBe(expectedChallenge);

      releaseFirstDigest();
      await sdkSignIn.mock.results[0].value;
      expect(stored.get("pkce-order-test-code-verifier")).toBe(retryVerifier);
      expect(writes).toHaveBeenCalledTimes(writesAfterRetry);
      expect(fake.environment.navigate).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      releaseFirstDigest();
      digestSpy.mockRestore();
      await client.auth.dispose();
      vi.useRealTimers();
    }
  });
});
