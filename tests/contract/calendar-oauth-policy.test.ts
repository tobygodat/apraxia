import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_OAUTH_TTL_MS,
  CALENDAR_READ_SCOPES,
  CalendarOAuthPolicyError,
  assertCalendarMutationRequest,
  createCalendarOAuthAttempt,
  createCalendarOAuthConsumeCommand,
  getCalendarOAuthRedirectUri,
  parseCalendarOAuthCallback,
  validateGrantedCalendarScopes,
  type CalendarOAuthCallback,
} from "../../server/calendar/oauthPolicy";

type Session = Parameters<typeof createCalendarOAuthAttempt>[0];
const APP_URL = "https://app.example.test";
const REDIRECT_URI = `${APP_URL}/api/calendar/callback`;
const USER_ID = "abcdef12-3456-4789-8abc-def123456789";
const OTHER_USER_ID = "12345678-1234-4234-8234-123456789abc";
const SESSION = { userId: USER_ID } as Session;
const CONFIG = { appUrl: APP_URL, clientId: "example-client.apps.googleusercontent.com" };
const NOW = new Date("2026-09-07T09:30:00.123Z");
const STATE = Buffer.alloc(32, 7).toString("base64url");
const CODE = "4/legitimate.Google-code_123";
const SECRET = "private-provider-code-or-token";
const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

function callback(params: Record<string, string> = { state: STATE, code: CODE }, base = REDIRECT_URI) {
  return `${base}?${new URLSearchParams(params)}`;
}

function request({
  url = `${APP_URL}/api/calendar/connect`, method = "POST",
  headers = {},
}: { url?: string; method?: string; headers?: Record<string, string | null | undefined> } = {}) {
  const values = new Headers({
    Origin: APP_URL, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin",
  });
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (value === null) values.delete(name);
    else values.set(name, value);
  }
  return new Request(url, { method, headers: values });
}

