import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

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

const managedSupabaseHarnessSql = `
  create role pglite_admin login superuser;
  set session authorization pglite_admin;
  alter role postgres rename to pglite_bootstrap;
  create role postgres
    login
    inherit
    nosuperuser
    createdb
    createrole
    replication
    bypassrls;
  grant postgres to pglite_bootstrap with admin option;

  do $$
  begin
    execute format(
      'alter database %I owner to postgres',
      current_database()
    );
  end
  $$;
  alter schema public owner to postgres;

  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  create role supabase_auth_admin nologin noinherit;

  create schema auth authorization supabase_auth_admin;
  set role supabase_auth_admin;

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

  reset role;
  grant usage on schema auth to postgres, anon, authenticated, service_role;
  grant select, references, trigger on table auth.users to postgres;
  grant execute on function auth.uid()
    to postgres, anon, authenticated, service_role;

  set role postgres;
`;

async function readMigrations(): Promise<string[]> {
  const migrationsDirectory = path.join(
    repositoryRoot,
    "supabase",
    "migrations",
  );
  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  return Promise.all(
    names.map((name) => readFile(path.join(migrationsDirectory, name), "utf8")),
  );
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

async function dateInTimezone(
  database: PGlite,
  timezone: string,
): Promise<string> {
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
  for (const migration of await readMigrations()) {
    await database.exec(migration);
  }

  return database;
}

describe("cloud migrations", () => {
  it(
    "pages all 2500 Today rows and confirms one scalar reorder under browser roles",
    async () => {
      const database = await createMigratedDatabase();
      const userA = "00000000-0000-4000-8000-000000000061";
      const userB = "00000000-0000-4000-8000-000000000062";
      const emptyUser = "00000000-0000-4000-8000-000000000063";
      type Page = {
        local_date: string; offset: number; total_count: number; snapshot_token: string;
        items: Array<{ id: string; text: string; due_time: string | null;
          today_rank: number | null; project_title: string; is_overdue: boolean;
          is_manually_ordered: boolean; created_at: string; updated_at: string }>;
      };
      try {
        const dates = await currentNewYorkDates(database);
        const page = async (offset = 0, limit: number | null = 200, token: string | null = null) => {
          const result = await database.query<{ page: Page }>(
            `select public.get_today_todos_page($1::date, $2, $3, $4) as page`,
            [dates.today, offset, limit, token],
          );
          if (!result.rows[0]) throw new Error("Page response missing.");
          return result.rows[0].page;
        };
        await database.query(
          `insert into auth.users (id, email) values
           ($1, 'pages-a@example.test'), ($2, 'pages-b@example.test'), ($3, 'pages-empty@example.test')`,
          [userA, userB, emptyUser],
        );
        await database.query("select set_config('request.jwt.claim.sub', $1, false)", [userA]);
        await database.exec("set role authenticated");
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
        expect(first.items.every((row) => row.today_rank === null && !row.is_manually_ordered && !row.is_overdue)).toBe(true);
        expect(first.items.every((row) => row.due_time === "09:00:00.123456"
          && row.created_at.endsWith("+00:00") && row.updated_at.endsWith("+00:00"))).toBe(true);
        await database.exec("set timezone = 'Pacific/Auckland'");
        expect((await page()).snapshot_token).toBe(first.snapshot_token);

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
          `select id from internal.get_today_todos($1::date)`, [dates.today],
        );
        expect(collected.map((row) => row.id)).toEqual(expected.rows.map((row) => row.id));
        expect((await page(2500, 200, first.snapshot_token)).items).toEqual([]);
        for (const [offset, limit, token] of [
          [-1, 200, null], [0, 0, null], [0, 201, null], [0, null, null],
          [200, 200, null], [0, 200, "bad"], [2501, 200, first.snapshot_token],
        ] as const) {
          await expect(page(offset, limit, token)).rejects.toMatchObject({ code: "22023" });
        }
        await expect(page(200, 200, "0".repeat(64))).rejects.toMatchObject({ code: "40001" });
        await expect(database.query(`select public.get_today_todos_page($1::date)`, [dates.tomorrow]))
          .rejects.toMatchObject({ code: "22023" });

        const ids = collected.map((row) => row.id).reverse();
        const receipt = await database.query<{ receipt: unknown }>(
          `select public.reorder_today_todos($1::date, $2::uuid[]) as receipt`,
          [dates.today, ids],
        );
        expect(receipt.rows[0]?.receipt).toEqual({
          local_date: dates.today, applied_count: 2500, rank_step: 1024,
          order_fingerprint: createHash("sha256").update(ids.join(",")).digest("hex"),
        });
        const persisted = await database.query<{ id: string; today_rank: number }>(
          `select id, today_rank from internal.get_today_todos($1::date)`, [dates.today],
        );
        expect(persisted.rows).toEqual(ids.map((id, index) => ({ id, today_rank: (index + 1) * 1024 })));
        await expect(page(200, 200, first.snapshot_token)).rejects.toMatchObject({ code: "40001" });
        for (const changedIds of [ids.slice(1), [...ids.slice(0, -1), ids[0]], [...ids, null]]) {
          await expect(database.query(`select public.reorder_today_todos($1::date, $2::uuid[])`, [dates.today, changedIds]))
            .rejects.toMatchObject({ code: "22023" });
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

        const ownerToken = (await page()).snapshot_token;
        await database.query("select set_config('request.jwt.claim.sub', $1, false)", [userB]);
        await database.query(`insert into public.todos(text,due_date) values ('Foreign task', $1::date)`, [dates.today]);
        expect((await page()).total_count).toBe(1);
        await expect(page(0, 200, ownerToken)).rejects.toMatchObject({ code: "40001" });
        await expect(database.query(`select public.reorder_today_todos($1::date, $2::uuid[])`, [dates.today, ids]))
          .rejects.toMatchObject({ code: "22023" });
        await database.query("select set_config('request.jwt.claim.sub', $1, false)", [emptyUser]);
        expect(await page()).toMatchObject({ total_count: 0, items: [] });
        const empty = await database.query<{ receipt: unknown }>(
          `select public.reorder_today_todos($1::date, '{}'::uuid[]) as receipt`, [dates.today],
        );
        expect(empty.rows[0]?.receipt).toEqual({
          local_date: dates.today, applied_count: 0, rank_step: 1024,
          order_fingerprint: createHash("sha256").update("").digest("hex"),
        });
        await database.exec("reset role; set role anon");
        await expect(page()).rejects.toMatchObject({ code: "42501" });
        await expect(database.query(`select public.reorder_today_todos($1::date, '{}'::uuid[])`, [dates.today]))
          .rejects.toMatchObject({ code: "42501" });
      } finally {
        await database.close();
      }
    },
    30_000,
  );

  it(
    "apply in order against an embedded PostgreSQL runtime",
    async () => {
      const database = await createMigratedDatabase();

      try {
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
          "media",
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
      } finally {
        await database.close();
      }
    },
    30_000,
  );

  it(
    "rolls back an uncommitted migration batch atomically on a disposable database",
    async () => {
      const database = await PGlite.create();

      try {
        await database.exec(supabaseHarnessSql);
        const defaultPrivilegesBefore = await database.query<{
          acl: string;
          object_type: string;
          owner_name: string;
          schema_name: string;
        }>(`
          select
            pg_get_userbyid(default_acl.defaclrole) as owner_name,
            coalesce(namespace.nspname, '') as schema_name,
            default_acl.defaclobjtype::text as object_type,
            coalesce(default_acl.defaclacl::text, '') as acl
          from pg_catalog.pg_default_acl as default_acl
          left join pg_catalog.pg_namespace as namespace
            on namespace.oid = default_acl.defaclnamespace
          order by owner_name, schema_name, object_type, acl
        `);
        const publicSchemaAclBefore = await database.query<{ acl: string }>(`
          select coalesce(namespace.nspacl::text, '') as acl
          from pg_catalog.pg_namespace as namespace
          where namespace.nspname = 'public'
        `);

        await database.exec("begin");
        for (const migration of await readMigrations()) {
          await database.exec(migration);
        }
        await database.exec("rollback");

        const applicationTables = await database.query<{ count: number }>(`
          select count(*)::integer as count
          from information_schema.tables
          where table_schema in ('public', 'private')
            and table_name in (
              'profiles',
              'projects',
              'todos',
              'ideas',
              'media',
              'google_calendar_connections',
              'google_calendar_preferences',
              'google_calendar_credentials',
              'google_oauth_transactions'
            )
        `);
        const helperRole = await database.query<{ count: number }>(`
          select count(*)::integer as count
          from pg_catalog.pg_roles
          where rolname = 'orbitos_rpc'
        `);
        const applicationSchemas = await database.query<{ count: number }>(`
          select count(*)::integer as count
          from pg_catalog.pg_namespace as namespace
          where namespace.nspname in ('internal', 'private')
        `);
        const applicationTypes = await database.query<{ count: number }>(`
          select count(*)::integer as count
          from pg_catalog.pg_type as type
          join pg_catalog.pg_namespace as namespace
            on namespace.oid = type.typnamespace
          where namespace.nspname = 'public'
            and type.typname in (
              'record_source',
              'media_type',
              'media_status',
              'project_status',
              'google_calendar_connection_state',
              'orbitos_record_type'
            )
        `);
        const applicationFunctions = await database.query<{ count: number }>(`
          select count(*)::integer as count
          from pg_catalog.pg_proc as procedure
          join pg_catalog.pg_namespace as namespace
            on namespace.oid = procedure.pronamespace
          where namespace.nspname in ('public', 'internal', 'private')
            and procedure.proname in (
              'request_user_id',
              'lock_today_order',
              'set_updated_at',
              'validate_profile_timezone',
              'sync_todo_state',
              'validate_active_project_reference',
              'clear_ineligible_ranks_after_timezone_change',
              'handle_new_user',
              'get_today_todos_page',
              'reorder_today_todos',
              'soft_delete_record',
              'restore_record',
              'search_records'
            )
        `);
        const authTriggers = await database.query<{ count: number }>(`
          select count(*)::integer as count
          from pg_catalog.pg_trigger as trigger
          join pg_catalog.pg_class as class
            on class.oid = trigger.tgrelid
          join pg_catalog.pg_namespace as namespace
            on namespace.oid = class.relnamespace
          where namespace.nspname = 'auth'
            and trigger.tgname = 'on_auth_user_created'
            and not trigger.tgisinternal
        `);
        const defaultPrivilegesAfter = await database.query<{
          acl: string;
          object_type: string;
          owner_name: string;
          schema_name: string;
        }>(`
          select
            pg_get_userbyid(default_acl.defaclrole) as owner_name,
            coalesce(namespace.nspname, '') as schema_name,
            default_acl.defaclobjtype::text as object_type,
            coalesce(default_acl.defaclacl::text, '') as acl
          from pg_catalog.pg_default_acl as default_acl
          left join pg_catalog.pg_namespace as namespace
            on namespace.oid = default_acl.defaclnamespace
          order by owner_name, schema_name, object_type, acl
        `);
        const publicSchemaAclAfter = await database.query<{ acl: string }>(`
          select coalesce(namespace.nspacl::text, '') as acl
          from pg_catalog.pg_namespace as namespace
          where namespace.nspname = 'public'
        `);

        expect(applicationTables.rows[0]?.count).toBe(0);
        expect(helperRole.rows[0]?.count).toBe(0);
        expect(applicationSchemas.rows[0]?.count).toBe(0);
        expect(applicationTypes.rows[0]?.count).toBe(0);
        expect(applicationFunctions.rows[0]?.count).toBe(0);
        expect(authTriggers.rows[0]?.count).toBe(0);
        expect(defaultPrivilegesAfter.rows).toEqual(defaultPrivilegesBefore.rows);
        expect(publicSchemaAclAfter.rows).toEqual(publicSchemaAclBefore.rows);
      } finally {
        await database.close();
      }
    },
    30_000,
  );

  it(
    "applies when managed postgres does not own or control the auth schema",
    async () => {
      const database = await PGlite.create();

      try {
        try {
          await database.exec(managedSupabaseHarnessSql);
        } catch (error) {
          throw new Error("managed Supabase harness setup failed", {
            cause: error,
          });
        }
        const migrations = await readMigrations();
        for (const [index, migration] of migrations.entries()) {
          try {
            await database.exec(migration);
          } catch (error) {
            throw new Error(`managed migration ${index + 1} failed`, {
              cause: error,
            });
          }
        }

        const result = await database.query<{
          runner_is_not_superuser: boolean;
          auth_has_platform_owner: boolean;
          rpc_has_no_auth_usage: boolean;
          helpers_exist: boolean;
        }>(`
          select
            not (
              select role.rolsuper
              from pg_catalog.pg_roles as role
              where role.rolname = current_user
            ) as runner_is_not_superuser,
            pg_get_userbyid(namespace.nspowner) = 'supabase_auth_admin'
              as auth_has_platform_owner,
            not has_schema_privilege('orbitos_rpc', 'auth', 'usage')
              as rpc_has_no_auth_usage,
            (
              select count(*) = 4
              from pg_catalog.pg_proc as procedure
              join pg_catalog.pg_namespace as helper_namespace
                on helper_namespace.oid = procedure.pronamespace
              where helper_namespace.nspname = 'internal'
                and procedure.proname in (
                  'lock_today_order',
                  'reorder_today_todos',
                  'soft_delete_record',
                  'restore_record'
                )
            ) as helpers_exist
          from pg_catalog.pg_namespace as namespace
          where namespace.nspname = 'auth'
        `);

        expect(result.rows[0]).toEqual({
          runner_is_not_superuser: true,
          auth_has_platform_owner: true,
          rpc_has_no_auth_usage: true,
          helpers_exist: true,
        });
      } finally {
        await database.close();
      }
    },
    30_000,
  );

  it(
    "enforces browser-compatible todo schedule boundaries on authenticated writes",
    async () => {
      const database = await createMigratedDatabase();
      const userId = "00000000-0000-4000-8000-000000000051";
      const validSchedules = [
        { due_date: null, due_time: null },
        { due_date: "0001-01-01", due_time: "00:00:00" },
        { due_date: "9999-12-31", due_time: "23:59:59.999999" },
        { due_date: "2000-02-29", due_time: "12:34:56.123456" },
        { due_date: "2026-09-03", due_time: null },
      ];
      const invalidSchedules = [
        { date: "infinity", time: null, constraint: "todos_due_date_app_range" },
        { date: "-infinity", time: null, constraint: "todos_due_date_app_range" },
        { date: "0001-12-31 BC", time: null, constraint: "todos_due_date_app_range" },
        { date: "10000-01-01", time: null, constraint: "todos_due_date_app_range" },
        { date: "2026-09-03", time: "24:00:00", constraint: "todos_due_time_app_range" },
        { date: "2026-09-03", time: "23:59:59.9999999", constraint: "todos_due_time_app_range" },
        { date: null, time: "12:00:00", constraint: "todos_due_time_requires_date" },
      ];

      try {
        await database.query(
          `insert into auth.users (id, email) values ($1, 'schedule@example.test')`,
          [userId],
        );
        await database.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [userId],
        );
        await database.exec("set role authenticated");

        for (const schedule of validSchedules) {
          const inserted = await database.query<{
            id: string;
            due_date: string | null;
            due_time: string | null;
          }>(
            `insert into public.todos (text, due_date, due_time)
             values ('Valid schedule', $1::date, $2::time)
             returning id, due_date::text, due_time::text`,
            [schedule.due_date, schedule.due_time],
          );
          expect(inserted.rows).toEqual([{ id: expect.any(String), ...schedule }]);
        }

        const baseline = { due_date: "2026-09-03", due_time: "09:15:00.123456" };
        const target = await database.query<{ id: string }>(
          `insert into public.todos (text, due_date, due_time)
           values ('Update target', $1::date, $2::time) returning id`,
          [baseline.due_date, baseline.due_time],
        );
        const targetId = target.rows[0]?.id;
        expect(targetId).toBeTypeOf("string");

        for (const schedule of invalidSchedules) {
          await expect(
            database.query(
              `insert into public.todos (text, due_date, due_time)
               values ('Rejected schedule', $1::date, $2::time)`,
              [schedule.date, schedule.time],
            ),
          ).rejects.toMatchObject({ code: "23514", constraint: schedule.constraint });
          await expect(
            database.query(
              `update public.todos set due_date = $1::date, due_time = $2::time
               where id = $3`,
              [schedule.date, schedule.time, targetId],
            ),
          ).rejects.toMatchObject({ code: "23514", constraint: schedule.constraint });
          const unchanged = await database.query(
            `select due_date::text, due_time::text from public.todos where id = $1`,
            [targetId],
          );
          expect(unchanged.rows).toEqual([baseline]);
        }

        for (const schedule of validSchedules) {
          const updated = await database.query(
            `update public.todos set due_date = $1::date, due_time = $2::time
             where id = $3 returning due_date::text, due_time::text`,
            [schedule.due_date, schedule.due_time, targetId],
          );
          expect(updated.rows).toEqual([schedule]);
        }
      } finally {
        await database.close();
      }
    },
    30_000,
  );

  it.each([
    { label: "valid microseconds", date: "9999-12-31", time: "23:59:59.999999", constraint: null },
    { label: "pre-existing infinite date", date: "-infinity", time: null, constraint: "todos_due_date_app_range" },
    { label: "pre-existing end-of-day time", date: "2026-09-03", time: "24:00:00", constraint: "todos_due_time_app_range" },
  ])(
    "validates $label without rewriting existing rows",
    async ({ date, time, constraint }) => {
      const database = await PGlite.create();
      const userId = "00000000-0000-4000-8000-000000000052";

      try {
        const migration = await readFile(
          path.join(repositoryRoot, "supabase", "migrations", "20260902000300_todo_schedule_bounds.sql"),
          "utf8",
        );
        const migrations = await readMigrations();
        const boundaryIndex = migrations.indexOf(migration);
        expect(boundaryIndex).toBeGreaterThanOrEqual(0);
        await database.exec(supabaseHarnessSql);
        for (const previous of migrations.slice(0, boundaryIndex)) {
          await database.exec(previous);
        }
        await database.query(
          `insert into auth.users (id, email) values ($1, 'existing-schedule@example.test')`,
          [userId],
        );
        await database.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [userId],
        );
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
    30_000,
  );

  it(
    "enforces the complete browser ownership matrix through grants and RLS",
    async () => {
      const database = await createMigratedDatabase();
      const userA = "00000000-0000-4000-8000-000000000001";
      const userB = "00000000-0000-4000-8000-000000000002";

      try {
        await database.query(
          `insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')`,
          [userA, userB],
        );

        await database.exec("set role service_role");
        await database.query(
          `insert into public.google_calendar_connections (
             user_id,
             google_account_id,
             display_email,
             connection_state
           )
           values
             ($1, 'google-a', 'calendar-a@example.test', 'connected'),
             ($2, 'google-b', 'calendar-b@example.test', 'connected')`,
          [userA, userB],
        );
        await database.query(
          `insert into public.google_calendar_preferences (
             user_id,
             calendar_id,
             display_name
           )
           values
             ($1, 'calendar-a', 'A calendar'),
             ($2, 'calendar-b', 'B calendar')`,
          [userA, userB],
        );
        await database.exec("reset role");

        await database.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [userA],
        );
        await database.query(
          "select set_config('request.jwt.claims', '', false)",
        );
        await database.exec("set role authenticated");

        const ownProfile = await database.query<{
          user_id: string;
          timezone: string;
        }>(`select user_id, timezone from public.profiles`);
        expect(ownProfile.rows).toEqual([
          { user_id: userA, timezone: "America/New_York" },
        ]);

        const updatedProfile = await database.query<{ timezone: string }>(
          `update public.profiles
           set timezone = 'America/Chicago'
           where user_id = $1
           returning timezone`,
          [userA],
        );
        expect(updatedProfile.rows).toEqual([{ timezone: "America/Chicago" }]);
        await expect(
          database.query(
            `update public.profiles
             set timezone = 'Not/A_Real_Timezone'
             where user_id = $1`,
            [userA],
          ),
        ).rejects.toThrow(/invalid profile timezone/i);
        const profileAfterInvalidTimezone = await database.query<{
          timezone: string;
        }>(`select timezone from public.profiles where user_id = $1`, [userA]);
        expect(profileAfterInvalidTimezone.rows).toEqual([
          { timezone: "America/Chicago" },
        ]);

        const ownProject = await database.query<{
          id: string;
          user_id: string;
        }>(
          `insert into public.projects (title, description)
           values ('A project', 'A project description')
           returning id, user_id`,
        );
        const ownProjectId = ownProject.rows[0]?.id;
        expect(ownProject.rows[0]?.user_id).toBe(userA);

        const ownTodo = await database.query<{
          id: string;
          user_id: string;
        }>(
          `insert into public.todos (text, project_id)
           values ('A todo', $1)
           returning id, user_id`,
          [ownProjectId],
        );
        const ownTodoId = ownTodo.rows[0]?.id;
        expect(ownTodo.rows[0]?.user_id).toBe(userA);

        const ownIdea = await database.query<{
          id: string;
          user_id: string;
        }>(
          `insert into public.ideas (title, body, project_id)
           values ('A idea', 'A idea body', $1)
           returning id, user_id`,
          [ownProjectId],
        );
        const ownIdeaId = ownIdea.rows[0]?.id;
        expect(ownIdea.rows[0]?.user_id).toBe(userA);

        const ownMedia = await database.query<{
          id: string;
          user_id: string;
        }>(
          `insert into public.media (media_type, title)
           values ('book', 'A book')
           returning id, user_id`,
        );
        const ownMediaId = ownMedia.rows[0]?.id;
        expect(ownMedia.rows[0]?.user_id).toBe(userA);

        expect(ownProjectId).toBeTypeOf("string");
        expect(ownTodoId).toBeTypeOf("string");
        expect(ownIdeaId).toBeTypeOf("string");
        expect(ownMediaId).toBeTypeOf("string");

        const updatedProject = await database.query<{
          title: string;
          status: string;
        }>(
          `update public.projects
           set title = 'A project updated', status = 'someday'
           where id = $1
           returning title, status`,
          [ownProjectId],
        );
        const updatedTodo = await database.query<{ text: string }>(
          `update public.todos
           set text = 'A todo updated'
           where id = $1
           returning text`,
          [ownTodoId],
        );
        const updatedIdea = await database.query<{ body: string }>(
          `update public.ideas
           set body = 'A idea body updated'
           where id = $1
           returning body`,
          [ownIdeaId],
        );
        const updatedMedia = await database.query<{
          title: string;
          status: string;
        }>(
          `update public.media
           set title = 'A book updated', status = 'in_progress'
           where id = $1
           returning title, status`,
          [ownMediaId],
        );
        const updatedPreference = await database.query<{
          calendar_id: string;
          is_visible: boolean;
        }>(
          `update public.google_calendar_preferences
           set is_visible = false
           where calendar_id = 'calendar-a'
           returning calendar_id, is_visible`,
        );

        expect(updatedProject.rows).toEqual([
          { title: "A project updated", status: "someday" },
        ]);
        expect(updatedTodo.rows).toEqual([{ text: "A todo updated" }]);
        expect(updatedIdea.rows).toEqual([
          { body: "A idea body updated" },
        ]);
        expect(updatedMedia.rows).toEqual([
          { title: "A book updated", status: "in_progress" },
        ]);
        expect(updatedPreference.rows).toEqual([
          { calendar_id: "calendar-a", is_visible: false },
        ]);

        const ownRows = await database.query<{
          relation_name: string;
          user_id: string;
        }>(`
          select 'profiles'::text as relation_name, user_id
          from public.profiles
          union all
          select 'projects', user_id from public.projects
          union all
          select 'todos', user_id from public.todos
          union all
          select 'ideas', user_id from public.ideas
          union all
          select 'media', user_id from public.media
          union all
          select 'google_calendar_status', user_id
          from public.google_calendar_connections
          union all
          select 'google_calendar_preferences', user_id
          from public.google_calendar_preferences
          order by relation_name
        `);
        expect(ownRows.rows).toEqual([
          { relation_name: "google_calendar_preferences", user_id: userA },
          { relation_name: "google_calendar_status", user_id: userA },
          { relation_name: "ideas", user_id: userA },
          { relation_name: "media", user_id: userA },
          { relation_name: "profiles", user_id: userA },
          { relation_name: "projects", user_id: userA },
          { relation_name: "todos", user_id: userA },
        ]);

        await expect(
          database.query(
            `insert into public.profiles (user_id) values ($1)`,
            [userB],
          ),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          database.query(
            `insert into public.projects (user_id, title)
             values ($1, 'Spoofed project')`,
            [userB],
          ),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          database.query(
            `insert into public.todos (user_id, text)
             values ($1, 'Spoofed todo')`,
            [userB],
          ),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          database.query(
            `insert into public.ideas (user_id, body)
             values ($1, 'Spoofed idea')`,
            [userB],
          ),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          database.query(
            `insert into public.media (user_id, media_type, title)
             values ($1, 'movie', 'Spoofed media')`,
            [userB],
          ),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          database.query(
            `insert into public.google_calendar_connections (user_id)
             values ($1)`,
            [userA],
          ),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          database.query(
            `insert into public.google_calendar_preferences (
               user_id,
               calendar_id,
               display_name
             ) values ($1, 'browser-created', 'Browser-created calendar')`,
            [userA],
          ),
        ).rejects.toThrow(/permission denied/i);

        const ownSoftDeleteRecords = [
          { recordType: "project", tableName: "projects", id: ownProjectId },
          { recordType: "todo", tableName: "todos", id: ownTodoId },
          { recordType: "idea", tableName: "ideas", id: ownIdeaId },
          { recordType: "media", tableName: "media", id: ownMediaId },
        ] as const;

        for (const record of ownSoftDeleteRecords) {
          const deletion = await database.query<{ deleted_at: string }>(
            `select public.soft_delete_record(
               $1::public.orbitos_record_type,
               $2
             )::text as deleted_at`,
            [record.recordType, record.id],
          );
          const deletionToken = deletion.rows[0]?.deleted_at;
          expect(deletionToken).toBeTypeOf("string");

          const hidden = await database.query<{ id: string }>(
            `select id from public.${record.tableName} where id = $1`,
            [record.id],
          );
          expect(hidden.rows).toEqual([]);

          const restored = await database.query<{ restored: boolean }>(
            `select public.restore_record(
               $1::public.orbitos_record_type,
               $2,
               $3
             ) as restored`,
            [record.recordType, record.id, deletionToken],
          );
          expect(restored.rows).toEqual([{ restored: true }]);
        }

        const inactiveProject = await database.query<{ id: string }>(
          `insert into public.projects (title)
           values ('Inactive relationship target')
           returning id`,
        );
        const inactiveProjectId = inactiveProject.rows[0]?.id;
        const inactiveProjectDeletion = await database.query<{
          deleted_at: string;
        }>(
          `select public.soft_delete_record(
             'project',
             $1
           )::text as deleted_at`,
          [inactiveProjectId],
        );
        await expect(
          database.query(
            `insert into public.todos (text, project_id)
             values ('Cannot target inactive project', $1)`,
            [inactiveProjectId],
          ),
        ).rejects.toThrow(/active same-owner project/i);
        await expect(
          database.query(
            `insert into public.ideas (body, project_id)
             values ('Cannot target inactive project', $1)`,
            [inactiveProjectId],
          ),
        ).rejects.toThrow(/active same-owner project/i);
        expect(inactiveProjectDeletion.rows[0]?.deleted_at).toBeTypeOf("string");

        await expect(
          database.query(
            `delete from public.projects where id = $1`,
            [ownProjectId],
          ),
        ).rejects.toThrow(/permission denied/i);

        await database.exec("reset role");
        await database.query(
          "select set_config('request.jwt.claim.sub', '', false)",
        );
        await database.query(
          "select set_config('request.jwt.claims', $1, false)",
          [JSON.stringify({ sub: userB, role: "authenticated" })],
        );
        await database.exec("set role authenticated");

        const otherProject = await database.query<{ id: string }>(
          `insert into public.projects (title)
           values ('B project')
           returning id`,
        );
        const otherProjectId = otherProject.rows[0]?.id;
        const otherTodo = await database.query<{ id: string }>(
          `insert into public.todos (text, project_id)
           values ('B todo', $1)
           returning id`,
          [otherProjectId],
        );
        const otherTodoId = otherTodo.rows[0]?.id;
        const otherIdea = await database.query<{ id: string }>(
          `insert into public.ideas (body, project_id)
           values ('B idea body', $1)
           returning id`,
          [otherProjectId],
        );
        const otherIdeaId = otherIdea.rows[0]?.id;
        const otherMedia = await database.query<{ id: string }>(
          `insert into public.media (media_type, title)
           values ('movie', 'B movie')
           returning id`,
        );
        const otherMediaId = otherMedia.rows[0]?.id;

        expect(otherProjectId).toBeTypeOf("string");
        expect(otherTodoId).toBeTypeOf("string");
        expect(otherIdeaId).toBeTypeOf("string");
        expect(otherMediaId).toBeTypeOf("string");

        await database.exec("reset role");
        await database.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [userA],
        );
        await database.query(
          "select set_config('request.jwt.claims', '', false)",
        );
        await database.exec("set role authenticated");

        const visibleAfterForeignInserts = await database.query<{
          relation_name: string;
          user_id: string;
        }>(`
          select 'profiles'::text as relation_name, user_id
          from public.profiles
          union all
          select 'projects', user_id from public.projects
          union all
          select 'todos', user_id from public.todos
          union all
          select 'ideas', user_id from public.ideas
          union all
          select 'media', user_id from public.media
          union all
          select 'google_calendar_status', user_id
          from public.google_calendar_connections
          union all
          select 'google_calendar_preferences', user_id
          from public.google_calendar_preferences
          order by relation_name
        `);
        expect(visibleAfterForeignInserts.rows).toEqual(ownRows.rows);

        const foreignProfileUpdate = await database.query<{ user_id: string }>(
          `update public.profiles
           set timezone = 'America/Denver'
           where user_id = $1
           returning user_id`,
          [userB],
        );
        const foreignProjectUpdate = await database.query<{ id: string }>(
          `update public.projects
           set title = 'Tampered B project'
           where id = $1
           returning id`,
          [otherProjectId],
        );
        const foreignTodoUpdate = await database.query<{ id: string }>(
          `update public.todos
           set text = 'Tampered B todo'
           where id = $1
           returning id`,
          [otherTodoId],
        );
        const foreignIdeaUpdate = await database.query<{ id: string }>(
          `update public.ideas
           set body = 'Tampered B idea'
           where id = $1
           returning id`,
          [otherIdeaId],
        );
        const foreignMediaUpdate = await database.query<{ id: string }>(
          `update public.media
           set title = 'Tampered B media'
           where id = $1
           returning id`,
          [otherMediaId],
        );
        const foreignPreferenceUpdate = await database.query<{ id: string }>(
          `update public.google_calendar_preferences
           set is_visible = false
           where calendar_id = 'calendar-b'
           returning id`,
        );

        expect(foreignProfileUpdate.rows).toEqual([]);
        expect(foreignProjectUpdate.rows).toEqual([]);
        expect(foreignTodoUpdate.rows).toEqual([]);
        expect(foreignIdeaUpdate.rows).toEqual([]);
        expect(foreignMediaUpdate.rows).toEqual([]);
        expect(foreignPreferenceUpdate.rows).toEqual([]);

        await expect(
          database.query(
            `update public.google_calendar_connections
             set connection_state = 'disconnected'
             where user_id = $1`,
            [userA],
          ),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          database.query(
            `update public.google_calendar_connections
             set connection_state = 'disconnected'
             where user_id = $1`,
            [userB],
          ),
        ).rejects.toThrow(/permission denied/i);

        const foreignSoftDeleteRecords = [
          { recordType: "project", id: otherProjectId },
          { recordType: "todo", id: otherTodoId },
          { recordType: "idea", id: otherIdeaId },
          { recordType: "media", id: otherMediaId },
        ] as const;

        for (const record of foreignSoftDeleteRecords) {
          const deletion = await database.query<{
            deleted_at: string | null;
          }>(
            `select public.soft_delete_record(
               $1::public.orbitos_record_type,
               $2
             )::text as deleted_at`,
            [record.recordType, record.id],
          );
          const restore = await database.query<{ restored: boolean }>(
            `select public.restore_record(
               $1::public.orbitos_record_type,
               $2,
               statement_timestamp()
             ) as restored`,
            [record.recordType, record.id],
          );

          expect(deletion.rows).toEqual([{ deleted_at: null }]);
          expect(restore.rows).toEqual([{ restored: false }]);
        }

        await database.exec("reset role");
        const foreignRowsRemainIntact = await database.query<{
          projects: number;
          todos: number;
          ideas: number;
          media: number;
          profile_timezone: string;
          preference_visible: boolean;
        }>(
          `select
             (select count(*)::integer from public.projects
              where id = $1 and title = 'B project') as projects,
             (select count(*)::integer from public.todos
              where id = $2 and text = 'B todo') as todos,
             (select count(*)::integer from public.ideas
              where id = $3 and body = 'B idea body') as ideas,
             (select count(*)::integer from public.media
              where id = $4 and title = 'B movie') as media,
             (select timezone from public.profiles
              where user_id = $5) as profile_timezone,
             (select is_visible from public.google_calendar_preferences
              where user_id = $5) as preference_visible`,
          [
            otherProjectId,
            otherTodoId,
            otherIdeaId,
            otherMediaId,
            userB,
          ],
        );
        expect(foreignRowsRemainIntact.rows).toEqual([
          {
            projects: 1,
            todos: 1,
            ideas: 1,
            media: 1,
            profile_timezone: "America/New_York",
            preference_visible: true,
          },
        ]);
      } finally {
        await database.close();
      }
    },
    30_000,
  );

  it(
    "keeps unchanged project references editable after project soft deletion",
    async () => {
      const database = await createMigratedDatabase();
      const userId = "00000000-0000-4000-8000-000000000009";

      try {
        await database.query(
          `insert into auth.users (id, email)
           values ($1, 'project-reference@example.test')`,
          [userId],
        );
        await database.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [userId],
        );
        await database.exec("set role authenticated");

        const project = await database.query<{ id: string }>(
          `insert into public.projects (title)
           values ('Reference target')
           returning id`,
        );
        const projectId = project.rows[0]?.id;
        const linkedTodo = await database.query<{ id: string }>(
          `insert into public.todos (text, project_id)
           values ('Linked todo', $1)
           returning id`,
          [projectId],
        );
        const linkedIdea = await database.query<{ id: string }>(
          `insert into public.ideas (title, body, project_id)
           values ('Linked idea', 'Linked idea body', $1)
           returning id`,
          [projectId],
        );
        // Execute the pgTAP fixture itself under its authenticated role. A
        // duplicate approximation previously missed its forbidden id insert.
        const isolationSql = await readFile(
          path.join(repositoryRoot, "supabase", "tests", "010_rls_isolation.test.sql"),
          "utf8",
        );
        const unlinkedFixtureSql = isolationSql.match(
          /-- browser-owned-unlinked-todo:start\r?\n([\s\S]*?)-- browser-owned-unlinked-todo:end/,
        )?.[1];
        if (!unlinkedFixtureSql) {
          throw new Error("The authenticated pgTAP unlinked-todo fixture is missing.");
        }
        await database.exec(unlinkedFixtureSql);
        const unlinkedTodo = await database.query<{ id: string }>(
          `select id from public.todos where text = 'B unlinked todo'`,
        );
        expect(unlinkedTodo.rows).toHaveLength(1);
        const explicitTodo = await database.query<{ id: string }>(
          `insert into public.todos (id, text)
           values ('b0000000-0000-4000-8000-000000000007', 'Explicit id retry')
           returning id`,
        );
        expect(explicitTodo.rows[0]?.id).toBe("b0000000-0000-4000-8000-000000000007");

        const projectIdValue = projectId as string;
        const linkedTodoId = linkedTodo.rows[0]?.id as string;
        const linkedIdeaId = linkedIdea.rows[0]?.id as string;
        const unlinkedTodoId = unlinkedTodo.rows[0]?.id as string;
        const deletion = await database.query<{ deleted_at: string }>(
          `select public.soft_delete_record(
             'project',
             $1
           )::text as deleted_at`,
          [projectIdValue],
        );

        expect(deletion.rows[0]?.deleted_at).toBeTypeOf("string");

        const todoUpdate = await database.query<{
          project_id: string;
          text: string;
        }>(
          `update public.todos
           set
             text = 'Linked todo edited',
             completed = false,
             due_date = null,
             due_time = null,
             project_id = $1
           where id = $2
           returning text, project_id`,
          [projectIdValue, linkedTodoId],
        );
        const ideaUpdate = await database.query<{
          body: string;
          project_id: string;
        }>(
          `update public.ideas
           set
             title = 'Linked idea edited',
             body = 'Linked idea body edited',
             project_id = $1
           where id = $2
           returning body, project_id`,
          [projectIdValue, linkedIdeaId],
        );

        expect(todoUpdate.rows).toEqual([
          { text: "Linked todo edited", project_id: projectIdValue },
        ]);
        expect(ideaUpdate.rows).toEqual([
          { body: "Linked idea body edited", project_id: projectIdValue },
        ]);

        await expect(
          database.query(
            `update public.todos
             set project_id = $1
             where id = $2`,
            [projectIdValue, unlinkedTodoId],
          ),
        ).rejects.toThrow(/active same-owner project/i);
        await expect(
          database.query(
            `insert into public.ideas (body, project_id)
             values ('New stale relationship', $1)`,
            [projectIdValue],
          ),
        ).rejects.toThrow(/active same-owner project/i);

        const unlinkedAfterFailure = await database.query<{
          project_id: string | null;
        }>(
          `select project_id
           from public.todos
           where id = $1`,
          [unlinkedTodoId],
        );
        expect(unlinkedAfterFailure.rows).toEqual([{ project_id: null }]);
      } finally {
        await database.close();
      }
    },
    30_000,
  );

  it(
    "preserves the helper-role, RLS, and function ACL posture",
    async () => {
      const database = await createMigratedDatabase();

      try {
        const posture = await database.query<{
          role_is_safe: boolean;
          all_personal_tables_use_rls: boolean;
          wrappers_are_invoker: boolean;
          helpers_are_hardened: boolean;
          anonymous_rpc_is_denied: boolean;
          authenticated_rpc_is_allowed: boolean;
          private_schema_is_denied: boolean;
          request_identity_is_rpc_only: boolean;
          today_rank_mutations_use_central_lock: boolean;
          today_order_lock_is_hardened: boolean;
        }>(`
          select
            (
              select not role.rolcanlogin
                and not role.rolsuper
                and not role.rolcreatedb
                and not role.rolcreaterole
                and not role.rolreplication
                and not role.rolbypassrls
              from pg_catalog.pg_roles as role
              where role.rolname = 'orbitos_rpc'
            ) as role_is_safe,
            (
              select count(*) = 9 and bool_and(class.relrowsecurity)
              from pg_catalog.pg_class as class
              join pg_catalog.pg_namespace as namespace
                on namespace.oid = class.relnamespace
              where (namespace.nspname, class.relname) in (
                ('public', 'profiles'),
                ('public', 'projects'),
                ('public', 'todos'),
                ('public', 'ideas'),
                ('public', 'media'),
                ('public', 'google_calendar_connections'),
                ('public', 'google_calendar_preferences'),
                ('private', 'google_calendar_credentials'),
                ('private', 'google_oauth_transactions')
              )
            ) as all_personal_tables_use_rls,
            (
              select count(*) = 5 and bool_and(not procedure.prosecdef)
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
            ) as wrappers_are_invoker,
            (
              select count(*) = 3
                and bool_and(procedure.prosecdef)
                and bool_and(owner.rolname = 'orbitos_rpc')
                and bool_and(
                  array_to_string(procedure.proconfig, ',') like '%search_path=%'
                  and array_to_string(procedure.proconfig, ',')
                    like '%row_security=on%'
                )
              from pg_catalog.pg_proc as procedure
              join pg_catalog.pg_namespace as namespace
                on namespace.oid = procedure.pronamespace
              join pg_catalog.pg_roles as owner
                on owner.oid = procedure.proowner
              where namespace.nspname = 'internal'
                and procedure.proname in (
                  'reorder_today_todos',
                  'soft_delete_record',
                  'restore_record'
                )
            ) as helpers_are_hardened,
            not has_function_privilege(
              'anon',
              'internal.get_today_todos(date)',
              'execute'
            ) as anonymous_rpc_is_denied,
            has_function_privilege(
              'authenticated',
              'internal.get_today_todos(date)',
              'execute'
            ) as authenticated_rpc_is_allowed,
            not has_schema_privilege('anon', 'private', 'usage')
              and not has_schema_privilege(
                'authenticated',
                'private',
                'usage'
              ) as private_schema_is_denied,
            has_function_privilege(
              'orbitos_rpc',
              'internal.request_user_id()',
              'execute'
            )
              and not has_function_privilege(
                'authenticated',
                'internal.request_user_id()',
                'execute'
              ) as request_identity_is_rpc_only,
            (
              select count(*) = 2
                and bool_and(
                  position(
                    'internal.lock_today_order' in pg_get_functiondef(procedure.oid)
                  ) > 0
                  and position(
                    'pg_advisory_xact_lock' in pg_get_functiondef(procedure.oid)
                  ) = 0
                  and position(
                    'hashtextextended' in pg_get_functiondef(procedure.oid)
                  ) = 0
                  and position(
                    'orbitos:today-order:' in pg_get_functiondef(procedure.oid)
                  ) = 0
                )
              from pg_catalog.pg_proc as procedure
              join pg_catalog.pg_namespace as namespace
                on namespace.oid = procedure.pronamespace
              where (namespace.nspname, procedure.proname) in (
                ('internal', 'reorder_today_todos'),
                ('private', 'clear_ineligible_ranks_after_timezone_change')
              )
            ) as today_rank_mutations_use_central_lock,
            has_function_privilege(
              'orbitos_rpc',
              'internal.lock_today_order(uuid)',
              'execute'
            )
              and not has_function_privilege(
                'anon',
                'internal.lock_today_order(uuid)',
                'execute'
              )
              and not has_function_privilege(
                'authenticated',
                'internal.lock_today_order(uuid)',
                'execute'
              )
              and not has_function_privilege(
                'service_role',
                'internal.lock_today_order(uuid)',
                'execute'
              )
              and (
                select not procedure.prosecdef
                  and procedure.provolatile = 'v'
                  and 'search_path=""' = any(procedure.proconfig)
                  and position(
                    'pg_advisory_xact_lock' in pg_get_functiondef(procedure.oid)
                  ) > 0
                  and position(
                    'hashtextextended' in pg_get_functiondef(procedure.oid)
                  ) > 0
                  and position(
                    'orbitos:today-order:' in pg_get_functiondef(procedure.oid)
                  ) > 0
                from pg_catalog.pg_proc as procedure
                where procedure.oid = 'internal.lock_today_order(uuid)'::regprocedure
              ) as today_order_lock_is_hardened
        `);

        expect(posture.rows[0]).toEqual({
          role_is_safe: true,
          all_personal_tables_use_rls: true,
          wrappers_are_invoker: true,
          helpers_are_hardened: true,
          anonymous_rpc_is_denied: true,
          authenticated_rpc_is_allowed: true,
          private_schema_is_denied: true,
          request_identity_is_rpc_only: true,
          today_rank_mutations_use_central_lock: true,
          today_order_lock_is_hardened: true,
        });
      } finally {
        await database.close();
      }
    },
    30_000,
  );

  it(
    "keeps Today ordering, undo, and search atomic and user-scoped",
    async () => {
      const database = await createMigratedDatabase();
      const userA = "00000000-0000-4000-8000-000000000011";
      const userB = "00000000-0000-4000-8000-000000000012";

      try {
        const dates = await currentNewYorkDates(database);
        await database.query(
          `insert into auth.users (id, email) values ($1, 'a2@example.test'), ($2, 'b2@example.test')`,
          [userA, userB],
        );
        await database.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [userA],
        );
        await database.exec("set role authenticated");

        const inserted = await database.query<{ id: string; text: string }>(
          `insert into public.todos (text, due_date)
           values
             ('Sharedword older', $1::date),
             ('Sharedword today', $2::date),
             ('Sharedword future', $3::date)
           returning id, text`,
          [dates.yesterday, dates.today, dates.tomorrow],
        );
        const ids = new Map(inserted.rows.map(({ id, text }) => [text, id]));
        const olderId = ids.get("Sharedword older");
        const todayId = ids.get("Sharedword today");

        expect(olderId).toBeTypeOf("string");
        expect(todayId).toBeTypeOf("string");

        const reordered = await database.query<{
          todo_id: string;
          today_rank: bigint;
        }>(
          `select *
           from internal.reorder_today_todos($1::date, $2::uuid[])`,
          [dates.today, [todayId, olderId]],
        );
        expect(reordered.rows.map(({ todo_id }) => todo_id)).toEqual([
          todayId,
          olderId,
        ]);
        expect(
          reordered.rows.map(({ today_rank }) => Number(today_rank)),
        ).toEqual([1024, 2048]);

        await expect(
          database.query(
            `select *
             from internal.reorder_today_todos($1::date, $2::uuid[])`,
            [dates.today, [olderId]],
          ),
        ).rejects.toThrow(/Today list changed/i);

        const ranksAfterRejectedReorder = await database.query<{
          id: string;
          today_rank: number;
        }>(`
          select id, today_rank
          from public.todos
          where id in ('${todayId}', '${olderId}')
          order by today_rank
        `);
        expect(ranksAfterRejectedReorder.rows).toEqual([
          { id: todayId, today_rank: 1024 },
          { id: olderId, today_rank: 2048 },
        ]);

        const deletion = await database.query<{
          deleted_at: string;
        }>(
          `select public.soft_delete_record('todo', $1)::text as deleted_at`,
          [olderId],
        );
        const deletionToken = deletion.rows[0]?.deleted_at;
        expect(deletionToken).toBeTypeOf("string");

        const wrongTokenRestore = await database.query<{ restored: boolean }>(
          `select public.restore_record(
             'todo',
             $1,
             $2::timestamptz + interval '1 second'
           ) as restored`,
          [olderId, deletionToken],
        );
        expect(wrongTokenRestore.rows[0]?.restored).toBe(false);

        const correctTokenRestore = await database.query<{
          restored: boolean;
        }>(
          `select public.restore_record('todo', $1, $2) as restored`,
          [olderId, deletionToken],
        );
        expect(correctTokenRestore.rows[0]?.restored).toBe(true);

        await database.exec("reset role");
        await database.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [userB],
        );
        await database.exec("set role authenticated");
        const otherTodo = await database.query<{ id: string }>(
          `insert into public.todos (text, due_date)
           values ('Sharedword other user', $1::date)
           returning id`,
          [dates.today],
        );
        const otherTodoId = otherTodo.rows[0]?.id;
        expect(otherTodoId).toBeTypeOf("string");

        await database.exec("reset role");
        await database.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [userA],
        );
        await database.exec("set role authenticated");

        const ranksBeforeForeignCalls = await database.query<{
          id: string;
          today_rank: number | null;
        }>(`
          select id, today_rank
          from public.todos
          where id in ('${todayId}', '${olderId}')
          order by id
        `);
        await expect(
          database.query(
            `select *
             from internal.reorder_today_todos(
               $1::date,
               $2::uuid[]
             )`,
            [dates.today, [todayId, olderId, otherTodoId]],
          ),
        ).rejects.toThrow(/Today list changed/i);
        const foreignDelete = await database.query<{
          deleted_at: string | null;
        }>(
          `select public.soft_delete_record('todo', $1)::text as deleted_at`,
          [otherTodoId],
        );
        const foreignRestore = await database.query<{ restored: boolean }>(
          `select public.restore_record(
             'todo',
             $1,
             statement_timestamp()
           ) as restored`,
          [otherTodoId],
        );
        const ranksAfterForeignCalls = await database.query<{
          id: string;
          today_rank: number | null;
        }>(`
          select id, today_rank
          from public.todos
          where id in ('${todayId}', '${olderId}')
          order by id
        `);

        const today = await database.query<{
          id: string;
          today_rank: number | null;
        }>(
          `select id, today_rank from internal.get_today_todos($1::date)`,
          [dates.today],
        );
        const search = await database.query<{
          title: string;
          total_count: number;
        }>(`select title, total_count from public.search_records('sharedword')`);
        const negativeOnlySearch = await database.query<{ title: string }>(
          `select title from public.search_records('-sharedword')`,
        );

        expect(today.rows.map(({ id }) => id)).toEqual([todayId, olderId]);
        expect(today.rows.map(({ today_rank }) => today_rank)).toEqual([
          1024,
          null,
        ]);
        expect(search.rows.map(({ title }) => title).sort()).toEqual([
          "Sharedword future",
          "Sharedword older",
          "Sharedword today",
        ]);
        expect(search.rows.every(({ total_count }) => total_count === 3)).toBe(
          true,
        );
        expect(negativeOnlySearch.rows).toEqual([]);
        expect(foreignDelete.rows[0]?.deleted_at).toBeNull();
        expect(foreignRestore.rows[0]?.restored).toBe(false);
        expect(ranksAfterForeignCalls.rows).toEqual(ranksBeforeForeignCalls.rows);

        await database.exec("reset role");
        const foreignRowStillExists = await database.query<{ exists: boolean }>(
          `select exists(
             select 1 from public.todos where id = $1
           ) as exists`,
          [otherTodoId],
        );
        expect(foreignRowStillExists.rows[0]?.exists).toBe(true);
      } finally {
        await database.close();
      }
    },
    30_000,
  );

  it(
    "searches every record type without leaking deleted or foreign records",
    async () => {
      const database = await createMigratedDatabase();
      const userA = "00000000-0000-4000-8000-000000000021";
      const userB = "00000000-0000-4000-8000-000000000022";
      const todoId = "a4000000-0000-4000-8000-000000000001";
      const ideaId = "a4000000-0000-4000-8000-000000000002";
      const deletedIdeaId = "a4000000-0000-4000-8000-000000000003";
      const mediaId = "a4000000-0000-4000-8000-000000000004";
      const projectId = "a4000000-0000-4000-8000-000000000005";
      const foreignTodoId = "b4000000-0000-4000-8000-000000000001";

      try {
        await database.query(
          `insert into auth.users (id, email) values ($1, 'a3@example.test'), ($2, 'b3@example.test')`,
          [userA, userB],
        );
        await database.query(
          `insert into public.todos (id, user_id, text, updated_at)
           values
             ($1, $2, 'Needle ' || repeat('t', 300), '2026-01-01 01:00:00+00'),
             ($3, $4, 'Needle foreign', '2026-01-01 05:00:00+00')`,
          [todoId, userA, foreignTodoId, userB],
        );
        await database.query(
          `insert into public.ideas (
             id,
             user_id,
             title,
             body,
             deleted_at,
             updated_at
           ) values
             (
               $1,
               $2,
               'Needle idea',
               'Useful thought',
               null,
               '2026-01-01 02:00:00+00'
             ),
             (
               $3,
               $2,
               'Needle deleted idea',
               'Needle deleted idea body',
               '2026-01-01 06:00:00+00',
               '2026-01-01 06:00:00+00'
             )`,
          [ideaId, userA, deletedIdeaId],
        );
        await database.query(
          `insert into public.media (
             id,
             user_id,
             media_type,
             title,
             notes,
             updated_at
           ) values (
             $1,
             $2,
             'book',
             'Needle media',
             repeat('m', 300),
             '2026-01-01 03:00:00+00'
           )`,
          [mediaId, userA],
        );
        await database.query(
          `insert into public.projects (
             id,
             user_id,
             title,
             description,
             updated_at
           ) values (
             $1,
             $2,
             'Needle project',
             repeat('p', 300),
             '2026-01-01 04:00:00+00'
           )`,
          [projectId, userA],
        );
        await database.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [userA],
        );
        await database.exec("set role authenticated");

        const results = await database.query<{
          record_id: string;
          record_type: string;
          title: string;
          snippet: string;
          total_count: number;
        }>(`select * from public.search_records('needle')`);
        const excludingProject = await database.query<{ record_type: string }>(
          `select record_type
           from public.search_records('needle -project')`,
        );
        const firstPage = await database.query<{ record_id: string }>(
          `select record_id
           from public.search_records('needle', 2, 0)`,
        );
        const secondPage = await database.query<{ record_id: string }>(
          `select record_id
           from public.search_records('needle', 2, 2)`,
        );
        const repeatedFirstPage = await database.query<{ record_id: string }>(
          `select record_id
           from public.search_records('needle', 2, 0)`,
        );

        expect(results.rows.map(({ record_type }) => record_type).sort()).toEqual(
          ["idea", "media", "project", "todo"],
        );
        expect(results.rows.every(({ total_count }) => total_count === 4)).toBe(
          true,
        );
        expect(results.rows.every(({ title }) => title.length <= 160)).toBe(
          true,
        );
        expect(results.rows.every(({ snippet }) => snippet.length <= 200)).toBe(
          true,
        );
        expect(
          excludingProject.rows.map(({ record_type }) => record_type).sort(),
        ).toEqual(["idea", "media", "todo"]);
        expect(firstPage.rows.map(({ record_id }) => record_id)).toEqual([
          projectId,
          mediaId,
        ]);
        expect(secondPage.rows.map(({ record_id }) => record_id)).toEqual([
          ideaId,
          todoId,
        ]);
        expect(
          firstPage.rows.some(({ record_id }) =>
            secondPage.rows.some((row) => row.record_id === record_id),
          ),
        ).toBe(false);
        expect(repeatedFirstPage.rows).toEqual(firstPage.rows);
      } finally {
        await database.close();
      }
    },
    30_000,
  );

  it(
    "removes and deterministically re-appends todos as Today eligibility changes",
    async () => {
      const database = await createMigratedDatabase();
      const userId = "00000000-0000-4000-8000-000000000031";

      try {
        const dates = await currentNewYorkDates(database);
        await database.query(
          `insert into auth.users (id, email) values ($1, 'today@example.test')`,
          [userId],
        );
        await database.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [userId],
        );
        await database.exec("set role authenticated");
        const inserted = await database.query<{ id: string; text: string }>(
          `insert into public.todos (text, due_date)
           values
             ('Overdue transition', $1::date),
             ('Today transition', $2::date)
           returning id, text`,
          [dates.yesterday, dates.today],
        );
        const ids = new Map(inserted.rows.map(({ id, text }) => [text, id]));
        const overdueId = ids.get("Overdue transition");
        const todayId = ids.get("Today transition");

        await database.query(
          `select * from internal.reorder_today_todos(
             $1::date,
             $2::uuid[]
           )`,
          [dates.today, [todayId, overdueId]],
        );
        await database.query(
          `update public.todos
           set due_date = $1::date
           where id = $2`,
          [dates.tomorrow, todayId],
        );
        const afterRescheduleOut = await database.query<{
          id: string;
          today_rank: number | null;
        }>(
          `select id, today_rank from internal.get_today_todos($1::date)`,
          [dates.today],
        );
        expect(afterRescheduleOut.rows).toEqual([
          { id: overdueId, today_rank: 2048 },
        ]);

        await database.query(
          `update public.todos
           set due_date = $1::date
           where id = $2`,
          [dates.today, todayId],
        );
        const afterRescheduleBack = await database.query<{
          id: string;
          today_rank: number | null;
        }>(
          `select id, today_rank from internal.get_today_todos($1::date)`,
          [dates.today],
        );
        expect(afterRescheduleBack.rows).toEqual([
          { id: overdueId, today_rank: 2048 },
          { id: todayId, today_rank: null },
        ]);

        await database.query(
          `update public.todos set completed = true where id = $1`,
          [overdueId],
        );
        const afterCompletion = await database.query<{ id: string }>(
          `select id from internal.get_today_todos($1::date)`,
          [dates.today],
        );
        expect(afterCompletion.rows).toEqual([{ id: todayId }]);

        await database.query(
          `update public.todos set completed = false where id = $1`,
          [overdueId],
        );
        await expect(
          database.query(
            `select * from internal.get_today_todos($1::date)`,
            [dates.tomorrow],
          ),
        ).rejects.toThrow(/local date changed/i);
        await expect(
          database.query(
            `select * from internal.reorder_today_todos(
               $1::date,
               $2::uuid[]
             )`,
            [dates.tomorrow, [overdueId, todayId]],
          ),
        ).rejects.toThrow(/invalid Today reorder request/i);
        const deterministicUnranked = await database.query<{
          id: string;
          today_rank: number | null;
        }>(
          `select id, today_rank from internal.get_today_todos($1::date)`,
          [dates.today],
        );

        expect(deterministicUnranked.rows).toEqual([
          { id: overdueId, today_rank: null },
          { id: todayId, today_rank: null },
        ]);
      } finally {
        await database.close();
      }
    },
    30_000,
  );

  it(
    "honors profile timezone changes and removes stale Today ranks",
    async () => {
      const database = await createMigratedDatabase();
      const userId = "00000000-0000-4000-8000-000000000041";
      const forwardTimezone = "Pacific/Kiritimati";
      const backwardTimezone = "Etc/GMT+12";

      try {
        const forwardDate = await dateInTimezone(database, forwardTimezone);
        const backwardDate = await dateInTimezone(database, backwardTimezone);
        expect(forwardDate).not.toBe(backwardDate);

        await database.query(
          `insert into auth.users (id, email)
           values ($1, 'timezone@example.test')`,
          [userId],
        );
        await database.query(
          "select set_config('request.jwt.claim.sub', $1, false)",
          [userId],
        );
        await database.exec("set role authenticated");
        await database.query(
          `update public.profiles set timezone = $1`,
          [forwardTimezone],
        );
        const inserted = await database.query<{ id: string }>(
          `insert into public.todos (text, due_date)
           values ('Timezone boundary todo', $1::date)
           returning id`,
          [forwardDate],
        );
        const todoId = inserted.rows[0]?.id;

        await database.query(
          `select * from internal.reorder_today_todos(
             $1::date,
             $2::uuid[]
           )`,
          [forwardDate, [todoId]],
        );
        await expect(
          database.query(
            `select * from internal.get_today_todos($1::date)`,
            [backwardDate],
          ),
        ).rejects.toThrow(/local date changed/i);

        await database.query(
          `update public.profiles set timezone = $1`,
          [backwardTimezone],
        );
        const afterMovingBackward = await database.query<{
          today_rank: number | null;
        }>(`select today_rank from public.todos where id = $1`, [todoId]);
        const backwardToday = await database.query<{ id: string }>(
          `select id from internal.get_today_todos($1::date)`,
          [backwardDate],
        );

        expect(afterMovingBackward.rows[0]?.today_rank).toBeNull();
        expect(backwardToday.rows).toEqual([]);

        await database.query(
          `update public.profiles set timezone = $1`,
          [forwardTimezone],
        );
        const afterMovingForward = await database.query<{
          id: string;
          today_rank: number | null;
        }>(
          `select id, today_rank
           from internal.get_today_todos($1::date)`,
          [forwardDate],
        );
        expect(afterMovingForward.rows).toEqual([
          { id: todoId, today_rank: null },
        ]);
      } finally {
        await database.close();
      }
    },
    30_000,
  );
});
