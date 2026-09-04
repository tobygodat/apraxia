import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { verifySupabaseSession } from "../../server/auth/verifySession";
import {
  createCalendarOAuthAttempt,
  createCalendarOAuthConsumeCommand,
  parseCalendarOAuthCallback,
  type PendingCalendarOAuthTransaction,
} from "../../server/calendar/oauthPolicy";

const A = "77777777-7777-4777-8777-777777777771";
const B = "77777777-7777-4777-8777-777777777772";
const UNKNOWN = "77777777-7777-4777-8777-777777777773";
const APP = "https://app.example.test";
const REDIRECT = `${APP}/api/calendar/callback`;
const SAFE_ERROR = { code: "22023", message: "Calendar authorization could not be verified." };
const BEGIN_SIGNATURE = "public.begin_calendar_oauth_transaction(uuid,text,text,timestamptz)";
const CONSUME_SIGNATURE = "public.consume_calendar_oauth_transaction(uuid,text,text)";
const VALIDATE_SIGNATURE = "private.valid_calendar_oauth_transaction_input(uuid,text,text)";
let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable set search_path = ''
    as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  const directory = path.join(process.cwd(), "supabase", "migrations");
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(directory, name), "utf8"));
  }
  await db.query("insert into auth.users(id,email) values ($1,'oauth-a@example.test'),($2,'oauth-b@example.test')", [A, B]);
}, 30_000);

beforeEach(async () => {
  await db.exec("reset role; truncate private.google_oauth_transactions; set role service_role;");
});

afterAll(async () => { await db?.close(); });

function pending(overrides: Partial<PendingCalendarOAuthTransaction> = {}): PendingCalendarOAuthTransaction {
  return {
    userId: A,
    stateHash: createHash("sha256").update(randomUUID()).digest("hex"),
    redirectUri: REDIRECT,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    ...overrides,
  };
}

async function begin(transaction: PendingCalendarOAuthTransaction) {
  const result = await db.query<{ receipt: { id: string; expires_at: string } }>(
    "select public.begin_calendar_oauth_transaction($1::uuid,$2::text,$3::text,$4::timestamptz) as receipt",
    [transaction.userId, transaction.stateHash, transaction.redirectUri, transaction.expiresAt],
  );
  return result.rows[0]!.receipt;
}

async function consume(command: Pick<PendingCalendarOAuthTransaction, "userId" | "stateHash" | "redirectUri">) {
  const result = await db.query<{ receipt: { id: string; consumed_at: string } }>(
    "select public.consume_calendar_oauth_transaction($1::uuid,$2::text,$3::text) as receipt",
    [command.userId, command.stateHash, command.redirectUri],
  );
  return result.rows[0]!.receipt;
}

async function verifyFakeSession(userId: string) {
  return verifySupabaseSession(
    new Request(`${APP}/api/calendar/connect?user_id=${UNKNOWN}`, {
      headers: { Authorization: "Bearer fictional-session" },
    }),
    { SUPABASE_URL: "https://auth.example.test", SUPABASE_ANON_KEY: "sb_publishable_test" },
    { fetch: async () => Response.json({ id: userId, role: "authenticated", is_anonymous: false }) },
  );
}

