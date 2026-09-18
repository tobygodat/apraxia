// Real PostgreSQL sessions, not PGlite or concurrent promises over one connection.
// Run only after migrations have been applied to disposable local Supabase:
//   node scripts/check-oauth-concurrency.mjs
// No connection URL, credentials, remote Docker host, or target override is accepted.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROJECT = "apraxia";
const CONTAINER = "supabase_db_apraxia";
const REDIRECT = "http://localhost:3000/api/calendar/callback";
const QUERY_TIMEOUT_MS = 20_000;
const OUTPUT_LIMIT = 65_536;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CheckError extends Error {}

function check(condition, message) {
  if (!condition) throw new CheckError(message);
}

export function assertLocalDockerEndpoint(endpoint) {
  check(
    typeof endpoint === "string" &&
      (/^npipe:\/\/\/\/\.\/pipe\/[a-z0-9_.-]+$/i.test(endpoint) ||
        /^unix:\/\/\/[^\s\0]+$/.test(endpoint)),
    "Refusing a Docker endpoint that is not a local named pipe or Unix socket.",
  );
  return endpoint;
}

export function assertLocalContainer(container) {
  const checks = {
    name: container?.name === `/${CONTAINER}`,
    running: container?.running === true,
    id: /^[a-f0-9]{64}$/.test(container?.id ?? ""),
    project: container?.labels?.["com.supabase.cli.project"] === PROJECT,
    // Registry prefixes the Supabase CLI has pulled this image from. The
    // alternation is anchored and the repository path is fixed, so a prefix
    // spelled inside a hostile image reference still fails.
    image: /^(?:public\.ecr\.aws\/|docker\.io\/|ghcr\.io\/)?supabase\/postgres:17\./.test(
      container?.image ?? "",
    ),
  };
  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([field]) => field);
  // Only these non-secret identity fields may enter diagnostics. Never log
  // the full Docker inspect response, labels, environment, or child stderr.
  const identity = {
    name: container?.name,
    running: container?.running,
    project: container?.labels?.["com.supabase.cli.project"],
    image: container?.image,
  };
  check(
    failed.length === 0,
    `Refusing a container that is not the running apraxia local Supabase PostgreSQL 17 instance. Mismatched: ${failed.join(", ")}. Identity: ${JSON.stringify(identity)}`,
  );
  return container.id;
}

export function assertDatabaseIdentity(identity) {
  check(
    identity?.database === "postgres" &&
      identity?.user === "postgres" &&
      identity?.socket === true &&
      Number.isInteger(identity?.version) &&
      identity.version >= 170000 &&
      identity.version < 180000 &&
      identity?.migration === true &&
      identity?.begin_function === true &&
      identity?.consume_function === true,
    "Local database identity, PostgreSQL version, or migration 005 does not match; no fixtures were written.",
  );
}

// Never include stdout/stderr or child-process error messages in thrown errors.
// Docker metadata is narrowly projected; environment values are not inspected.
async function dockerOutput(args, timeoutMs = 10_000) {
  return await new Promise((resolve, reject) => {
    const child = spawn("docker", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let bytes = 0;
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        reject(error);
      } else resolve(stdout.trim());
    };
    const timer = setTimeout(
      () => finish(new CheckError("Local Docker inspection timed out.")),
      timeoutMs,
    );
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > OUTPUT_LIMIT)
        return finish(new CheckError("Local Docker inspection exceeded its output limit."));
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > OUTPUT_LIMIT)
        finish(new CheckError("Local Docker inspection exceeded its output limit."));
    });
    child.on("error", () => finish(new CheckError("Unable to run local Docker inspection.")));
    child.on("close", (code) =>
      finish(code === 0 ? undefined : new CheckError("Local Docker inspection failed.")),
    );
  });
}

