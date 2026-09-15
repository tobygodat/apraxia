import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRIVE_OAUTH_TTL_MS,
  DRIVE_SCOPES,
  DriveOAuthPolicyError,
  assertDriveMutationRequest,
  createDriveOAuthAttempt,
  createDriveOAuthConsumeCommand,
  getDriveOAuthRedirectUri,
  parseDriveOAuthCallback,
  validateGrantedDriveScopes,
  type DriveOAuthCallback,
} from "../../server/drive/oauthPolicy";

type Session = Parameters<typeof createDriveOAuthAttempt>[0];
const APP_URL = "https://app.example.test";
const REDIRECT_URI = `${APP_URL}/api/drive/callback`;
const USER_ID = "abcdef12-3456-4789-8abc-def123456789";
const OTHER_USER_ID = "12345678-1234-4234-8234-123456789abc";
const SESSION = { userId: USER_ID } as Session;
const CONFIG = { appUrl: APP_URL, clientId: "example-client.apps.googleusercontent.com" };
const NOW = new Date("2026-09-07T09:30:00.123Z");
const STATE = Buffer.alloc(32, 7).toString("base64url");
const CODE = "4/legitimate.Google-code_123";
const SECRET = "private-provider-code-or-token";
const REQUIRED_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

function callback(
  params: Record<string, string> = { state: STATE, code: CODE },
  base = REDIRECT_URI,
) {
  return `${base}?${new URLSearchParams(params)}`;
}

