import { storageHarnessSql } from "../helpers/storageHarness";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// Scope: pure SQL behaviour that is cheap to run on every `npm test`. Role,
// grant, and RLS posture is asserted against real PostgreSQL by the pgTAP
// suite in `supabase/tests`, which CI runs as `Database checks`; duplicating
// it here needed a hand-built `auth` schema and doubled the suite runtime.

const repositoryRoot = process.cwd();

const supabaseHarnessSql = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema auth;

  create table auth.users (
    id uuid primary key,
    email text
  );

  create function auth.uid()
  returns uuid
  language sql
  stable
  set search_path = ''
  as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid
  $$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

async function readMigrations(): Promise<string[]> {
  const migrationsDirectory = path.join(repositoryRoot, "supabase", "migrations");
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();

  return Promise.all(names.map((name) => readFile(path.join(migrationsDirectory, name), "utf8")));
}

async function currentNewYorkDates(database: PGlite): Promise<{
  yesterday: string;
  today: string;
  tomorrow: string;
}> {
  const result = await database.query<{
    yesterday: string;
    today: string;
    tomorrow: string;
  }>(`
    with local_clock as (
      select (
        statement_timestamp() at time zone 'America/New_York'
      )::date as today
    )
    select
      (today - 1)::text as yesterday,
      today::text as today,
      (today + 1)::text as tomorrow
    from local_clock
  `);
  const dates = result.rows[0];

  if (!dates) {
    throw new Error("embedded database did not return local test dates");
  }

  return dates;
}

async function dateInTimezone(database: PGlite, timezone: string): Promise<string> {
  const result = await database.query<{ local_date: string }>(
    `select (
       statement_timestamp() at time zone $1
     )::date::text as local_date`,
    [timezone],
  );
  const localDate = result.rows[0]?.local_date;

  if (!localDate) {
    throw new Error(`embedded database did not resolve timezone ${timezone}`);
  }

  return localDate;
}

async function createMigratedDatabase(): Promise<PGlite> {
  const database = await PGlite.create();

  await database.exec(supabaseHarnessSql);
  await database.exec(storageHarnessSql);
  for (const migration of await readMigrations()) {
    await database.exec(migration);
  }

  return database;
}

