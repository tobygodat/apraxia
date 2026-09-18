import { storageHarnessSql } from "../helpers/storageHarness";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// One account per test: the suite shares a single migrated database, so
// replaying nineteen migrations per case cannot push a case past its timeout.
const SPAWN_OWNER = "11111111-1111-4111-8111-111111111111";
const RULE_OWNER = "22222222-2222-4222-8222-222222222222";
const ONLOOKER = "33333333-3333-4333-8333-333333333333";
const UNDO_OWNER = "44444444-4444-4444-8444-444444444444";
const ANCHOR_OWNER = "55555555-5555-4555-8555-555555555555";
const OWNERS = [SPAWN_OWNER, RULE_OWNER, ONLOOKER, UNDO_OWNER, ANCHOR_OWNER];

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
  for (const owner of OWNERS) await db.query("insert into auth.users(id) values ($1)", [owner]);
  return db;
}

describe("recurring tasks", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await migrated();
  }, 120_000);

  afterEach(async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  });

  afterAll(async () => {
    await db.close();
  });

  async function signIn(userId: string): Promise<void> {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await db.exec("set role authenticated");
  }

  /** Every open occurrence the signed-in account can see, oldest first. */
  async function openDueDates(): Promise<string[]> {
    const rows = await db.query<{ due_date: string }>(
      "select due_date::text from todos where not completed and deleted_at is null order by due_date",
    );
    return rows.rows.map((row) => row.due_date);
  }

  /** How many days the month of an ISO date has. */
  function lastDayOfMonth(date: string): number {
    return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  }

  async function localToday(): Promise<string> {
    const rows = await db.query<{ today: string }>(
      "select (statement_timestamp() at time zone 'America/New_York')::date::text as today",
    );
    return rows.rows[0]!.today;
  }

  it("creates the next occurrence on completion, once, and never past the end date", async () => {
    await signIn(SPAWN_OWNER);
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

    const started = Date.now();
    await db.query("update todos set completed = true where id = $1", [seed!.id]);
    // Six years of missed Mondays are stepped over by arithmetic, not by one
    // loop iteration each, so an abandoned series still completes at once.
    expect(Date.now() - started).toBeLessThan(1000);
    const [next] = await openDueDates();
    // A weekly task completed years late lands on the next future Monday, not
    // on the Monday that has already gone by.
    expect(next! >= (await localToday())).toBe(true);
    expect(new Date(`${next!}T00:00:00Z`).getUTCDay()).toBe(1);

    const carried = (
      await db.query<{
        due_time: string;
        freq: string;
        interval: number;
        series: string;
        spawned: string | null;
      }>(
        "select due_time::text, recurrence_freq::text as freq, recurrence_interval as interval, recurrence_series_id::text as series, recurrence_spawned_id::text as spawned from todos where not completed",
      )
    ).rows[0]!;
    expect(carried).toMatchObject({
      due_time: "09:00:00",
      freq: "weekly",
      interval: 1,
      series: seed!.series,
      spawned: null,
    });
    // The completed occurrence names the one it created.
    expect(
      (
        await db.query(
          "select recurrence_spawned_id is not null as linked from todos where id = $1",
          [seed!.id],
        )
      ).rows,
    ).toEqual([{ linked: true }]);

    // The end date stops the series instead of producing one occurrence past it.
    await db.exec(
      "update todos set recurrence_until = due_date where not completed and deleted_at is null",
    );
    await db.exec("update todos set completed = true where not completed and deleted_at is null");
    expect(await openDueDates()).toEqual([]);
  });

  it("withdraws the occurrence an undone completion created, unless it was edited", async () => {
    await signIn(UNDO_OWNER);
    await db.exec(
      "insert into todos(text,due_date,recurrence_freq) values ('Reading','2020-03-02','weekly')",
    );
    const id = (await db.query<{ id: string }>("select id::text from todos")).rows[0]!.id;

    await db.query("update todos set completed = true where id = $1", [id]);
    const [successor] = await openDueDates();
    expect(successor).toBeDefined();

    // Undoing the completion has to leave exactly one occurrence open again.
    await db.query("update todos set completed = false where id = $1", [id]);
    expect(await openDueDates()).toEqual(["2020-03-02"]);
    // Re-completing produces one successor, not a second alongside the first.
    await db.query("update todos set completed = true where id = $1", [id]);
    expect(await openDueDates()).toEqual([successor]);

    // A successor the user has already changed outranks the bookkeeping, so it
    // survives the undo, and re-completing still cannot produce a third.
    await db.exec("update todos set text = 'Reading, chapter 4' where not completed");
    await db.query("update todos set completed = false where id = $1", [id]);
    expect(await openDueDates()).toEqual(["2020-03-02", successor!]);
    await db.query("update todos set completed = true where id = $1", [id]);
    expect(await openDueDates()).toEqual([successor]);
  });

  it("measures every occurrence from where the series started", async () => {
    await signIn(ANCHOR_OWNER);
    // A monthly task anchored on a day later months are short of must come back
    // to it rather than ratcheting earlier once February has clamped it.
    await db.exec(
      "insert into todos(text,due_date,recurrence_freq) values ('Rent','2026-01-31','monthly')",
    );
    const dates: string[] = [];
    for (let occurrence = 0; occurrence < 6; occurrence += 1) {
      await db.exec("update todos set completed = true where not completed and deleted_at is null");
      const [due] = await openDueDates();
      if (due === undefined) break;
      dates.push(due);
    }
    expect(dates).toHaveLength(6);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[0]! >= (await localToday())).toBe(true);
    // An anchor on the 31st means every occurrence is the last day of its month:
    // February clamps, and the month after it is back on the 31st.
    expect(dates.map((due) => Number(due.slice(8)))).toEqual(dates.map(lastDayOfMonth));
    expect(dates.map(lastDayOfMonth)).toContain(31);
    expect(dates.map(lastDayOfMonth).some((day) => day < 31)).toBe(true);
    expect(
      (await db.query("select distinct recurrence_anchor_date::text as anchor from todos")).rows,
    ).toEqual([{ anchor: "2026-01-31" }]);

    // Rescheduling a repeating task by hand re-anchors its series.
    await db.exec(
      "update todos set due_date = (current_date + 400) where not completed and deleted_at is null",
    );
    expect(
      (
        await db.query(
          "select recurrence_anchor_date = due_date as reanchored from todos where not completed and deleted_at is null",
        )
      ).rows,
    ).toEqual([{ reanchored: true }]);
  });

  it("keeps the rule owner-scoped, database-owned, and anchored on a due date", async () => {
    await signIn(RULE_OWNER);
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
    for (const [column, value] of [
      ["recurrence_series_id", "gen_random_uuid()"],
      ["recurrence_anchor_date", "'2026-01-01'"],
      ["recurrence_spawned_id", "gen_random_uuid()"],
    ])
      await expect(
        db.exec(
          `insert into todos(text,due_date,recurrence_freq,${column}) values ('Forged','2026-09-18','weekly',${value})`,
        ),
      ).rejects.toThrow(/permission denied/);

    await db.exec(
      "insert into todos(text,due_date,recurrence_freq) values ('Reading','2026-09-18','daily')",
    );
    // Dropping the rule drops the series and the anchor with it; the interval
    // defaults to one.
    expect(
      (
        await db.query(
          "select recurrence_interval as interval, recurrence_series_id is not null as linked, recurrence_anchor_date::text as anchor from todos",
        )
      ).rows,
    ).toEqual([{ interval: 1, linked: true, anchor: "2026-09-18" }]);
    await db.exec("update todos set recurrence_freq = null");
    expect(
      (
        await db.query(
          "select recurrence_interval as interval, recurrence_series_id as series, recurrence_until as until, recurrence_anchor_date as anchor from todos",
        )
      ).rows,
    ).toEqual([{ interval: null, series: null, until: null, anchor: null }]);

    // The elevated insert derives its owner from the completed row, so another
    // account can neither see the series nor complete into its own.
    await db.exec("update todos set recurrence_freq = 'weekly' where text = 'Reading'");
    await signIn(ONLOOKER);
    expect((await db.query("select * from todos")).rows).toEqual([]);
    await signIn(RULE_OWNER);
    await db.exec("update todos set completed = true where text = 'Reading'");
    expect((await db.query("select distinct user_id::text as owner from todos")).rows).toEqual([
      { owner: RULE_OWNER },
    ]);
  });
});
