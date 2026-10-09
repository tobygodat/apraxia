import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionVerificationError, verifySupabaseSession } from "../../server/auth/verifySession";

const USER_ID = "67f97850-d9e2-4623-9c4e-e26c6ce14aa1";
const SPOOF_ID = "11111111-1111-4111-8111-111111111111";
const PRIVATE = "private-body-token-and-email@example.test";
const TOKEN = "not.decoded.credential";
const CONFIG = {
  SUPABASE_URL: "https://example.supabase.co/",
  SUPABASE_ANON_KEY: "sb_publishable_public-test",
};
const MAX_BYTES = 64 * 1024;

function request(
  authorization: string | null = `Bearer ${TOKEN}`,
  extra: RequestInit = {},
): Request {
  const headers = new Headers(extra.headers);
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request(`https://app.example.test/api/calendar?user_id=${SPOOF_ID}`, {
    ...extra,
    headers,
  });
}

function user(extra: Record<string, unknown> = {}) {
  return { id: USER_ID, role: "authenticated", is_anonymous: false, ...extra };
}

function json(value: unknown = user(), init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function transport(implementation: typeof fetch = async () => json()) {
  return vi.fn<typeof fetch>(implementation);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function stream(chunks: Uint8Array[], cancel = vi.fn()) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    cancel,
  });
}