class PgSession {
  constructor(dockerArgs, containerId, applicationName) {
    this.applicationName = applicationName;
    this.pending = null;
    this.buffer = "";
    this.closed = false;
    this.child = spawn(
      "docker",
      [
        ...dockerArgs,
        "exec",
        "-i",
        "-e",
        `PGAPPNAME=${applicationName}`,
        "-e",
        "PGCONNECT_TIMEOUT=5",
        "-e",
        "PGOPTIONS=-c statement_timeout=15000 -c lock_timeout=12000 -c idle_in_transaction_session_timeout=20000",
        containerId,
        "psql",
        "-X",
        "-q",
        "-A",
        "-t",
        "-w",
        "-h",
        "/var/run/postgresql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=off",
        "-P",
        "pager=off",
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.exited = new Promise((resolve) => this.child.once("close", () => resolve()));
    this.child.stdout.on("data", (chunk) => this.read(chunk));
    this.child.stderr.on("data", (chunk) => {
      // Expected rejection details can include SQL context. Retain none of it.
      if (this.pending) {
        this.pending.bytes += chunk.length;
        if (this.pending.bytes > OUTPUT_LIMIT)
          this.fail("PostgreSQL session exceeded its output limit.");
      }
    });
    this.child.stdin.on("error", () => this.fail("PostgreSQL session input failed."));
    this.child.on("error", () => this.fail("Unable to launch a local PostgreSQL session."));
    this.child.on("close", () => {
      this.closed = true;
      this.fail("Local PostgreSQL session closed before acknowledgement.");
    });
  }

  fail(message) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(new CheckError(message));
    this.pending = null;
  }

  read(chunk) {
    if (!this.pending) return;
    this.pending.bytes += chunk.length;
    if (this.pending.bytes > OUTPUT_LIMIT) {
      this.fail("PostgreSQL session exceeded its output limit.");
      this.child.kill();
      return;
    }
    this.buffer += chunk.toString("utf8");
    let newline;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      const pending = this.pending;
      if (!pending) return;
      if (line.startsWith(`${pending.marker} `)) {
        const state = line.slice(pending.marker.length + 1);
        if (!/^[A-Z0-9]{5}$/.test(state)) {
          this.fail("PostgreSQL returned an invalid acknowledgement.");
          return;
        }
        clearTimeout(pending.timer);
        this.pending = null;
        pending.resolve({ state, lines: pending.lines });
      } else if (line.trim() !== "") pending.lines.push(line);
    }
  }

  query(sql, timeoutMs = QUERY_TIMEOUT_MS) {
    check(
      !this.closed && !this.pending,
      "PostgreSQL session is unavailable or already running a statement.",
    );
    const marker = `apraxia_${randomBytes(12).toString("hex")}`;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail("Local PostgreSQL statement acknowledgement timed out.");
        this.child.kill();
      }, timeoutMs);
      this.pending = { marker, resolve, reject, timer, bytes: 0, lines: [] };
      // Every call supplies ONE statement. SQLSTATE therefore belongs to it,
      // not a later successful statement. psql's error text is never printed.
      this.child.stdin.write(`${sql}\n\\echo ${marker} :SQLSTATE\n`);
    });
    // A deliberately blocked query may fail while the observer is still running.
    // The caller will inspect that failure; avoid an unhandled rejection meanwhile.
    void promise.catch(() => {});
    return promise;
  }

  async ok(sql) {
    const result = await this.query(sql);
    check(
      result.state === "00000",
      "An unexpected PostgreSQL statement failure occurred (details suppressed).",
    );
    return result.lines;
  }

  async json(sql) {
    const lines = await this.ok(sql);
    check(lines.length === 1, "Expected exactly one PostgreSQL JSON result.");
    try {
      return JSON.parse(lines[0]);
    } catch {
      throw new CheckError("Invalid PostgreSQL JSON result.");
    }
  }

  async connect() {
    const result = await this.json(
      "select jsonb_build_object('pid',pg_backend_pid(),'application',current_setting('application_name'));",
    );
    check(
      Number.isInteger(result.pid) && result.pid > 0 && result.application === this.applicationName,
      "PostgreSQL session identity did not match.",
    );
    this.pid = result.pid;
    await this.ok("set timezone = 'UTC';");
  }

  async close() {
    if (this.closed) return;
    this.child.stdin.end("\\quit\n");
    await Promise.race([this.exited, wait(2_000)]);
    if (!this.closed) this.child.kill();
  }
}