describe("private OAuth SQL lifecycle with server policy", () => {
  it("uses independently verified identity and stores only a state hash before consuming once", async () => {
    const attempt = createCalendarOAuthAttempt(await verifyFakeSession(A), { appUrl: APP, clientId: "fictional-client" });
    const receipt = await begin(attempt.transaction);
    expect(Object.keys(receipt).sort()).toEqual(["expires_at", "id"]);
    const rawState = new URL(attempt.authorizationUrl).searchParams.get("state")!;
    const rows = await db.query<{ record: Record<string, unknown> }>(
      "select to_jsonb(transaction) as record from private.google_oauth_transactions as transaction",
    );
    expect(rows.rows[0]!.record).toMatchObject({
      id: receipt.id, user_id: A, state_hash: attempt.transaction.stateHash,
      redirect_uri: REDIRECT, consumed_at: null,
    });
    expect(JSON.stringify(rows.rows)).not.toContain(rawState);

    const callback = parseCalendarOAuthCallback(`${REDIRECT}?state=${rawState}&code=fake-code&user_id=${B}`, APP);
    const command = createCalendarOAuthConsumeCommand(callback, await verifyFakeSession(A), APP);
    const consumed = await consume(command);
    expect(Object.keys(consumed).sort()).toEqual(["consumed_at", "id"]);
    expect(consumed.id).toBe(receipt.id);
    expect(Number.isFinite(Date.parse(consumed.consumed_at))).toBe(true);
    await expect(consume(command)).rejects.toMatchObject(SAFE_ERROR);
  });

  it("rejects a switched account without burning the original owner's attempt", async () => {
    const attempt = createCalendarOAuthAttempt(await verifyFakeSession(A), { appUrl: APP, clientId: "fictional-client" });
    const receipt = await begin(attempt.transaction);
    const state = new URL(attempt.authorizationUrl).searchParams.get("state")!;
    const callback = parseCalendarOAuthCallback(`${REDIRECT}?state=${state}&code=fake-code`, APP);
    await expect(consume(createCalendarOAuthConsumeCommand(callback, await verifyFakeSession(B), APP)))
      .rejects.toMatchObject(SAFE_ERROR);
    expect((await consume(createCalendarOAuthConsumeCommand(callback, await verifyFakeSession(A), APP))).id)
      .toBe(receipt.id);
  });

  it("consumes a verified denial too, without retaining the provider error", async () => {
    const session = await verifyFakeSession(A);
    const attempt = createCalendarOAuthAttempt(session, { appUrl: APP, clientId: "fictional-client" });
    await begin(attempt.transaction);
    const state = new URL(attempt.authorizationUrl).searchParams.get("state")!;
    const callback = parseCalendarOAuthCallback(`${REDIRECT}?state=${state}&error=access_denied&error_description=private-detail`, APP);
    expect(callback).toEqual({ status: "denied", state });
    const command = createCalendarOAuthConsumeCommand(callback, session, APP);
    await consume(command);
    await expect(consume(command)).rejects.toMatchObject(SAFE_ERROR);
  });

  it("does not bind service calls to untrusted or stale database JWT claim settings", async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [B]);
    const transaction = pending();
    await begin(transaction);
    expect((await db.query<{ user_id: string }>("select user_id from private.google_oauth_transactions")).rows[0]!.user_id).toBe(A);
    await consume(transaction);
  });
});