function request({
  url = `${APP_URL}/api/drive/connect`,
  method = "POST",
  headers = {},
}: { url?: string; method?: string; headers?: Record<string, string | null | undefined> } = {}) {
  const values = new Headers({
    Origin: APP_URL,
    "Content-Type": "application/json",
    "Sec-Fetch-Site": "same-origin",
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
  try {
    action();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(DriveOAuthPolicyError);
  expect((failure as Error).message).toBe(new DriveOAuthPolicyError().message);
  expect(String(failure)).not.toContain(SECRET);
  return failure;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Drive OAuth redirect origin", () => {
  it.each([
    [APP_URL, REDIRECT_URI],
    [`${APP_URL}/`, REDIRECT_URI],
    ["https://APP.EXAMPLE.TEST:443/", REDIRECT_URI],
    ["https://preview.example.test:8443", "https://preview.example.test:8443/api/drive/callback"],
    ["http://localhost:3000/", "http://localhost:3000/api/drive/callback"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000/api/drive/callback"],
    ["http://[::1]:3000", "http://[::1]:3000/api/drive/callback"],
  ])("builds the callback from the canonical configured origin: %s", (appUrl, expected) => {
    expect(getDriveOAuthRedirectUri(appUrl)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    42,
    {},
    "",
    " ",
    "http://app.example.test",
    "ftp://app.example.test",
    `https://${SECRET}@app.example.test`,
    `${APP_URL}/api/drive/callback`,
    `${APP_URL}/?token=${SECRET}`,
    `${APP_URL}/#${SECRET}`,
  ])("rejects non-origin or insecure application configuration: %j", (appUrl) => {
    expectPolicyError(() => getDriveOAuthRedirectUri(appUrl));
  });
});

describe("Drive mutation request CSRF policy", () => {
  it.each([
    {},
    { "Sec-Fetch-Site": null },
    { "Content-Type": "application/json; charset=utf-8" },
    { "Content-Type": "Application/JSON; charset=UTF-8" },
  ])("accepts an exact-origin JSON POST with supported headers: %j", (headers) => {
    expect(() => assertDriveMutationRequest(request({ headers }), APP_URL)).not.toThrow();
  });

  it.each(["GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])(
    "rejects %s even from the same origin",
    (method) => {
      expectPolicyError(() => assertDriveMutationRequest(request({ method }), APP_URL));
    },
  );

  it.each([
    { Origin: null },
    { Origin: "null" },
    { Origin: "https://evil.example.test" },
    { Origin: `${APP_URL}/` },
    { Origin: "https://APP.EXAMPLE.TEST" },
    { Origin: "https://app.example.test:443" },
    { Origin: `${APP_URL} https://evil.example.test` },
    { "Sec-Fetch-Site": "same-site" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "none" },
    { "Content-Type": null },
    { "Content-Type": "text/plain" },
    { "Content-Type": "application/x-www-form-urlencoded" },
    { "Content-Type": "multipart/form-data" },
    { "Content-Type": "application/jsonp" },
  ])("rejects a noncanonical Origin, unsafe fetch-site, or non-JSON body: %j", (headers) => {
    expectPolicyError(() => assertDriveMutationRequest(request({ headers }), APP_URL));
  });

  it("does not let Host or forwarded headers authorize a foreign request URL", () => {
    const forged = request({
      url: `https://evil.example.test/api/drive/connect`,
      headers: {
        Host: "app.example.test",
        "X-Forwarded-Host": "app.example.test",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Origin": APP_URL,
      },
    });
    expectPolicyError(() => assertDriveMutationRequest(forged, APP_URL));
  });

  it("ignores untrusted routing headers when the actual URL and Origin are correct", () => {
    const valid = request({
      headers: {
        Host: "evil.example.test",
        "X-Forwarded-Host": "evil.example.test",
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Origin": "https://evil.example.test",
      },
    });
    expect(() => assertDriveMutationRequest(valid, APP_URL)).not.toThrow();
  });

  it("uses the configured port and protocol instead of accepting a same-host mismatch", () => {
    for (const url of [
      "https://app.example.test:8443/api/drive/connect",
      "http://app.example.test/api/drive/connect",
    ]) {
      expectPolicyError(() => assertDriveMutationRequest(request({ url }), APP_URL));
    }
  });
});

describe("Drive OAuth attempt creation", () => {
  it("requests exactly the Drive read-only scope and the explicit offline consent flow", () => {
    const result = createDriveOAuthAttempt(SESSION, CONFIG, NOW);
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
    expect([...url.searchParams.keys()].sort()).toEqual(
      [
        "client_id",
        "redirect_uri",
        "response_type",
        "scope",
        "state",
        "access_type",
        "prompt",
        "include_granted_scopes",
      ].sort(),
    );
    expect(DRIVE_SCOPES).toEqual(REQUIRED_SCOPES);
    expect(Object.isFrozen(DRIVE_SCOPES)).toBe(true);
  });

  it("creates independent canonical 32-byte states and persists only their SHA-256 hashes", () => {
    const states = new Set<string>();
    for (let index = 0; index < 32; index += 1) {
      const result = createDriveOAuthAttempt(SESSION, CONFIG, NOW);
      const state = new URL(result.authorizationUrl).searchParams.get("state")!;
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(state, "base64url")).toHaveLength(32);
      expect(Buffer.from(state, "base64url").toString("base64url")).toBe(state);
      expect(result.transaction.stateHash).toBe(hash(state));
      expect(result.transaction.stateHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(result.transaction)).not.toContain(state);
      expect(Object.keys(result.transaction).sort()).toEqual(
        ["userId", "stateHash", "redirectUri", "expiresAt"].sort(),
      );
      states.add(state);
    }
    expect(states.size).toBe(32);
  });

  it("uses verified ownership and an exact ten-minute expiration without mutating the supplied clock", () => {
    const session = {
      userId: USER_ID.toUpperCase(),
      user_id: OTHER_USER_ID,
      accessToken: SECRET,
    } as unknown as Session;
    const result = createDriveOAuthAttempt(session, CONFIG, NOW);
    expect(DRIVE_OAUTH_TTL_MS).toBe(600_000);
    expect(result.transaction).toMatchObject({
      userId: USER_ID,
      redirectUri: REDIRECT_URI,
      expiresAt: "2026-09-07T09:40:00.123Z",
    });
    expect(new Date(result.transaction.expiresAt).getTime() - NOW.getTime()).toBe(
      DRIVE_OAUTH_TTL_MS,
    );
    expect(NOW.toISOString()).toBe("2026-09-07T09:30:00.123Z");
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(OTHER_USER_ID);
  });

  it("uses the current clock when no explicit time is supplied", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    expect(createDriveOAuthAttempt(SESSION, CONFIG).transaction.expiresAt).toBe(
      "2026-09-07T09:40:00.123Z",
    );
  });

  it("URL-encodes configuration without allowing extra authorization parameters", () => {
    const clientId =
      "client&scope=https://www.googleapis.com/auth/drive&redirect_uri=https://evil.example.test";
    const result = createDriveOAuthAttempt(SESSION, { ...CONFIG, clientId }, NOW);
    const url = new URL(result.authorizationUrl);
    expect(url.searchParams.get("client_id")).toBe(clientId);
    expect(url.searchParams.getAll("scope")).toEqual([REQUIRED_SCOPES.join(" ")]);
    expect(url.searchParams.getAll("redirect_uri")).toEqual([REDIRECT_URI]);
  });

  it.each([
    new Date(NaN),
    new Date("0000-01-01T00:00:00Z"),
    new Date("9999-12-31T23:55:00Z"),
    new Date(8_640_000_000_000_000),
    null,
    "2026-09-07T09:30:00Z",
  ])("rejects invalid clock values or an expiration beyond supported years: %s", (now) => {
    expectPolicyError(() => createDriveOAuthAttempt(SESSION, CONFIG, now as Date));
  });

  it("accepts the last supported year when the complete TTL still fits", () => {
    const now = new Date("9999-12-31T23:49:59.999Z");
    expect(createDriveOAuthAttempt(SESSION, CONFIG, now).transaction.expiresAt).toBe(
      "9999-12-31T23:59:59.999Z",
    );
  });

  it.each([
    null,
    {},
    { user_id: USER_ID },
    { userId: "" },
    { userId: SECRET },
    { userId: "00000000-0000-0000-0000-000000000000" },
  ])("rejects missing or malformed verified-session IDs: %j", (session) => {
    expectPolicyError(() => createDriveOAuthAttempt(session as Session, CONFIG, NOW));
  });

  it.each(["", " ", `client\n${SECRET}`, "x".repeat(1025), null])(
    "rejects malformed client IDs: %s",
    (clientId) => {
      expectPolicyError(() =>
        createDriveOAuthAttempt(SESSION, { ...CONFIG, clientId: clientId as string }, NOW),
      );
    },
  );
});

describe("Drive OAuth callback parsing", () => {
  it("returns only the code and validated state from an exact callback", () => {
    const result = parseDriveOAuthCallback(
      callback({
        state: STATE,
        code: CODE,
        scope: "https://www.googleapis.com/auth/drive",
        authuser: "4",
        prompt: "consent",
        hd: "example.test",
        user_id: OTHER_USER_ID,
      }),
      APP_URL,
    );
    expect(result).toEqual({ status: "code", state: STATE, code: CODE });
  });

  it("sanitizes a denied callback without retaining provider diagnostics or identity extras", () => {
    const result = parseDriveOAuthCallback(
      callback({
        state: STATE,
        error: "access_denied",
        error_description: SECRET,
        error_uri: `https://evil.example.test/${SECRET}`,
        user_id: OTHER_USER_ID,
      }),
      APP_URL,
    );
    expect(result).toEqual({ status: "denied", state: STATE });
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${SECRET}|${OTHER_USER_ID}`));
  });

  it.each([
    "https://evil.example.test/api/drive/callback",
    `${APP_URL}/api/drive/other`,
    `${REDIRECT_URI}/`,
    `${APP_URL}/api/drive/%63allback`,
    `${APP_URL}/api/drive/unused/../callback`,
    `${APP_URL}/api/drive/./callback`,
    `${APP_URL}/api/drive/%2e/callback`,
    "https://APP.EXAMPLE.TEST/api/drive/callback",
    "https://app.example.test:443/api/drive/callback",
    `https://${SECRET}@app.example.test/api/drive/callback`,
    "https://app.example.test.evil.test/api/drive/callback",
    `${APP_URL}//api/drive/callback`,
  ])("rejects a non-exact callback base rather than trusting URL normalization: %s", (base) => {
    expectPolicyError(() => parseDriveOAuthCallback(callback(undefined, base), APP_URL));
  });

  it.each(["#", `#${SECRET}`, "\n", " ", "\\"])(
    "rejects appended fragment, whitespace, or backslash %j",
    (suffix) => {
      expectPolicyError(() => parseDriveOAuthCallback(callback() + suffix, APP_URL));
    },
  );

  it.each([
    "",
    "A".repeat(42),
    "A".repeat(44),
    `${"A".repeat(42)}B`,
    `${"A".repeat(42)}=`,
    `${"A".repeat(42)}+`,
    `${"A".repeat(42)}/`,
    `${"A".repeat(42)} `,
    `${"A".repeat(42)}é`,
    SECRET,
  ])("rejects missing entropy width or noncanonical base64url state: %s", (state) => {
    expectPolicyError(() => parseDriveOAuthCallback(callback({ state, code: CODE }), APP_URL));
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
    expectPolicyError(() => parseDriveOAuthCallback(`${REDIRECT_URI}?${query}`, APP_URL));
  });

  it.each(["", " ", "a b", "a\tb", "a\nb", "a\u0000b", "a\u007fb", "é", "x".repeat(4097)])(
    "rejects a non-graphic or oversized authorization code",
    (code) => {
      expectPolicyError(() => parseDriveOAuthCallback(callback({ state: STATE, code }), APP_URL));
    },
  );

  it.each(["!", "x".repeat(4096), "code+#/%?&=~"])(
    "retains valid graphic codes after query decoding",
    (code) => {
      expect(parseDriveOAuthCallback(callback({ state: STATE, code }), APP_URL)).toEqual({
        status: "code",
        state: STATE,
        code,
      });
    },
  );

  it.each(["", " ", "error\nsecret", "x".repeat(257)])(
    "rejects malformed error values without echoing them",
    (error) => {
      expectPolicyError(() => parseDriveOAuthCallback(callback({ state: STATE, error }), APP_URL));
    },
  );

  it("checks the exact callback against the selected development or production origin", () => {
    const localApp = "http://localhost:3000";
    const localCallback = callback(undefined, getDriveOAuthRedirectUri(localApp));
    expect(parseDriveOAuthCallback(localCallback, localApp)).toEqual({
      status: "code",
      state: STATE,
      code: CODE,
    });
    expectPolicyError(() => parseDriveOAuthCallback(localCallback, APP_URL));
    expectPolicyError(() => parseDriveOAuthCallback(callback(), localApp));
  });
});

describe("Drive OAuth consume-command projection", () => {
  it.each(["code", "denied"] as const)(
    "projects the hash, verified owner, and fixed redirect for %s callbacks",
    (status) => {
      const parsed =
        status === "code"
          ? parseDriveOAuthCallback(callback(), APP_URL)
          : parseDriveOAuthCallback(callback({ state: STATE, error: "access_denied" }), APP_URL);
      const withSpoofedOwnership = {
        ...parsed,
        userId: OTHER_USER_ID,
        user_id: OTHER_USER_ID,
        redirectUri: "https://evil.example.test",
      };
      const command = createDriveOAuthConsumeCommand(withSpoofedOwnership, SESSION, APP_URL);
      expect(command).toEqual({
        stateHash: hash(STATE),
        userId: USER_ID,
        redirectUri: REDIRECT_URI,
      });
      expect(JSON.stringify(command)).not.toContain(CODE);
      expect(JSON.stringify(command)).not.toContain(STATE);
      expect(JSON.stringify(command)).not.toContain(OTHER_USER_ID);
    },
  );

  it("binds identical state to the currently verified session instead of claims in a callback", () => {
    const parsed = parseDriveOAuthCallback(
      callback({ state: STATE, code: CODE, user_id: USER_ID }),
      APP_URL,
    );
    const otherSession = { userId: OTHER_USER_ID } as Session;
    expect(createDriveOAuthConsumeCommand(parsed, otherSession, APP_URL)).toEqual({
      stateHash: hash(STATE),
      userId: OTHER_USER_ID,
      redirectUri: REDIRECT_URI,
    });
  });

  it("builds only a command; repeated construction does not pretend to consume or validate stored expiry", () => {
    const parsed = parseDriveOAuthCallback(callback(), APP_URL);
    const first = createDriveOAuthConsumeCommand(parsed, SESSION, APP_URL);
    expect(createDriveOAuthConsumeCommand(parsed, SESSION, APP_URL)).toEqual(first);
    expect(Object.keys(first).sort()).toEqual(["stateHash", "userId", "redirectUri"].sort());
  });

  it.each([
    null,
    { status: "unknown", state: STATE },
    { status: "code", state: STATE },
    { status: "code", state: SECRET, code: CODE },
    { status: "code", state: STATE, code: "" },
    { status: "denied", state: "A".repeat(42) + "B" },
  ])("revalidates callback essentials before creating a consume command: %j", (parsed) => {
    expectPolicyError(() =>
      createDriveOAuthConsumeCommand(parsed as DriveOAuthCallback, SESSION, APP_URL),
    );
  });

  it("rejects a malformed session ID or unsafe configured redirect at consumption", () => {
    const parsed = parseDriveOAuthCallback(callback(), APP_URL);
    expectPolicyError(() =>
      createDriveOAuthConsumeCommand(parsed, { userId: SECRET } as Session, APP_URL),
    );
    expectPolicyError(() =>
      createDriveOAuthConsumeCommand(parsed, SESSION, `https://${SECRET}@evil.example.test`),
    );
  });
});

describe("Drive granted-scope validation", () => {
  it.each([
    REQUIRED_SCOPES.join(" "),
    [...REQUIRED_SCOPES].reverse().join(" "),
    ` \t${REQUIRED_SCOPES[0]}\n  `,
  ])("accepts only the exact required scope with whitespace delimiters", (value) => {
    expect(validateGrantedDriveScopes(value)).toEqual(REQUIRED_SCOPES);
  });

  it.each([
    undefined,
    null,
    [],
    REQUIRED_SCOPES,
    {},
    "",
    " ",
    `${REQUIRED_SCOPES.join(" ")} openid`,
    `${REQUIRED_SCOPES.join(" ")} email`,
    `${REQUIRED_SCOPES.join(" ")} profile`,
    `${REQUIRED_SCOPES.join(" ")} https://www.googleapis.com/auth/drive`,
    `${REQUIRED_SCOPES.join(" ")} https://www.googleapis.com/auth/drive.events`,
    `${REQUIRED_SCOPES.join(" ")} https://www.googleapis.com/auth/drive.readonly`,
    `${REQUIRED_SCOPES[0]} ${REQUIRED_SCOPES[0]}`,
    `${REQUIRED_SCOPES.join(" ")} ${REQUIRED_SCOPES[1]}`,
    `${REQUIRED_SCOPES[0]},`,
    REQUIRED_SCOPES.join(" ").toUpperCase(),
    `${REQUIRED_SCOPES[0]} ${REQUIRED_SCOPES[1]}/${SECRET}`,
  ])("rejects missing, duplicate, identity, broad, write, or non-string grants: %j", (value) => {
    expectPolicyError(() => validateGrantedDriveScopes(value));
  });

  it("returns fresh projections instead of exposing the shared scope constant", () => {
    const first = validateGrantedDriveScopes(REQUIRED_SCOPES.join(" "));
    const second = validateGrantedDriveScopes(REQUIRED_SCOPES.join(" "));
    expect(first).not.toBe(second);
    expect(first).not.toBe(DRIVE_SCOPES);
    expect(first).toEqual(second);
  });
});