function consumeSql(userId, hash) {
  return `select public.consume_calendar_oauth_transaction('${userId}','${hash}','${REDIRECT}');`;
}

async function beginConsumer(session) {
  await session.ok("begin isolation level read committed;");
  await session.ok("set local role service_role;");
}

function receiptFrom(result, expectedId) {
  check(
    result.state === "00000" && result.lines.length === 1,
    "Expected a successful consume receipt.",
  );
  let receipt;
  try {
    receipt = JSON.parse(result.lines[0]);
  } catch {
    throw new CheckError("Invalid consume receipt.");
  }
  check(
    receipt.id === expectedId &&
      typeof receipt.consumed_at === "string" &&
      Object.keys(receipt).sort().join(",") === "consumed_at,id",
    "Unexpected consume receipt fields.",
  );
  return receipt;
}

async function observeBlocked(admin, blocker, waiter, transactionId, requireUnexpired = false) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await admin.json(`select jsonb_build_object(
      'blocked', ${blocker.pid} = any(pg_blocking_pids(${waiter.pid})),
      'locking', (select wait_event_type = 'Lock' from pg_stat_activity where pid=${waiter.pid}),
      'started_before_expiry', (select query_start < tx.expires_at from pg_stat_activity where pid=${waiter.pid}),
      'unexpired', clock_timestamp() < tx.expires_at,
      'unconsumed', tx.consumed_at is null
    ) from private.google_oauth_transactions tx where tx.id='${transactionId}';`);
    if (state.blocked && state.locking) {
      check(
        state.unconsumed === true,
        "An uncommitted consume became visible to an independent session.",
      );
      if (requireUnexpired)
        check(
          state.unexpired && state.started_before_expiry,
          "Expiry test did not establish the lock wait before expiry; refusing a false pass.",
        );
      return;
    }
    await wait(40);
  }
  throw new CheckError("A real cross-session PostgreSQL row-lock wait was not observed.");
}

async function verifyPersisted(admin, id, receipt) {
  const persisted = await admin.json(`select jsonb_build_object('id',id,'consumed_at',consumed_at)
    from private.google_oauth_transactions where id='${id}';`);
  check(
    persisted.id === id && persisted.consumed_at === (receipt?.consumed_at ?? null),
    "Committed OAuth transaction state did not match the expected result.",
  );
}