const encode = (text: string) => new TextEncoder().encode(text);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("server session provider authority", () => {
  it("makes one fixed provider GET and returns only its confirmed identity", async () => {
    const fetch = transport(async () =>
      json(
        user({
          email: PRIVATE,
          app_metadata: { user_id: SPOOF_ID },
          user_metadata: { user_id: SPOOF_ID },
          access_token: PRIVATE,
          refresh_token: PRIVATE,
          deleted_at: null,
        }),
      ),
    );
    const incoming = request(undefined, {
      method: "POST",
      body: JSON.stringify({ user_id: SPOOF_ID, token: PRIVATE }),
      headers: { Cookie: `user_id=${SPOOF_ID}; access_token=${PRIVATE}`, "X-User-ID": SPOOF_ID },
    });
    const result = await verifySupabaseSession(incoming, CONFIG, { fetch });
    expect(result).toEqual({ userId: USER_ID });
    expect(Object.keys(result)).toEqual(["userId"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private|email|token|metadata/);
    expect(incoming.bodyUsed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://example.supabase.co/auth/v1/user");
    expect(init).toEqual({
      method: "GET",
      headers: {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
      },
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      signal: expect.any(AbortSignal),
    });
    expect(JSON.stringify(init)).not.toContain(SPOOF_ID);
  });

  it.each(["Bearer", "bearer", "BEARER"])(
    "accepts the HTTP case-insensitive %s scheme",
    async (scheme) => {
      const fetch = transport();
      await expect(
        verifySupabaseSession(request(`${scheme} ${TOKEN}`), CONFIG, { fetch }),
      ).resolves.toEqual({ userId: USER_ID });
    },
  );

  it("does not decode a spoofed JWT subject or role to grant authority", async () => {
    const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: SPOOF_ID, role: "service_role" })).toString("base64url")}.unsigned`;
    const fetch = transport();
    await expect(
      verifySupabaseSession(request(`Bearer ${token}`), CONFIG, { fetch }),
    ).resolves.toEqual({ userId: USER_ID });
    expect(new Headers(fetch.mock.calls[0]![1]!.headers).get("authorization")).toBe(
      `Bearer ${token}`,
    );
  });

  it("uses global fetch by default without requiring a Supabase service key", async () => {
    const fetch = transport();
    vi.stubGlobal("fetch", fetch);
    await expect(verifySupabaseSession(request(), CONFIG)).resolves.toEqual({ userId: USER_ID });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("supports only explicitly configured loopback HTTP development", async () => {
    const fetch = transport();
    await verifySupabaseSession(
      request(),
      { ...CONFIG, SUPABASE_URL: "http://127.0.0.1:54321/" },
      { fetch },
    );
    expect(fetch.mock.calls[0]![0]).toBe("http://127.0.0.1:54321/auth/v1/user");
  });

  it("normalizes a provider-confirmed UUID to the shared lowercase identity", async () => {
    await expect(
      verifySupabaseSession(request(), CONFIG, {
        fetch: transport(async () => json(user({ id: USER_ID.toUpperCase() }))),
      }),
    ).resolves.toEqual({ userId: USER_ID });
  });
});

describe("server session input rejection", () => {
  it.each([
    null,
    "",
    "Bearer",
    "Basic abc",
    "Bearer ",
    "Bearer two tokens",
    "Bearer  token",
    "Bearer\ttoken",
    "Bearer token, Bearer token2",
    "Bearer token,token2",
    "Bearer token;",
    "Bearer token=tail",
    'Bearer "token"',
    "Bearer private:token",
    "Bearer " + "x".repeat(16 * 1024),
  ])("rejects malformed or missing bearer credentials before fetching (%#)", async (credential) => {
    const fetch = transport();
    await expect(
      verifySupabaseSession(request(credential), CONFIG, { fetch }),
    ).rejects.toMatchObject({ code: "unauthenticated", message: "Sign in to continue." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects duplicate Authorization headers combined by the Fetch API", async () => {
    const headers = new Headers();
    headers.append("Authorization", `Bearer ${TOKEN}`);
    headers.append("authorization", "Bearer second-token");
    const incoming = request(null, { headers });
    expect(incoming.headers.get("authorization")).toContain(",");
    const fetch = transport();
    await expect(verifySupabaseSession(incoming, CONFIG, { fetch })).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not accept cookie or query credentials without a bearer header", async () => {
    const fetch = transport();
    const incoming = new Request(
      `https://app.example.test/api?access_token=${TOKEN}&user_id=${SPOOF_ID}`,
      {
        headers: { Cookie: `access_token=${TOKEN}; user_id=${SPOOF_ID}` },
      },
    );
    await expect(verifySupabaseSession(incoming, CONFIG, { fetch })).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "http://remote.example.test",
    "https://example.supabase.co/auth/v1/user",
    "https://user:private@example.test",
    "https://example.supabase.co?redirect=private",
    "https://example.supabase.co/#private",
    "not-a-url",
  ])("rejects an unsafe configured origin (%s)", async (SUPABASE_URL) => {
    const fetch = transport();
    await expect(
      verifySupabaseSession(request(), { ...CONFIG, SUPABASE_URL }, { fetch }),
    ).rejects.toMatchObject({ code: "auth_unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "sb_secret_private",
    "",
    "private key",
    "public\nprivate",
    `header.${Buffer.from('{"role":"service_role"}').toString("base64url")}.signature`,
    `header.${Buffer.from('{"role":"authenticated"}').toString("base64url")}.signature`,
  ])("never sends an invalid or privileged configured API key (%#)", async (SUPABASE_ANON_KEY) => {
    const fetch = transport();
    await expect(
      verifySupabaseSession(request(), { ...CONFIG, SUPABASE_ANON_KEY }, { fetch }),
    ).rejects.toMatchObject({ code: "auth_unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([0, -1, 0.5, 5_001, NaN, Infinity])(
    "rejects an invalid deadline override (%s)",
    async (timeoutMs) => {
      const fetch = transport();
      await expect(
        verifySupabaseSession(request(), CONFIG, { fetch, timeoutMs }),
      ).rejects.toMatchObject({ code: "auth_unavailable" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe("server session response validation", () => {
  it.each([401, 403])(
    "maps provider status %s to unauthenticated without reading its body",
    async (status) => {
      const cancel = vi.fn();
      const body = stream([], cancel);
      const fetch = transport(async () => new Response(body, { status }));
      await expect(verifySupabaseSession(request(), CONFIG, { fetch })).rejects.toMatchObject({
        code: "unauthenticated",
      });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each([201, 204, 301, 302, 307, 400, 404, 429, 500, 503])(
    "maps unexpected status %s to unavailable",
    async (status) => {
      const fetch = transport(async () => new Response(null, { status }));
      await expect(verifySupabaseSession(request(), CONFIG, { fetch })).rejects.toMatchObject({
        code: "auth_unavailable",
      });
    },
  );

  it.each([
    { redirected: true },
    { url: "https://different.example.test/auth/v1/user" },
    { url: "https://example.supabase.co/auth/v1/user?private=1" },
  ])("rejects an unexpected response destination (%j)", async (properties) => {
    const response = json();
    for (const [key, value] of Object.entries(properties))
      Object.defineProperty(response, key, { value });
    await expect(
      verifySupabaseSession(request(), CONFIG, { fetch: transport(async () => response) }),
    ).rejects.toMatchObject({ code: "auth_unavailable" });
  });

  it.each([
    null,
    [],
    {},
    "private",
    { user: user() },
    user({ id: null }),
    user({ id: SPOOF_ID + "extra" }),
    user({ id: "00000000-0000-0000-0000-000000000000" }),
    user({ id: " not-a-uuid " }),
    user({ role: undefined }),
    user({ role: null }),
    user({ is_anonymous: undefined }),
    user({ is_anonymous: null }),
    user({ is_anonymous: "false" }),
    user({ is_anonymous: 0 }),
  ])("rejects malformed identity projections (%#)", async (body) => {
    await expect(
      verifySupabaseSession(request(), CONFIG, { fetch: transport(async () => json(body)) }),
    ).rejects.toMatchObject({ code: "auth_unavailable" });
  });

  it.each([
    user({ role: "service_role" }),
    user({ role: "anon" }),
    user({ role: "" }),
    user({ is_anonymous: true }),
    user({ deleted_at: "2026-09-01T00:00:00Z" }),
  ])("denies anonymous, deleted, or non-application users (%#)", async (body) => {
    await expect(
      verifySupabaseSession(request(), CONFIG, { fetch: transport(async () => json(body)) }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it.each([null, "text/html", "application/json; charset=latin1", "application/octet-stream"])(
    "rejects missing or non-UTF8 JSON content type (%s)",
    async (contentType) => {
      const headers = new Headers();
      if (contentType !== null) headers.set("content-type", contentType);
      const fetch = transport(
        async () => new Response(encode(JSON.stringify(user())), { headers }),
      );
      await expect(verifySupabaseSession(request(), CONFIG, { fetch })).rejects.toMatchObject({
        code: "auth_unavailable",
      });
    },
  );

  it.each([
    "application/json",
    "application/json; charset=utf-8",
    'Application/JSON; charset="UTF-8"',
  ])("accepts explicit UTF8 JSON content type (%s)", async (contentType) => {
    const fetch = transport(
      async () =>
        new Response(JSON.stringify(user()), { headers: { "content-type": contentType } }),
    );
    await expect(verifySupabaseSession(request(), CONFIG, { fetch })).resolves.toEqual({
      userId: USER_ID,
    });
  });

  it("rejects invalid JSON and does not expose parser input", async () => {
    const fetch = transport(
      async () =>
        new Response(`{"id":"${PRIVATE}`, { headers: { "content-type": "application/json" } }),
    );
    const result = verifySupabaseSession(request(), CONFIG, { fetch });
    await expect(result).rejects.toMatchObject({ code: "auth_unavailable" });
    await expect(result).rejects.not.toThrow(PRIVATE);
  });

  it("uses fatal UTF8 decoding rather than substituting invalid bytes", async () => {
    const bytes = new Uint8Array([
      ...encode(JSON.stringify(user()).slice(0, -1) + ',"unused":"'),
      0xc3,
      0x28,
      ...encode('"}'),
    ]);
    const fetch = transport(
      async () => new Response(bytes, { headers: { "content-type": "application/json" } }),
    );
    await expect(verifySupabaseSession(request(), CONFIG, { fetch })).rejects.toMatchObject({
      code: "auth_unavailable",
    });
  });

  it("decodes UTF8 characters split across stream chunks", async () => {
    const bytes = encode(JSON.stringify(user({ email: "café@example.test" })));
    const split = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const fetch = transport(
      async () => new Response(body, { headers: { "content-type": "application/json" } }),
    );
    await expect(verifySupabaseSession(request(), CONFIG, { fetch })).resolves.toEqual({
      userId: USER_ID,
    });
  });

  it("accepts exactly 64KiB and rejects a larger body despite a misleading Content-Length", async () => {
    const base = JSON.stringify(user({ padding: "" }));
    const exact = JSON.stringify(user({ padding: "x".repeat(MAX_BYTES - encode(base).length) }));
    expect(encode(exact).length).toBe(MAX_BYTES);
    const fetch = transport(
      async () => new Response(exact, { headers: { "content-type": "application/json" } }),
    );
    await expect(verifySupabaseSession(request(), CONFIG, { fetch })).resolves.toEqual({
      userId: USER_ID,
    });
    const cancel = vi.fn();
    const body = stream([encode(exact), encode(" ")], cancel);
    await expect(
      verifySupabaseSession(request(), CONFIG, {
        fetch: transport(
          async () =>
            new Response(body, {
              headers: { "content-type": "application/json", "content-length": "1" },
            }),
        ),
      }),
    ).rejects.toMatchObject({ code: "auth_unavailable" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["65537", "-1", "1.5", "1, 1", "private"])(
    "rejects oversized or malformed Content-Length (%s)",
    async (length) => {
      const cancel = vi.fn();
      const body = stream([], cancel);
      const fetch = transport(
        async () =>
          new Response(body, {
            headers: { "content-type": "application/json", "content-length": length },
          }),
      );
      await expect(verifySupabaseSession(request(), CONFIG, { fetch })).rejects.toMatchObject({
        code: "auth_unavailable",
      });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
});

describe("server session lifetime and redaction", () => {
  it("rejects already-aborted requests without calling the provider", async () => {
    const abort = new AbortController();
    abort.abort(PRIVATE);
    const fetch = transport();
    const result = verifySupabaseSession(request(undefined, { signal: abort.signal }), CONFIG, {
      fetch,
    });
    await expect(result).rejects.toMatchObject({
      name: "AbortError",
      message: "Session verification cancelled.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("honors abort before the transport microtask starts", async () => {
    const abort = new AbortController();
    const fetch = transport();
    const result = verifySupabaseSession(request(undefined, { signal: abort.signal }), CONFIG, {
      fetch,
    });
    abort.abort(PRIVATE);
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ends an ignoring fetch promptly and cancels a late response body", async () => {
    const abort = new AbortController();
    const pending = deferred<Response>();
    const fetch = transport(async () => pending.promise);
    const result = verifySupabaseSession(request(undefined, { signal: abort.signal }), CONFIG, {
      fetch,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    abort.abort(PRIVATE);
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    const cancel = vi.fn();
    pending.resolve(
      new Response(stream([], cancel), { headers: { "content-type": "application/json" } }),
    );
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  it("observes a fetch rejection arriving after caller cancellation", async () => {
    const abort = new AbortController();
    const pending = deferred<Response>();
    const fetch = transport(async () => pending.promise);
    const result = verifySupabaseSession(request(undefined, { signal: abort.signal }), CONFIG, {
      fetch,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    abort.abort(PRIVATE);
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    pending.reject(new Error(PRIVATE));
    await Promise.resolve();
    await Promise.resolve();
  });

  it.each(["timeout", "caller"])(
    "bounds a stalled response stream and ignores hanging cleanup (%s)",
    async (reason) => {
      vi.useFakeTimers();
      const abort = new AbortController();
      const cancel = vi.fn(() => new Promise<void>(() => undefined));
      const body = stream([encode('{"id":"')], cancel);
      const response = new Response(body, { headers: { "content-type": "application/json" } });
      const fetch = transport(async () => response);
      const result = verifySupabaseSession(request(undefined, { signal: abort.signal }), CONFIG, {
        fetch,
        timeoutMs: 100,
      });
      const outcome = result.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      if (reason === "timeout") await vi.advanceTimersByTimeAsync(100);
      else abort.abort(PRIVATE);
      expect(await outcome).toMatchObject(
        reason === "timeout" ? { code: "auth_unavailable" } : { name: "AbortError" },
      );
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body!.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("enforces the default five-second fetch deadline and clears its timer", async () => {
    vi.useFakeTimers();
    const fetch = transport(async () => new Promise<Response>(() => undefined));
    const result = verifySupabaseSession(request(), CONFIG, { fetch });
    let finished = false;
    const outcome = result.catch((error: unknown) => {
      finished = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ code: "auth_unavailable" });
    expect(fetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears timer and caller listener after success", async () => {
    vi.useFakeTimers();
    const incoming = request();
    const remove = vi.spyOn(incoming.signal, "removeEventListener");
    await expect(verifySupabaseSession(incoming, CONFIG, { fetch: transport() })).resolves.toEqual({
      userId: USER_ID,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it.each([
    new Error(PRIVATE),
    new DOMException(PRIVATE, "AbortError"),
    new SessionVerificationError("unauthenticated"),
  ])(
    "sanitizes unexpected provider failures without treating them as caller cancellation (%#)",
    async (upstream) => {
      if (upstream instanceof SessionVerificationError) upstream.message = PRIVATE;
      const fetch = transport(async () => {
        throw upstream;
      });
      const result = verifySupabaseSession(request(), CONFIG, { fetch });
      await expect(result).rejects.toMatchObject({
        name: "SessionVerificationError",
        code: "auth_unavailable",
        message: "Sign-in verification is temporarily unavailable.",
      });
      await expect(result).rejects.not.toHaveProperty("cause");
      await expect(result).rejects.not.toThrow(PRIVATE);
    },
  );

  it("sanitizes synchronous transport throws", async () => {
    const fetch = transport(() => {
      throw new Error(PRIVATE);
    });
    await expect(verifySupabaseSession(request(), CONFIG, { fetch })).rejects.toMatchObject({
      code: "auth_unavailable",
    });
  });

  it("sanitizes a response stream error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(PRIVATE));
      },
    });
    const fetch = transport(
      async () => new Response(body, { headers: { "content-type": "application/json" } }),
    );
    const result = verifySupabaseSession(request(), CONFIG, { fetch });
    await expect(result).rejects.toMatchObject({ code: "auth_unavailable" });
    await expect(result).rejects.not.toThrow(PRIVATE);
  });
});