describe("database-clock expiry and exact one-time matching", () => {
  it("caps a future requested expiry at ten minutes from the database's creation clock", async () => {
    const receipt = await begin(pending({ expiresAt: "9999-12-31T23:59:59Z" }));
    const result = await db.query<{ seconds: number; same: boolean }>(
      "select extract(epoch from expires_at-created_at)::float8 as seconds, expires_at=$1::timestamptz as same from private.google_oauth_transactions",
      [receipt.expires_at],
    );
    expect(result.rows[0]).toEqual({ seconds: 600, same: true });
  });

  it("never extends a shorter requested expiry", async () => {
    const requested = new Date(Date.now() + 120_000).toISOString();
    const receipt = await begin(pending({ expiresAt: requested }));
    expect(Date.parse(receipt.expires_at)).toBe(Date.parse(requested));
  });

  it("rejects expired state without consuming it", async () => {
    const transaction = pending();
    await begin(transaction);
    await db.exec("update private.google_oauth_transactions set created_at=clock_timestamp()-interval '2 minutes', expires_at=clock_timestamp()-interval '1 minute'");
    await expect(consume(transaction)).rejects.toMatchObject(SAFE_ERROR);
    expect((await db.query<{ consumed_at: null }>("select consumed_at from private.google_oauth_transactions")).rows[0]!.consumed_at).toBeNull();
  });

  it("uses a current clock rather than the beginning of a long transaction", async () => {
    const transaction = pending();
    await begin(transaction);
    await db.exec("begin");
    try {
      // A historical creation time keeps the fixture's table constraints valid.
      // After waiting, expiry is after transaction_timestamp but before real now.
      await db.exec("select pg_sleep(0.03); update private.google_oauth_transactions set created_at=transaction_timestamp()-interval '1 minute', expires_at=transaction_timestamp()+interval '1 millisecond'");
      await expect(consume(transaction)).rejects.toMatchObject(SAFE_ERROR);
    } finally { await db.exec("rollback"); }
  });

  it.each([
    ["infinite expiry", "clock_timestamp()", "'infinity'::timestamptz"],
    ["infinite creation", "'-infinity'::timestamptz", "clock_timestamp()+interval '1 minute'"],
    ["future creation", "clock_timestamp()+interval '1 minute'", "clock_timestamp()+interval '2 minutes'"],
    ["excess lifetime", "clock_timestamp()", "clock_timestamp()+interval '11 minutes'"],
  ])("rejects pre-existing private rows with %s", async (_label, created, expires) => {
    const transaction = pending();
    await begin(transaction);
    await db.exec(`update private.google_oauth_transactions set created_at=${created}, expires_at=${expires}`);
    await expect(consume(transaction)).rejects.toMatchObject(SAFE_ERROR);
  });

  it.each([
    ["owner", { userId: B }],
    ["redirect origin", { redirectUri: "https://other.example.test/api/calendar/callback" }],
    ["redirect port", { redirectUri: "https://app.example.test:443/api/calendar/callback" }],
    ["hash", { stateHash: "f".repeat(64) }],
  ])("rejects mismatched %s without changing the correct transaction", async (_label, changes) => {
    const transaction = pending();
    const receipt = await begin(transaction);
    await expect(consume({ ...transaction, ...changes })).rejects.toMatchObject(SAFE_ERROR);
    expect((await consume(transaction)).id).toBe(receipt.id);
  });

  it("keeps unknown and replayed failures indistinguishable", async () => {
    const transaction = pending();
    await expect(consume(transaction)).rejects.toMatchObject(SAFE_ERROR);
    await begin(transaction);
    await consume(transaction);
    await expect(consume(transaction)).rejects.toMatchObject(SAFE_ERROR);
  });

  it("rejects collisions without replacing or consuming the earlier attempt", async () => {
    const transaction = pending();
    const receipt = await begin(transaction);
    await expect(begin({ ...transaction, userId: B })).rejects.toMatchObject(SAFE_ERROR);
    expect((await consume(transaction)).id).toBe(receipt.id);
    expect((await db.query<{ count: number }>("select count(*)::integer as count from private.google_oauth_transactions")).rows[0]!.count).toBe(1);
  });

  it.each([null, "infinity", "-infinity", "2000-01-01T00:00:00Z"])("rejects nonfuture or nonfinite expiry %s", async (expiry) => {
    await expect(db.query("select public.begin_calendar_oauth_transaction($1,$2,$3,$4::timestamptz)", [A, "a".repeat(64), REDIRECT, expiry]))
      .rejects.toMatchObject(SAFE_ERROR);
  });

  it.each([null, "00000000-0000-0000-0000-000000000000", UNKNOWN])("rejects missing, nil, or absent ownership %s without FK disclosure", async (userId) => {
    await expect(db.query("select public.begin_calendar_oauth_transaction($1::uuid,$2,$3,clock_timestamp()+interval '5 minutes')", [userId, "a".repeat(64), REDIRECT]))
      .rejects.toMatchObject(SAFE_ERROR);
  });

  it.each([null, "", "A".repeat(64), "a".repeat(63), "a".repeat(65), "z".repeat(64), "a".repeat(64) + "\n"])("rejects malformed state hash %# in both operations", async (hash) => {
    await expect(db.query("select public.begin_calendar_oauth_transaction($1,$2,$3,clock_timestamp()+interval '5 minutes')", [A, hash, REDIRECT]))
      .rejects.toMatchObject(SAFE_ERROR);
    await expect(db.query("select public.consume_calendar_oauth_transaction($1,$2,$3)", [A, hash, REDIRECT]))
      .rejects.toMatchObject(SAFE_ERROR);
  });

  it.each([
    null, "", "http://app.example.test/api/calendar/callback", `${REDIRECT}?extra=1`, `${REDIRECT}#fragment`,
    `${REDIRECT}/`, "https://user:password@app.example.test/api/calendar/callback", `${REDIRECT}\n`,
    "https://app.example.test\\other/api/calendar/callback", "https://example.test/other/api/calendar/callback",
    "https://" + "a".repeat(4096) + "/api/calendar/callback", "https://éxample.test/api/calendar/callback",
  ])("rejects an unsafe structural redirect %# in both operations", async (redirect) => {
    await expect(db.query("select public.begin_calendar_oauth_transaction($1,$2,$3,clock_timestamp()+interval '5 minutes')", [A, "a".repeat(64), redirect]))
      .rejects.toMatchObject(SAFE_ERROR);
    await expect(db.query("select public.consume_calendar_oauth_transaction($1,$2,$3)", [A, "a".repeat(64), redirect]))
      .rejects.toMatchObject(SAFE_ERROR);
  });

  it.each([
    "http://localhost:3000", "http://127.0.0.1:3000", "http://127.1.2.3", "http://[::1]:3000", "https://[2001:db8::1]:8443",
  ])("preserves policy-supported development and HTTPS origins: %s", async (appUrl) => {
    const attempt = createCalendarOAuthAttempt({ userId: A }, { appUrl, clientId: "fake-client" });
    const receipt = await begin(attempt.transaction);
    expect((await consume(attempt.transaction)).id).toBe(receipt.id);
  });
});