export async function runConcurrencyCheck() {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  check(
    /^project_id\s*=\s*"apraxia"\s*$/m.test(config) && /^major_version\s*=\s*17\s*$/m.test(config),
    "This runner is restricted to the apraxia PostgreSQL 17 local project.",
  );
  // Resolve then explicitly pin a local endpoint; subsequent operations cannot
  // be redirected by DOCKER_HOST/DOCKER_CONTEXT or a changed active context.
  const context = await dockerOutput(["context", "show"]);
  check(/^[a-zA-Z0-9_.-]+$/.test(context), "Invalid local Docker context name.");
  let endpoint;
  try {
    endpoint = JSON.parse(
      await dockerOutput([
        "context",
        "inspect",
        context,
        "--format",
        "{{json .Endpoints.docker.Host}}",
      ]),
    );
  } catch {
    throw new CheckError("Could not inspect the local Docker endpoint.");
  }
  assertLocalDockerEndpoint(endpoint);
  const dockerArgs = ["--host", endpoint];
  let container;
  try {
    container = JSON.parse(
      await dockerOutput([
        ...dockerArgs,
        "inspect",
        CONTAINER,
        "--format",
        '{"name":{{json .Name}},"id":{{json .Id}},"running":{{json .State.Running}},"labels":{{json .Config.Labels}},"image":{{json .Config.Image}}}',
      ]),
    );
  } catch {
    throw new CheckError("The expected local Supabase database container is unavailable.");
  }
  const containerId = assertLocalContainer(container);
  const runId = randomUUID();
  const userId = randomUUID();
  const email = `oauth-concurrency-${userId}@example.test`;
  const hashes = Array.from({ length: 3 }, () => randomBytes(32).toString("hex"));
  const sessions = [];
  let admin;
  let fixturesAttempted = false;
  let failure;
  let cleanupFailed = false;
  let stage = "database preflight";
  const passed = [];

  try {
    admin = new PgSession(dockerArgs, containerId, `oauth-check-${runId}-observer`);
    sessions.push(admin);
    await admin.connect();
    const identity = await admin.json(`select jsonb_build_object(
      'database',current_database(),'user',current_user,'socket',inet_server_addr() is null,
      'version',current_setting('server_version_num')::integer,
      'migration',exists(select 1 from supabase_migrations.schema_migrations where version='20260903000500'),
      'begin_function',to_regprocedure('public.begin_calendar_oauth_transaction(uuid,text,text,timestamptz)') is not null,
      'consume_function',to_regprocedure('public.consume_calendar_oauth_transaction(uuid,text,text)') is not null);`);
    assertDatabaseIdentity(identity);
    console.log(
      "Verified local apraxia container, Unix-socket postgres connection, PostgreSQL 17, and migration 005.",
    );
    const first = new PgSession(dockerArgs, containerId, `oauth-check-${runId}-first`);
    const second = new PgSession(dockerArgs, containerId, `oauth-check-${runId}-second`);
    sessions.push(first, second);
    await first.connect();
    await second.connect();
    check(
      new Set(sessions.map((session) => session.pid)).size === 3,
      "The consumers and observer must use independent PostgreSQL backend sessions.",
    );
    stage = "fixture creation";
    fixturesAttempted = true;
    await admin.ok(`insert into auth.users(id,email) values ('${userId}','${email}');`);

    const createTransaction = async (hash, lifetimeSeconds = 60) => {
      await admin.ok("begin;");
      await admin.ok("set local role service_role;");
      const receipt = await admin.json(`select public.begin_calendar_oauth_transaction(
        '${userId}','${hash}','${REDIRECT}',clock_timestamp()+interval '${lifetimeSeconds} seconds');`);
      check(/^[a-f0-9-]{36}$/.test(receipt.id ?? ""), "Invalid created transaction identifier.");
      await admin.ok("commit;");
      return receipt.id;
    };

    // Winner holds an actual UPDATE lock until the other backend is observed
    // waiting on it. Its receipt alone is not treated as committed consumption.
    stage = "concurrent committed winner";
    const winnerId = await createTransaction(hashes[0]);
    await beginConsumer(first);
    const winner = receiptFrom(await first.query(consumeSql(userId, hashes[0])), winnerId);
    await beginConsumer(second);
    const loserAttempt = second.query(consumeSql(userId, hashes[0]));
    await observeBlocked(admin, first, second, winnerId);
    await first.ok("commit;");
    check(
      (await loserAttempt).state === "22023",
      "The concurrent losing consumer was not rejected with SQLSTATE 22023.",
    );
    await second.ok("rollback;");
    await verifyPersisted(admin, winnerId, winner);
    passed.push("concurrent consumers: one committed winner, one 22023 rejection");

    // A non-mutating lock holder leaves the original row intact, so this proves
    // the waiter checks wall-clock expiry AFTER acquiring its lock.
    stage = "lock wait beyond expiry";
    const expiryId = await createTransaction(hashes[1], 5);
    await beginConsumer(first);
    await first.ok(
      `select id from private.google_oauth_transactions where id='${expiryId}' for update;`,
    );
    await beginConsumer(second);
    const expiredAttempt = second.query(consumeSql(userId, hashes[1]));
    await observeBlocked(admin, first, second, expiryId, true);
    await admin.ok(`select pg_sleep(greatest(0,extract(epoch from expires_at-clock_timestamp()))+0.15)
      from private.google_oauth_transactions where id='${expiryId}';`);
    const expiryProof = await admin.json(`select jsonb_build_object(
      'expired',clock_timestamp()>expires_at,
      'still_blocked',${first.pid}=any(pg_blocking_pids(${second.pid})),
      'started_before_expiry',(select query_start<tx.expires_at from pg_stat_activity where pid=${second.pid})
      ) from private.google_oauth_transactions tx where tx.id='${expiryId}';`);
    check(
      expiryProof.expired && expiryProof.still_blocked && expiryProof.started_before_expiry,
      "The expiry boundary was not crossed while the original consume statement remained blocked.",
    );
    await first.ok("commit;");
    check(
      (await expiredAttempt).state === "22023",
      "The consumer released after expiry was not rejected with SQLSTATE 22023.",
    );
    await second.ok("rollback;");
    await verifyPersisted(admin, expiryId, null);
    passed.push("lock wait crosses expiry: 22023 rejection and state remains unconsumed");

    stage = "rollback releases waiting consumer";
    const rollbackId = await createTransaction(hashes[2]);
    await beginConsumer(first);
    receiptFrom(await first.query(consumeSql(userId, hashes[2])), rollbackId);
    await beginConsumer(second);
    const retryAttempt = second.query(consumeSql(userId, hashes[2]));
    await observeBlocked(admin, first, second, rollbackId, true);
    await first.ok("rollback;");
    const retry = receiptFrom(await retryAttempt, rollbackId);
    await second.ok("commit;");
    await verifyPersisted(admin, rollbackId, retry);
    passed.push("first consumer rolls back: waiting consumer succeeds and commits");
  } catch (error) {
    // Only this module's deliberately sanitized messages are retained.
    failure = new CheckError(
      `${stage}: ${
        error instanceof CheckError
          ? error.message
          : "Unexpected verification failure; details suppressed."
      }`,
    );
  } finally {
    if (admin && !admin.closed && fixturesAttempted) {
      try {
        if (!admin.pending) await admin.ok("rollback;");
        // Exact backend identity plus an unguessable application tag prevents
        // terminating an unrelated connection, even if a backend PID was reused.
        for (const session of sessions.slice(1)) {
          if (session.pid && !session.closed)
            await admin.ok(`select pg_terminate_backend(pid) from pg_stat_activity
            where pid=${session.pid} and application_name='${session.applicationName}';`);
        }
        await admin.ok(`delete from private.google_oauth_transactions where user_id='${userId}'
          and state_hash in (${hashes.map((hash) => `'${hash}'`).join(",")});`);
        await admin.ok(`delete from auth.users where id='${userId}' and email='${email}';`);
        const remaining = await admin.json(`select jsonb_build_object(
          'users',(select count(*) from auth.users where id='${userId}'),
          'transactions',(select count(*) from private.google_oauth_transactions where user_id='${userId}'));`);
        check(
          remaining.users === 0 && remaining.transactions === 0,
          "Fixture cleanup verification failed.",
        );
      } catch {
        cleanupFailed = true;
      }
    } else if (fixturesAttempted) cleanupFailed = true;
    for (const session of sessions.toReversed()) await session.close();
  }
  if (cleanupFailed)
    throw new CheckError(
      "OAuth concurrency check could not verify cleanup of its unique local fixtures; inspect the disposable local stack before rerunning.",
    );
  if (failure) throw failure;
  for (const result of passed) console.log(`PASS ${result}`);
  console.log(
    "PASS cleanup: this run's fake Auth user and three OAuth transactions removed; no other data touched.",
  );
  return { scenarios: passed.length, cleanup: true };
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  if (process.argv.length !== 2) {
    console.error("This local-only runner accepts no arguments or connection overrides.");
    process.exitCode = 1;
  } else {
    try {
      await runConcurrencyCheck();
    } catch (error) {
      // Never print unexpected exceptions: a child error can contain its args.
      console.error(
        error instanceof CheckError
          ? `FAIL ${error.message}`
          : "FAIL local OAuth concurrency verification. Confirm the local stack/migrations are ready; database details are suppressed.",
      );
      process.exitCode = 1;
    }
  }
}
