import { storageHarnessSql } from "../helpers/storageHarness";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

async function migrated(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`create role anon nologin noinherit; create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls; create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;`);
  await db.exec(storageHarnessSql);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  await db.query("insert into auth.users(id) values ($1), ($2)", [ALICE, BOB]);
  return db;
}

async function signIn(db: PGlite, userId: string): Promise<void> {
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userId}'`);
}

/** Every open occurrence of one repeating task, oldest first. */
async function openDueDates(db: PGlite): Promise<string[]> {
  const rows = await db.query<{ due_date: string }>(
    "select due_date::text from todos where not completed and deleted_at is null order by due_date",
  );
  return rows.rows.map((row) => row.due_date);
}

it("creates the next occurrence on completion, once, and never past the end date", async () => {
  const db = await migrated();
  try {
    await signIn(db, ALICE);
    // Anchored in the past so the trigger must step forward, not repeat a date.
    await db.exec(
      "insert into todos(text,due_date,due_time,recurrence_freq,recurrence_interval) values ('Problem set','2020-03-02','09:00','weekly',1)",
    );
    const [seed] = (
      await db.query<{ id: string; series: string }>(
        "select id::text, recurrence_series_id::text as series from todos",
      )
    ).rows;
    expect(seed?.series).toMatch(/^[0-9a-f-]{36}$/);

    await db.query("update todos set completed = true where id = $1", [seed!.id]);
    const [next] = await openDueDates(db);
    const today = (
      await db.query<{ today: string }>(
        "select (statement_timestamp() at time zone 'America/New_York')::date::text as today",
      )
    ).rows[0]!.today;
    // A weekly task completed years late lands on the next future Monday, not
    // on the Monday that has already gone by.
    expect(next! >= today).toBe(true);
    expect(new Date(`${next!}T00:00:00Z`).getUTCDay()).toBe(1);

    const carried = (
      await db.query<{
        due_time: string;
        freq: string;
        interval: number;
        series: string;
        spawned: string | null;
      }>(
        "select due_time::text, recurrence_freq::text as freq, recurrence_interval as interval, recurrence_series_id::text as series, recurrence_spawned_at::text as spawned from todos where not completed",
      )
    ).rows[0]!;
    expect(carried).toMatchObject({
      due_time: "09:00:00",
      freq: "weekly",
      interval: 1,
      series: seed!.series,
      spawned: null,
    });

    // Unchecking and rechecking the same occurrence must not spawn a second one.
    await db.query("update todos set completed = false where id = $1", [seed!.id]);
    await db.query("update todos set completed = true where id = $1", [seed!.id]);
    expect(await openDueDates(db)).toHaveLength(1);

    // The end date stops the series instead of producing one occurrence past it.
    await db.exec(
      "update todos set recurrence_until = due_date where not completed and deleted_at is null",
    );
    await db.exec("update todos set completed = true where not completed and deleted_at is null");
    expect(await openDueDates(db)).toEqual([]);
  } finally {
    await db.close();
  }
});

it("keeps the rule owner-scoped, database-owned, and anchored on a due date", async () => {
  const db = await migrated();
  try {
    await signIn(db, ALICE);
    await expect(
      db.exec("insert into todos(text,recurrence_freq) values ('No anchor','weekly')"),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.exec(
        "insert into todos(text,due_date,recurrence_freq,recurrence_interval) values ('Too often','2026-09-18','daily',0)",
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.exec(
        "insert into todos(text,due_date,recurrence_freq,recurrence_until) values ('Ends first','2026-09-18','weekly','2026-09-01')",
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.exec(
        "insert into todos(text,due_date,recurrence_freq,recurrence_series_id) values ('Forged series','2026-09-18','weekly',gen_random_uuid())",
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec(
        "insert into todos(text,due_date,recurrence_freq,recurrence_spawned_at) values ('Pre-spawned','2026-09-18','weekly',now())",
      ),
    ).rejects.toThrow(/permission denied/);

    await db.exec(
      "insert into todos(text,due_date,recurrence_freq) values ('Reading','2026-09-18','daily')",
    );
    // Dropping the rule drops the series with it; the interval defaults to one.
    expect(
      (
        await db.query(
          "select recurrence_interval as interval, recurrence_series_id is not null as linked from todos",
        )
      ).rows,
    ).toEqual([{ interval: 1, linked: true }]);
    await db.exec("update todos set recurrence_freq = null");
    expect(
      (
        await db.query(
          "select recurrence_interval as interval, recurrence_series_id as series, recurrence_until as until from todos",
        )
      ).rows,
    ).toEqual([{ interval: null, series: null, until: null }]);

    // The elevated insert derives its owner from the completed row, so another
    // account can neither see the series nor complete into its own.
    await db.exec("update todos set recurrence_freq = 'weekly' where text = 'Reading'");
    await signIn(db, BOB);
    expect((await db.query("select * from todos")).rows).toEqual([]);
    await db.exec(`set request.jwt.claim.sub = '${ALICE}'`);
    await db.exec("update todos set completed = true where text = 'Reading'");
    expect((await db.query("select distinct user_id::text as owner from todos")).rows).toEqual([
      { owner: ALICE },
    ]);
  } finally {
    await db.close();
  }
});