describe("cloud migration SQL behavior", () => {
  // One migrated database serves every test below. Each test owns a distinct
  // Auth user, so sharing removes fourteen migration replays without letting
  // tests observe one another's rows.
  let database: PGlite;

  beforeAll(async () => {
    database = await createMigratedDatabase();
  }, 60_000);

  afterEach(async () => {
    await database.exec("reset role");
    await database.exec("set timezone = 'UTC'");
    await database.query("select set_config('request.jwt.claim.sub', '', false)");
    await database.query("select set_config('request.jwt.claims', '', false)");
  });

  afterAll(async () => {
    await database.close();
  });

  async function signIn(userId: string, email: string): Promise<void> {
    await database.query(`insert into auth.users (id, email) values ($1, $2)`, [userId, email]);
    await database.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await database.exec("set role authenticated");
  }

  it("retires Media while preserving every existing row in a private backup", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(supabaseHarnessSql);
      await db.exec(storageHarnessSql);
      const migrations = await readMigrations();
      const retirementIndex = migrations.findIndex((sql) =>
        sql.includes("lock table public.media"),
      );
      expect(retirementIndex).toBeGreaterThan(0);
      for (const migration of migrations.slice(0, retirementIndex)) await db.exec(migration);
      await db.exec(`
        insert into auth.users (id, email)
        values ('66666666-6666-4666-8666-666666666666', 'retired@example.test');
        insert into public.media (user_id, media_type, title, notes, deleted_at)
        values
          ('66666666-6666-4666-8666-666666666666', 'book', 'Saved book', 'Keep these notes', null),
          ('66666666-6666-4666-8666-666666666666', 'movie', 'Deleted film', null, now());
      `);
      const before = await db.query(
        `select to_jsonb(m) as row_data from public.media m order by id`,
      );
      // Extended-query execution requires a single statement, like the CLI.
      await db.query(migrations[retirementIndex]!);
      const after = await db.query(`select row_data from private.retired_media order by id`);
      expect(after.rows).toEqual(before.rows);
      expect((await db.query(`select to_regclass('public.media') as relation`)).rows).toEqual([
        { relation: null },
      ]);
      expect(
        (await db.query(`select enum_range(null::public.orbitos_record_type)::text as kinds`)).rows,
      ).toEqual([{ kinds: "{todo,idea,project}" }]);
      const access = await db.query<{ role_name: string; allowed: boolean }>(`
        select role_name, has_table_privilege(role_name, 'private.retired_media', 'SELECT,INSERT,UPDATE,DELETE') as allowed
        from (values ('anon'), ('authenticated'), ('service_role'), ('orbitos_rpc')) roles(role_name)
      `);
      expect(access.rows.every((row) => row.allowed === false)).toBe(true);
      await db.exec(
        `set request.jwt.claim.sub = '66666666-6666-4666-8666-666666666666'; set role authenticated;`,
      );
      expect((await db.query(`select * from public.search_records('Saved')`)).rows).toEqual([]);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("retires class PDFs while preserving every note row in a private backup", async () => {
    const db = await PGlite.create();
    try {
      await db.exec(supabaseHarnessSql);
      await db.exec(storageHarnessSql);
      const migrations = await readMigrations();
      const retirementIndex = migrations.findIndex((sql) =>
        sql.includes("lock table public.class_notes"),
      );
      expect(retirementIndex).toBeGreaterThan(0);
      for (const migration of migrations.slice(0, retirementIndex)) await db.exec(migration);
      await db.exec(`
        insert into auth.users (id, email)
        values ('77777777-7777-4777-8777-777777777777', 'pdfs@example.test');
        insert into public.classes (user_id, id, name)
        values ('77777777-7777-4777-8777-777777777777', 'math3012', 'MATH3012');
        insert into public.class_notes (user_id, course_id, name, source, drive_file_id)
        values ('77777777-7777-4777-8777-777777777777', 'math3012', 'Lecture.pdf', 'drive', 'file-1');
        insert into public.class_notes (user_id, course_id, name, source, byte_size, content_sha256)
        values ('77777777-7777-4777-8777-777777777777', 'math3012', 'Scan.pdf', 'upload', 10, repeat('a', 64));
      `);
      const before = await db.query(
        `select to_jsonb(n) - 'search_vector' as row_data from public.class_notes n order by id`,
      );
      await db.query(migrations[retirementIndex]!);
      const after = await db.query(`select row_data from private.retired_class_notes order by id`);
      expect(after.rows).toEqual(before.rows);
      expect(
        (
          await db.query(
            `select to_regclass('public.class_notes') as notes, to_regclass('public.google_drive_connections') as drive`,
          )
        ).rows,
      ).toEqual([{ notes: null, drive: null }]);
      expect(
        (await db.query(`select enum_range(null::public.search_record_type)::text as kinds`)).rows,
      ).toEqual([{ kinds: "{todo,assignment,idea,project,class,application}" }]);
      await db.exec(
        `set request.jwt.claim.sub = '77777777-7777-4777-8777-777777777777'; set role authenticated;`,
      );
      expect((await db.query(`select * from public.search_records('Lecture')`)).rows).toEqual([]);
    } finally {
      await db.close();
    }
  }, 60_000);

  it("applies in order and exposes the expected tables and functions", async () => {
    const tables = await database.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('profiles', 'projects', 'todos', 'ideas', 'media')
      order by table_name
    `);
    const publicFunctions = await database.query<{ proname: string }>(`
      select procedure.proname
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname in (
          'get_today_todos_page',
          'reorder_today_todos',
          'soft_delete_record',
          'restore_record',
          'search_records'
        )
      order by procedure.proname
    `);

    expect(tables.rows.map(({ table_name }) => table_name)).toEqual([
      "ideas",
      "profiles",
      "projects",
      "todos",
    ]);
    expect(publicFunctions.rows.map(({ proname }) => proname)).toEqual([
      "get_today_todos_page",
      "reorder_today_todos",
      "restore_record",
      "search_records",
      "soft_delete_record",
    ]);
  });

  it("pages all 2500 Today rows and confirms one scalar reorder", async () => {
    const userId = "00000000-0000-4000-8000-000000000061";
    type Page = {
      local_date: string;
      offset: number;
      total_count: number;
      snapshot_token: string;
      items: Array<{
        id: string;
        text: string;
        due_time: string | null;
        today_rank: number | null;
        project_title: string;
        is_overdue: boolean;
        is_manually_ordered: boolean;
        created_at: string;
        updated_at: string;
      }>;
    };
    const dates = await currentNewYorkDates(database);
    const page = async (offset = 0, limit: number | null = 200, token: string | null = null) => {
      const result = await database.query<{ page: Page }>(
        `select public.get_today_todos_page($1::date, $2, $3, $4) as page`,
        [dates.today, offset, limit, token],
      );
      if (!result.rows[0]) throw new Error("Page response missing.");
      return result.rows[0].page;
    };
    await signIn(userId, "pages@example.test");
    const project = await database.query<{ id: string }>(
      `insert into public.projects(title) values ('Original title') returning id`,
    );
    const projectId = project.rows[0]?.id;
    await database.query(
      `insert into public.todos (text, due_date, due_time, project_id)
         select 'Page task ' || lpad(n::text, 4, '0'), $1::date,
           case when n % 2 = 0 then time '09:00:00.123456' else null end, $2::uuid
         from generate_series(1, 2500) n`,
      [dates.today, projectId],
    );
    const first = await page();
    expect(first).toMatchObject({ local_date: dates.today, offset: 0, total_count: 2500 });
    expect(first.snapshot_token).toMatch(/^[0-9a-f]{64}$/);
    expect(first.items).toHaveLength(200);
    expect(
      first.items.every(
        (row) => row.today_rank === null && !row.is_manually_ordered && !row.is_overdue,
      ),
    ).toBe(true);
    expect(
      first.items.every(
        (row) =>
          row.due_time === "09:00:00.123456" &&
          row.created_at.endsWith("+00:00") &&
          row.updated_at.endsWith("+00:00"),
      ),
    ).toBe(true);
    // The snapshot token must describe the data, never the server session.
    await database.exec("set timezone = 'Pacific/Auckland'");
    expect((await page()).snapshot_token).toBe(first.snapshot_token);
    await database.exec("set timezone = 'UTC'");

    const collected = [...first.items];
    while (collected.length < first.total_count) {
      const next = await page(collected.length, 200, first.snapshot_token);
      expect(next.items.length).toBeGreaterThan(0);
      expect(next.items.length).toBeLessThanOrEqual(200);
      expect(next.snapshot_token).toBe(first.snapshot_token);
      collected.push(...next.items);
    }
    expect(collected).toHaveLength(2500);
    expect(new Set(collected.map((row) => row.id)).size).toBe(2500);
    expect(collected.filter((row) => row.due_time === null)).toHaveLength(1250);
    const expected = await database.query<{ id: string }>(
      `select id from internal.get_today_todos($1::date)`,
      [dates.today],
    );
    expect(collected.map((row) => row.id)).toEqual(expected.rows.map((row) => row.id));
    expect((await page(2500, 200, first.snapshot_token)).items).toEqual([]);
    for (const [offset, limit, token] of [
      [-1, 200, null],
      [0, 0, null],
      [0, 201, null],
      [0, null, null],
      [200, 200, null],
      [0, 200, "bad"],
      [2501, 200, first.snapshot_token],
    ] as const) {
      await expect(page(offset, limit, token)).rejects.toMatchObject({ code: "22023" });
    }
    await expect(page(200, 200, "0".repeat(64))).rejects.toMatchObject({ code: "40001" });
    await expect(
      database.query(`select public.get_today_todos_page($1::date)`, [dates.tomorrow]),
    ).rejects.toMatchObject({ code: "22023" });

    const ids = collected.map((row) => row.id).reverse();
    const receipt = await database.query<{ receipt: unknown }>(
      `select public.reorder_today_todos($1::date, $2::uuid[]) as receipt`,
      [dates.today, ids],
    );
    expect(receipt.rows[0]?.receipt).toEqual({
      local_date: dates.today,
      applied_count: 2500,
      rank_step: 1024,
      order_fingerprint: createHash("sha256").update(ids.join(",")).digest("hex"),
    });
    const persisted = await database.query<{ id: string; today_rank: number }>(
      `select id, today_rank from internal.get_today_todos($1::date)`,
      [dates.today],
    );
    expect(persisted.rows).toEqual(
      ids.map((id, index) => ({ id, today_rank: (index + 1) * 1024 })),
    );
    await expect(page(200, 200, first.snapshot_token)).rejects.toMatchObject({ code: "40001" });
    for (const changedIds of [ids.slice(1), [...ids.slice(0, -1), ids[0]], [...ids, null]]) {
      await expect(
        database.query(`select public.reorder_today_todos($1::date, $2::uuid[])`, [
          dates.today,
          changedIds,
        ]),
      ).rejects.toMatchObject({ code: "22023" });
    }

    // Every visible change must invalidate a multi-page snapshot, including
    // metadata-only edits and the joined project title outside the todo row.
    const mutations: Array<[string, unknown[]]> = [
      ["update public.projects set title = 'Renamed title' where id = $1", [projectId]],
      ["update public.todos set text = text where id = $1", [ids[0]]],
      ["update public.todos set due_time = '10:00:00.654321' where id = $1", [ids[0]]],
      ["update public.todos set due_date = $1::date where id = $2", [dates.tomorrow, ids[0]]],
      ["update public.todos set completed = true where id = $1", [ids[1]]],
      ["select public.soft_delete_record('todo', $1::uuid)", [ids[2]]],
      ["insert into public.todos(text,due_date) values ('New eligible', $1::date)", [dates.today]],
    ];
    for (const [sql, parameters] of mutations) {
      const before = await page();
      await database.query(sql, parameters);
      await expect(page(200, 200, before.snapshot_token)).rejects.toMatchObject({ code: "40001" });
    }
  }, 60_000);

  it("keeps Today reorder rejections and undo tokens exact", async () => {
    const userId = "00000000-0000-4000-8000-000000000011";
    const dates = await currentNewYorkDates(database);
    await signIn(userId, "reorder@example.test");

    const inserted = await database.query<{ id: string; text: string }>(
      `insert into public.todos (text, due_date)
       values ('Reorder older', $1::date), ('Reorder today', $2::date)
       returning id, text`,
      [dates.yesterday, dates.today],
    );
    const ids = new Map(inserted.rows.map(({ id, text }) => [text, id]));
    const olderId = ids.get("Reorder older");
    const todayId = ids.get("Reorder today");

    const reordered = await database.query<{ todo_id: string; today_rank: bigint }>(
      `select * from internal.reorder_today_todos($1::date, $2::uuid[])`,
      [dates.today, [todayId, olderId]],
    );
    expect(reordered.rows.map(({ todo_id }) => todo_id)).toEqual([todayId, olderId]);
    expect(reordered.rows.map(({ today_rank }) => Number(today_rank))).toEqual([1024, 2048]);

    // A reorder that omits an eligible row must not partially apply.
    await expect(
      database.query(`select * from internal.reorder_today_todos($1::date, $2::uuid[])`, [
        dates.today,
        [olderId],
      ]),
    ).rejects.toThrow(/Today list changed/i);
    const ranks = await database.query<{ id: string; today_rank: number }>(
      `select id, today_rank from public.todos
       where id = any($1::uuid[]) order by today_rank`,
      [[todayId, olderId]],
    );
    expect(ranks.rows).toEqual([
      { id: todayId, today_rank: 1024 },
      { id: olderId, today_rank: 2048 },
    ]);

    const deletion = await database.query<{ deleted_at: string }>(
      `select public.soft_delete_record('todo', $1)::text as deleted_at`,
      [olderId],
    );
    const deletionToken = deletion.rows[0]?.deleted_at;
    expect(deletionToken).toBeTypeOf("string");
    expect(
      (
        await database.query<{ restored: boolean }>(
          `select public.restore_record('todo', $1, $2::timestamptz + interval '1 second') as restored`,
          [olderId, deletionToken],
        )
      ).rows[0]?.restored,
    ).toBe(false);
    expect(
      (
        await database.query<{ restored: boolean }>(
          `select public.restore_record('todo', $1, $2) as restored`,
          [olderId, deletionToken],
        )
      ).rows[0]?.restored,
    ).toBe(true);
  });

  it("removes and deterministically re-appends todos as Today eligibility changes", async () => {
    const userId = "00000000-0000-4000-8000-000000000031";
    const dates = await currentNewYorkDates(database);
    await signIn(userId, "today@example.test");
    const inserted = await database.query<{ id: string; text: string }>(
      `insert into public.todos (text, due_date)
       values ('Overdue transition', $1::date), ('Today transition', $2::date)
       returning id, text`,
      [dates.yesterday, dates.today],
    );
    const ids = new Map(inserted.rows.map(({ id, text }) => [text, id]));
    const overdueId = ids.get("Overdue transition");
    const todayId = ids.get("Today transition");
    const todayList = async (localDate: string) =>
      (
        await database.query<{ id: string; today_rank: number | null }>(
          `select id, today_rank from internal.get_today_todos($1::date)`,
          [localDate],
        )
      ).rows;

    await database.query(`select * from internal.reorder_today_todos($1::date, $2::uuid[])`, [
      dates.today,
      [todayId, overdueId],
    ]);
    await database.query(`update public.todos set due_date = $1::date where id = $2`, [
      dates.tomorrow,
      todayId,
    ]);
    expect(await todayList(dates.today)).toEqual([{ id: overdueId, today_rank: 2048 }]);

    // Returning to Today must re-append unranked rather than restore the rank.
    await database.query(`update public.todos set due_date = $1::date where id = $2`, [
      dates.today,
      todayId,
    ]);
    expect(await todayList(dates.today)).toEqual([
      { id: overdueId, today_rank: 2048 },
      { id: todayId, today_rank: null },
    ]);

    await database.query(`update public.todos set completed = true where id = $1`, [overdueId]);
    expect((await todayList(dates.today)).map(({ id }) => id)).toEqual([todayId]);
    await database.query(`update public.todos set completed = false where id = $1`, [overdueId]);

    await expect(todayList(dates.tomorrow)).rejects.toThrow(/local date changed/i);
    await expect(
      database.query(`select * from internal.reorder_today_todos($1::date, $2::uuid[])`, [
        dates.tomorrow,
        [overdueId, todayId],
      ]),
    ).rejects.toThrow(/invalid Today reorder request/i);
    expect(await todayList(dates.today)).toEqual([
      { id: overdueId, today_rank: null },
      { id: todayId, today_rank: null },
    ]);
  });

  it("honors profile timezone changes and removes stale Today ranks", async () => {
    const userId = "00000000-0000-4000-8000-000000000041";
    const forwardTimezone = "Pacific/Kiritimati";
    const backwardTimezone = "Etc/GMT+12";
    const forwardDate = await dateInTimezone(database, forwardTimezone);
    const backwardDate = await dateInTimezone(database, backwardTimezone);
    expect(forwardDate).not.toBe(backwardDate);

    await signIn(userId, "timezone@example.test");
    await database.query(`update public.profiles set timezone = $1`, [forwardTimezone]);
    const inserted = await database.query<{ id: string }>(
      `insert into public.todos (text, due_date)
       values ('Timezone boundary todo', $1::date) returning id`,
      [forwardDate],
    );
    const todoId = inserted.rows[0]?.id;

    await database.query(`select * from internal.reorder_today_todos($1::date, $2::uuid[])`, [
      forwardDate,
      [todoId],
    ]);
    await expect(
      database.query(`select * from internal.get_today_todos($1::date)`, [backwardDate]),
    ).rejects.toThrow(/local date changed/i);

    await database.query(`update public.profiles set timezone = $1`, [backwardTimezone]);
    const afterMovingBackward = await database.query<{ today_rank: number | null }>(
      `select today_rank from public.todos where id = $1`,
      [todoId],
    );
    const backwardToday = await database.query<{ id: string }>(
      `select id from internal.get_today_todos($1::date)`,
      [backwardDate],
    );
    expect(afterMovingBackward.rows[0]?.today_rank).toBeNull();
    expect(backwardToday.rows).toEqual([]);

    await database.query(`update public.profiles set timezone = $1`, [forwardTimezone]);
    const afterMovingForward = await database.query<{ id: string; today_rank: number | null }>(
      `select id, today_rank from internal.get_today_todos($1::date)`,
      [forwardDate],
    );
    expect(afterMovingForward.rows).toEqual([{ id: todoId, today_rank: null }]);
  });
});

describe("cloud migration application", () => {
  it("rolls back an uncommitted migration batch atomically on a disposable database", async () => {
    const database = await PGlite.create();

    try {
      await database.exec(supabaseHarnessSql);
      await database.exec(storageHarnessSql);
      const defaultPrivilegesSql = `
          select
            pg_get_userbyid(default_acl.defaclrole) as owner_name,
            coalesce(namespace.nspname, '') as schema_name,
            default_acl.defaclobjtype::text as object_type,
            coalesce(default_acl.defaclacl::text, '') as acl
          from pg_catalog.pg_default_acl as default_acl
          left join pg_catalog.pg_namespace as namespace
            on namespace.oid = default_acl.defaclnamespace
          order by owner_name, schema_name, object_type, acl
        `;
      const publicSchemaAclSql = `
          select coalesce(namespace.nspacl::text, '') as acl
          from pg_catalog.pg_namespace as namespace
          where namespace.nspname = 'public'
        `;
      const defaultPrivilegesBefore = await database.query(defaultPrivilegesSql);
      const publicSchemaAclBefore = await database.query(publicSchemaAclSql);

      await database.exec("begin");
      for (const migration of await readMigrations()) {
        await database.exec(migration);
      }
      await database.exec("rollback");

      const leftovers = await database.query<{
        tables: number;
        helper_role: number;
        schemas: number;
        types: number;
        functions: number;
        auth_triggers: number;
      }>(`
          select
            (select count(*)::integer from information_schema.tables
             where table_schema in ('public', 'private')
               and table_name in (
                 'profiles', 'projects', 'todos', 'ideas', 'media',
                 'google_calendar_connections', 'google_calendar_preferences',
                 'google_calendar_credentials', 'google_oauth_transactions'
               )) as tables,
            (select count(*)::integer from pg_catalog.pg_roles
             where rolname = 'orbitos_rpc') as helper_role,
            (select count(*)::integer from pg_catalog.pg_namespace
             where nspname in ('internal', 'private')) as schemas,
            (select count(*)::integer from pg_catalog.pg_type as type
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = type.typnamespace
             where namespace.nspname = 'public'
               and type.typname in (
                 'record_source', 'media_type', 'media_status', 'project_status',
                 'google_calendar_connection_state', 'orbitos_record_type'
               )) as types,
            (select count(*)::integer from pg_catalog.pg_proc as procedure
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = procedure.pronamespace
             where namespace.nspname in ('public', 'internal', 'private')
               and procedure.proname in (
                 'request_user_id', 'lock_today_order', 'set_updated_at',
                 'validate_profile_timezone', 'sync_todo_state',
                 'validate_active_project_reference',
                 'clear_ineligible_ranks_after_timezone_change', 'handle_new_user',
                 'get_today_todos_page', 'reorder_today_todos',
                 'soft_delete_record', 'restore_record', 'search_records'
               )) as functions,
            (select count(*)::integer from pg_catalog.pg_trigger as trigger
             join pg_catalog.pg_class as class on class.oid = trigger.tgrelid
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = class.relnamespace
             where namespace.nspname = 'auth'
               and trigger.tgname = 'on_auth_user_created'
               and not trigger.tgisinternal) as auth_triggers
        `);

      expect(leftovers.rows[0]).toEqual({
        tables: 0,
        helper_role: 0,
        schemas: 0,
        types: 0,
        functions: 0,
        auth_triggers: 0,
      });
      expect((await database.query(defaultPrivilegesSql)).rows).toEqual(
        defaultPrivilegesBefore.rows,
      );
      expect((await database.query(publicSchemaAclSql)).rows).toEqual(publicSchemaAclBefore.rows);
    } finally {
      await database.close();
    }
  }, 60_000);

  it.each([
    { label: "valid microseconds", date: "9999-12-31", time: "23:59:59.999999", constraint: null },
    {
      label: "pre-existing infinite date",
      date: "-infinity",
      time: null,
      constraint: "todos_due_date_app_range",
    },
    {
      label: "pre-existing end-of-day time",
      date: "2026-09-03",
      time: "24:00:00",
      constraint: "todos_due_time_app_range",
    },
  ])(
    "validates $label without rewriting existing rows",
    async ({ date, time, constraint }) => {
      const database = await PGlite.create();
      const userId = "00000000-0000-4000-8000-000000000052";

      try {
        const migration = await readFile(
          path.join(
            repositoryRoot,
            "supabase",
            "migrations",
            "20260902000300_todo_schedule_bounds.sql",
          ),
          "utf8",
        );
        const migrations = await readMigrations();
        const boundaryIndex = migrations.indexOf(migration);
        expect(boundaryIndex).toBeGreaterThanOrEqual(0);
        await database.exec(supabaseHarnessSql);
        await database.exec(storageHarnessSql);
        for (const previous of migrations.slice(0, boundaryIndex)) {
          await database.exec(previous);
        }
        await database.query(
          `insert into auth.users (id, email) values ($1, 'existing-schedule@example.test')`,
          [userId],
        );
        await database.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
        await database.exec("set role authenticated");
        await database.query(
          `insert into public.todos (text, due_date, due_time)
           values ('Existing schedule', $1::date, $2::time)`,
          [date, time],
        );
        await database.exec("reset role");

        if (constraint === null) {
          await database.exec(migration);
        } else {
          await expect(database.exec(migration)).rejects.toMatchObject({
            code: "23514",
            constraint,
          });
        }

        const constraints = await database.query<{ count: number }>(`
          select count(*)::integer as count from pg_catalog.pg_constraint
          where conrelid = 'public.todos'::regclass
            and conname in ('todos_due_date_app_range', 'todos_due_time_app_range')
            and convalidated
        `);
        expect(constraints.rows[0]?.count).toBe(constraint === null ? 2 : 0);
        const persisted = await database.query(
          `select due_date::text, due_time::text from public.todos`,
        );
        expect(persisted.rows).toEqual([{ due_date: date, due_time: time }]);
      } finally {
        await database.close();
      }
    },
    60_000,
  );
});