describe("SQL role and execution boundaries", () => {
  it("keeps all three helpers invoker-only, search-path-hardened, and service-only", async () => {
    await db.exec("reset role");
    for (const signature of [BEGIN_SIGNATURE, CONSUME_SIGNATURE, VALIDATE_SIGNATURE]) {
      const result = await db.query<{ elevated: boolean; config: string[]; service: boolean; browser: boolean; anon: boolean; helper: boolean }>(`
        select p.prosecdef as elevated, p.proconfig as config,
          has_function_privilege('service_role',p.oid,'EXECUTE') as service,
          has_function_privilege('authenticated',p.oid,'EXECUTE') as browser,
          has_function_privilege('anon',p.oid,'EXECUTE') as anon,
          has_function_privilege('orbitos_rpc',p.oid,'EXECUTE') as helper
        from pg_proc p where p.oid=$1::regprocedure`, [signature]);
      expect(result.rows[0]).toMatchObject({ elevated: false, service: true, browser: false, anon: false, helper: false });
      expect(result.rows[0]!.config).toContain('search_path=""');
    }
  });

  it.each(["anon", "authenticated", "orbitos_rpc"])("denies %s actual calls and private reads", async (role) => {
    const transaction = pending();
    await begin(transaction);
    await db.exec(`reset role; set role ${role}`);
    await expect(begin(transaction)).rejects.toMatchObject({ code: "42501" });
    await expect(consume(transaction)).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select * from private.google_oauth_transactions")).rejects.toMatchObject({ code: "42501" });
  });

  it("keeps receipts in UTC despite the caller timezone", async () => {
    await db.exec("set timezone='Pacific/Auckland'");
    try {
      const transaction = pending();
      expect((await begin(transaction)).expires_at).toMatch(/\+00:00$/);
      expect((await consume(transaction)).consumed_at).toMatch(/\+00:00$/);
    } finally { await db.exec("set timezone='UTC'"); }
  });

  it("rolls back consumption with its surrounding transaction", async () => {
    const transaction = pending();
    const receipt = await begin(transaction);
    await db.exec("begin");
    await consume(transaction);
    await db.exec("rollback");
    expect((await consume(transaction)).id).toBe(receipt.id);
  });

  it("checks the real clock after the row-lock statement in the installed function", async () => {
    const definition = (await db.query<{ definition: string }>("select pg_get_functiondef($1::regprocedure) as definition", [CONSUME_SIGNATURE])).rows[0]!.definition;
    expect(definition.indexOf("for update;")).toBeGreaterThan(0);
    expect(definition.indexOf("v_now := pg_catalog.clock_timestamp()"))
      .toBeGreaterThan(definition.indexOf("for update;"));
    // This structural assertion is not a two-session concurrency test.
  });
});