function hash(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function expectPolicyError(action: () => unknown) {
  let failure: unknown;
  try { action(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(CalendarOAuthPolicyError);
  expect((failure as Error).message).toBe(new CalendarOAuthPolicyError().message);
  expect(String(failure)).not.toContain(SECRET);
  return failure;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Calendar OAuth redirect origin", () => {
  it.each([
    [APP_URL, REDIRECT_URI],
    [`${APP_URL}/`, REDIRECT_URI],
    ["https://APP.EXAMPLE.TEST:443/", REDIRECT_URI],
    ["https://preview.example.test:8443", "https://preview.example.test:8443/api/calendar/callback"],
    ["http://localhost:3000/", "http://localhost:3000/api/calendar/callback"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000/api/calendar/callback"],
    ["http://[::1]:3000", "http://[::1]:3000/api/calendar/callback"],
  ])("builds the callback from the canonical configured origin: %s", (appUrl, expected) => {
    expect(getCalendarOAuthRedirectUri(appUrl)).toBe(expected);
  });

  it.each([
    undefined, null, 42, {}, "", " ", "http://app.example.test", "ftp://app.example.test",
    `https://${SECRET}@app.example.test`, `${APP_URL}/api/calendar/callback`,
    `${APP_URL}/?token=${SECRET}`, `${APP_URL}/#${SECRET}`,
  ])("rejects non-origin or insecure application configuration: %j", (appUrl) => {
    expectPolicyError(() => getCalendarOAuthRedirectUri(appUrl));
  });
});

describe("Calendar mutation request CSRF policy", () => {
  it.each([
    {}, { "Sec-Fetch-Site": null }, { "Content-Type": "application/json; charset=utf-8" },
    { "Content-Type": "Application/JSON; charset=UTF-8" },
  ])("accepts an exact-origin JSON POST with supported headers: %j", (headers) => {
    expect(() => assertCalendarMutationRequest(request({ headers }), APP_URL)).not.toThrow();
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])("rejects %s even from the same origin", (method) => {
    expectPolicyError(() => assertCalendarMutationRequest(request({ method }), APP_URL));
  });

  it.each([
    { Origin: null }, { Origin: "null" }, { Origin: "https://evil.example.test" },
    { Origin: `${APP_URL}/` }, { Origin: "https://APP.EXAMPLE.TEST" },
    { Origin: "https://app.example.test:443" }, { Origin: `${APP_URL} https://evil.example.test` },
    { "Sec-Fetch-Site": "same-site" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "none" },
    { "Content-Type": null }, { "Content-Type": "text/plain" },
    { "Content-Type": "application/x-www-form-urlencoded" }, { "Content-Type": "multipart/form-data" },
    { "Content-Type": "application/jsonp" },
  ])("rejects a noncanonical Origin, unsafe fetch-site, or non-JSON body: %j", (headers) => {
    expectPolicyError(() => assertCalendarMutationRequest(request({ headers }), APP_URL));
  });

  it("does not let Host or forwarded headers authorize a foreign request URL", () => {
    const forged = request({
      url: `https://evil.example.test/api/calendar/connect`,
      headers: {
        Host: "app.example.test", "X-Forwarded-Host": "app.example.test",
        "X-Forwarded-Proto": "https", "X-Forwarded-Origin": APP_URL,
      },
    });
    expectPolicyError(() => assertCalendarMutationRequest(forged, APP_URL));
  });

  it("ignores untrusted routing headers when the actual URL and Origin are correct", () => {
    const valid = request({ headers: {
      Host: "evil.example.test", "X-Forwarded-Host": "evil.example.test",
      "X-Forwarded-Proto": "http", "X-Forwarded-Origin": "https://evil.example.test",
    } });
    expect(() => assertCalendarMutationRequest(valid, APP_URL)).not.toThrow();
  });

  it("uses the configured port and protocol instead of accepting a same-host mismatch", () => {
    for (const url of ["https://app.example.test:8443/api/calendar/connect", "http://app.example.test/api/calendar/connect"]) {
      expectPolicyError(() => assertCalendarMutationRequest(request({ url }), APP_URL));
    }
  });
});

describe("Calendar OAuth attempt creation", () => {
  it("requests exactly the two Calendar read scopes and the explicit offline consent flow", () => {
    const result = createCalendarOAuthAttempt(SESSION, CONFIG, NOW);
    const url = new URL(result.authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.hash).toBe("");
    expect(url.username).toBe("");
    expect(url.searchParams.get("client_id")).toBe(CONFIG.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(REQUIRED_SCOPES);
    expect([...url.searchParams.keys()].sort()).toEqual([
      "client_id", "redirect_uri", "response_type", "scope", "state",
      "access_type", "prompt", "include_granted_scopes",
    ].sort());
    expect(CALENDAR_READ_SCOPES).toEqual(REQUIRED_SCOPES);
    expect(Object.isFrozen(CALENDAR_READ_SCOPES)).toBe(true);
  });

  it("creates independent canonical 32-byte states and persists only their SHA-256 hashes", () => {
    const states = new Set<string>();
    for (let index = 0; index < 32; index += 1) {
      const result = createCalendarOAuthAttempt(SESSION, CONFIG, NOW);
      const state = new URL(result.authorizationUrl).searchParams.get("state")!;
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(state, "base64url")).toHaveLength(32);
      expect(Buffer.from(state, "base64url").toString("base64url")).toBe(state);
      expect(result.transaction.stateHash).toBe(hash(state));
      expect(result.transaction.stateHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(result.transaction)).not.toContain(state);
      expect(Object.keys(result.transaction).sort()).toEqual(["userId", "stateHash", "redirectUri", "expiresAt"].sort());
      states.add(state);
    }
    expect(states.size).toBe(32);
  });

  it("uses verified ownership and an exact ten-minute expiration without mutating the supplied clock", () => {
    const session = { userId: USER_ID.toUpperCase(), user_id: OTHER_USER_ID, accessToken: SECRET } as unknown as Session;
    const result = createCalendarOAuthAttempt(session, CONFIG, NOW);
    expect(CALENDAR_OAUTH_TTL_MS).toBe(600_000);
    expect(result.transaction).toMatchObject({
      userId: USER_ID, redirectUri: REDIRECT_URI, expiresAt: "2026-09-07T09:40:00.123Z",
    });
    expect(new Date(result.transaction.expiresAt).getTime() - NOW.getTime()).toBe(CALENDAR_OAUTH_TTL_MS);
    expect(NOW.toISOString()).toBe("2026-09-07T09:30:00.123Z");
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(OTHER_USER_ID);
  });

  it("uses the current clock when no explicit time is supplied", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(createCalendarOAuthAttempt(SESSION, CONFIG).transaction.expiresAt).toBe("2026-09-07T09:40:00.123Z");
  });

  it("URL-encodes configuration without allowing extra authorization parameters", () => {
    const clientId = "client&scope=https://www.googleapis.com/auth/calendar&redirect_uri=https://evil.example.test";
    const result = createCalendarOAuthAttempt(SESSION, { ...CONFIG, clientId }, NOW);
    const url = new URL(result.authorizationUrl);
    expect(url.searchParams.get("client_id")).toBe(clientId);
    expect(url.searchParams.getAll("scope")).toEqual([REQUIRED_SCOPES.join(" ")]);
    expect(url.searchParams.getAll("redirect_uri")).toEqual([REDIRECT_URI]);
  });

  it.each([
    new Date(NaN), new Date("0000-01-01T00:00:00Z"), new Date("9999-12-31T23:55:00Z"),
    new Date(8_640_000_000_000_000), null, "2026-09-07T09:30:00Z",
  ])("rejects invalid clock values or an expiration beyond supported years: %s", (now) => {
    expectPolicyError(() => createCalendarOAuthAttempt(SESSION, CONFIG, now as Date));
  });

  it("accepts the last supported year when the complete TTL still fits", () => {
    const now = new Date("9999-12-31T23:49:59.999Z");
    expect(createCalendarOAuthAttempt(SESSION, CONFIG, now).transaction.expiresAt).toBe("9999-12-31T23:59:59.999Z");
  });

  it.each([null, {}, { user_id: USER_ID }, { userId: "" }, { userId: SECRET }, { userId: "00000000-0000-0000-0000-000000000000" }])(
    "rejects missing or malformed verified-session IDs: %j", (session) => {
      expectPolicyError(() => createCalendarOAuthAttempt(session as Session, CONFIG, NOW));
    },
  );

  it.each(["", " ", `client\n${SECRET}`, "x".repeat(1025), null])("rejects malformed client IDs: %s", (clientId) => {
    expectPolicyError(() => createCalendarOAuthAttempt(SESSION, { ...CONFIG, clientId: clientId as string }, NOW));
  });
});

describe("Calendar OAuth callback parsing", () => {
  it("returns only the code and validated state from an exact callback", () => {
    const result = parseCalendarOAuthCallback(callback({
      state: STATE, code: CODE, scope: "https://www.googleapis.com/auth/calendar",
      authuser: "4", prompt: "consent", hd: "example.test", user_id: OTHER_USER_ID,
    }), APP_URL);
    expect(result).toEqual({ status: "code", state: STATE, code: CODE });
  });

  it("sanitizes a denied callback without retaining provider diagnostics or identity extras", () => {
    const result = parseCalendarOAuthCallback(callback({
      state: STATE, error: "access_denied", error_description: SECRET,
      error_uri: `https://evil.example.test/${SECRET}`, user_id: OTHER_USER_ID,
    }), APP_URL);
    expect(result).toEqual({ status: "denied", state: STATE });
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${SECRET}|${OTHER_USER_ID}`));
  });

  it.each([
    "https://evil.example.test/api/calendar/callback",
    `${APP_URL}/api/calendar/other`, `${REDIRECT_URI}/`,
    `${APP_URL}/api/calendar/%63allback`, `${APP_URL}/api/calendar/unused/../callback`,
    `${APP_URL}/api/calendar/./callback`, `${APP_URL}/api/calendar/%2e/callback`,
    "https://APP.EXAMPLE.TEST/api/calendar/callback",
    "https://app.example.test:443/api/calendar/callback",
    `https://${SECRET}@app.example.test/api/calendar/callback`,
    "https://app.example.test.evil.test/api/calendar/callback",
    `${APP_URL}//api/calendar/callback`,
  ])("rejects a non-exact callback base rather than trusting URL normalization: %s", (base) => {
    expectPolicyError(() => parseCalendarOAuthCallback(callback(undefined, base), APP_URL));
  });

  it.each(["#", `#${SECRET}`, "\n", " ", "\\"])('rejects appended fragment, whitespace, or backslash %j', (suffix) => {
    expectPolicyError(() => parseCalendarOAuthCallback(callback() + suffix, APP_URL));
  });

  it.each([
    "", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}B`,
    `${"A".repeat(42)}=`, `${"A".repeat(42)}+`, `${"A".repeat(42)}/`,
    `${"A".repeat(42)} `, `${"A".repeat(42)}é`, SECRET,
  ])("rejects missing entropy width or noncanonical base64url state: %s", (state) => {
    expectPolicyError(() => parseCalendarOAuthCallback(callback({ state, code: CODE }), APP_URL));
  });

  it.each([
    `code=${encodeURIComponent(CODE)}`,
    `state=${STATE}`,
    `state=${STATE}&code=${CODE}&error=access_denied`,
    `state=${STATE}&state=${STATE}&code=${CODE}`,
    `state=${STATE}&st%61te=${STATE}&code=${CODE}`,
    `state=${STATE}&code=${CODE}&code=${CODE}`,
    `state=${STATE}&error=access_denied&error=access_denied`,
  ])("requires one state and exactly one code-or-error value: %s", (query) => {
    expectPolicyError(() => parseCalendarOAuthCallback(`${REDIRECT_URI}?${query}`, APP_URL));
  });

  it.each(["", " ", "a b", "a\tb", "a\nb", "a\u0000b", "a\u007fb", "é", "x".repeat(4097)])(
    "rejects a non-graphic or oversized authorization code", (code) => {
      expectPolicyError(() => parseCalendarOAuthCallback(callback({ state: STATE, code }), APP_URL));
    },
  );

  it.each(["!", "x".repeat(4096), "code+#/%?&=~"])('retains valid graphic codes after query decoding', (code) => {
    expect(parseCalendarOAuthCallback(callback({ state: STATE, code }), APP_URL)).toEqual({ status: "code", state: STATE, code });
  });

  it.each(["", " ", "error\nsecret", "x".repeat(257)])("rejects malformed error values without echoing them", (error) => {
    expectPolicyError(() => parseCalendarOAuthCallback(callback({ state: STATE, error }), APP_URL));
  });

  it("checks the exact callback against the selected development or production origin", () => {
    const localApp = "http://localhost:3000";
    const localCallback = callback(undefined, getCalendarOAuthRedirectUri(localApp));
    expect(parseCalendarOAuthCallback(localCallback, localApp)).toEqual({ status: "code", state: STATE, code: CODE });
    expectPolicyError(() => parseCalendarOAuthCallback(localCallback, APP_URL));
    expectPolicyError(() => parseCalendarOAuthCallback(callback(), localApp));
  });
});

describe("Calendar OAuth consume-command projection", () => {
  it.each(["code", "denied"] as const)("projects the hash, verified owner, and fixed redirect for %s callbacks", (status) => {
    const parsed = status === "code"
      ? parseCalendarOAuthCallback(callback(), APP_URL)
      : parseCalendarOAuthCallback(callback({ state: STATE, error: "access_denied" }), APP_URL);
    const withSpoofedOwnership = { ...parsed, userId: OTHER_USER_ID, user_id: OTHER_USER_ID, redirectUri: "https://evil.example.test" };
    const command = createCalendarOAuthConsumeCommand(withSpoofedOwnership, SESSION, APP_URL);
    expect(command).toEqual({ stateHash: hash(STATE), userId: USER_ID, redirectUri: REDIRECT_URI });
    expect(JSON.stringify(command)).not.toContain(CODE);
    expect(JSON.stringify(command)).not.toContain(STATE);
    expect(JSON.stringify(command)).not.toContain(OTHER_USER_ID);
  });

  it("binds identical state to the currently verified session instead of claims in a callback", () => {
    const parsed = parseCalendarOAuthCallback(callback({ state: STATE, code: CODE, user_id: USER_ID }), APP_URL);
    const otherSession = { userId: OTHER_USER_ID } as Session;
    expect(createCalendarOAuthConsumeCommand(parsed, otherSession, APP_URL)).toEqual({
      stateHash: hash(STATE), userId: OTHER_USER_ID, redirectUri: REDIRECT_URI,
    });
  });

  it("builds only a command; repeated construction does not pretend to consume or validate stored expiry", () => {
    const parsed = parseCalendarOAuthCallback(callback(), APP_URL);
    const first = createCalendarOAuthConsumeCommand(parsed, SESSION, APP_URL);
    expect(createCalendarOAuthConsumeCommand(parsed, SESSION, APP_URL)).toEqual(first);
    expect(Object.keys(first).sort()).toEqual(["stateHash", "userId", "redirectUri"].sort());
  });

  it.each([
    null, { status: "unknown", state: STATE }, { status: "code", state: STATE },
    { status: "code", state: SECRET, code: CODE }, { status: "code", state: STATE, code: "" },
    { status: "denied", state: "A".repeat(42) + "B" },
  ])("revalidates callback essentials before creating a consume command: %j", (parsed) => {
    expectPolicyError(() => createCalendarOAuthConsumeCommand(parsed as CalendarOAuthCallback, SESSION, APP_URL));
  });

  it("rejects a malformed session ID or unsafe configured redirect at consumption", () => {
    const parsed = parseCalendarOAuthCallback(callback(), APP_URL);
    expectPolicyError(() => createCalendarOAuthConsumeCommand(parsed, { userId: SECRET } as Session, APP_URL));
    expectPolicyError(() => createCalendarOAuthConsumeCommand(parsed, SESSION, `https://${SECRET}@evil.example.test`));
  });
});

describe("Calendar granted-scope validation", () => {
  it.each([
    REQUIRED_SCOPES.join(" "), [...REQUIRED_SCOPES].reverse().join(" "),
    ` \t${REQUIRED_SCOPES[0]}\n${REQUIRED_SCOPES[1]}  `,
  ])("accepts only the exact two required scopes with whitespace delimiters", (value) => {
    expect(validateGrantedCalendarScopes(value)).toEqual(REQUIRED_SCOPES);
  });

  it.each([
    undefined, null, [], REQUIRED_SCOPES, {}, "", " ", REQUIRED_SCOPES[0], REQUIRED_SCOPES[1],
    `${REQUIRED_SCOPES.join(" ")} openid`, `${REQUIRED_SCOPES.join(" ")} email`,
    `${REQUIRED_SCOPES.join(" ")} profile`, `${REQUIRED_SCOPES.join(" ")} https://www.googleapis.com/auth/calendar`,
    `${REQUIRED_SCOPES.join(" ")} https://www.googleapis.com/auth/calendar.events`,
    `${REQUIRED_SCOPES.join(" ")} https://www.googleapis.com/auth/calendar.readonly`,
    `${REQUIRED_SCOPES[0]} ${REQUIRED_SCOPES[0]}`,
    `${REQUIRED_SCOPES.join(" ")} ${REQUIRED_SCOPES[1]}`,
    REQUIRED_SCOPES.join(","), REQUIRED_SCOPES.join(" ").toUpperCase(),
    `${REQUIRED_SCOPES[0]} ${REQUIRED_SCOPES[1]}/${SECRET}`,
  ])("rejects missing, duplicate, identity, broad, write, or non-string grants: %j", (value) => {
    expectPolicyError(() => validateGrantedCalendarScopes(value));
  });

  it("returns fresh projections instead of exposing the shared scope constant", () => {
    const first = validateGrantedCalendarScopes(REQUIRED_SCOPES.join(" "));
    const second = validateGrantedCalendarScopes(REQUIRED_SCOPES.join(" "));
    expect(first).not.toBe(second);
    expect(first).not.toBe(CALENDAR_READ_SCOPES);
    expect(first).toEqual(second);
  });
});
