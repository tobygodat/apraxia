import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  collectTodaySnapshot, TodaySnapshotChangedError, verifyTodayReorderReceipt,
  type FetchTodayPage,
} from "../../frontend/src/features/todos/todayRpcProtocol";
import type { TodayPageRequest } from "../../shared/todayRpcContract";

const USER = "11111111-1111-4111-8111-111111111111";

/** Embedded protocol integration, deliberately not evidence of PostgREST HTTP behavior. */
async function databaseFixture() {
  const database = new PGlite();
  await database.exec(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable set search_path = '' as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  const migrations = path.join(process.cwd(), "supabase", "migrations");
  for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await database.exec(await readFile(path.join(migrations, name), "utf8"));
  }
  await database.query("insert into auth.users (id,email) values ($1,'protocol@example.test')", [USER]);
  await database.exec(`set role authenticated; set request.jwt.claim.sub = '${USER}';`);
  const date = (await database.query<{ date: string }>(
    "select (statement_timestamp() at time zone 'America/New_York')::date::text as date",
  )).rows[0]!.date;
  const projectId = (await database.query<{ id: string }>(
    "insert into public.projects (title) values ('Original project') returning id",
  )).rows[0]!.id;
  await database.query(`
    insert into public.todos (text,due_date,due_time,project_id)
    select 'Protocol task ' || item, $1::date - 1, time '14:30:00.123456', $2::uuid
    from generate_series(1, 1001) as item
  `, [date, projectId]);
  const requests: TodayPageRequest[] = [];
  const fetchPage: FetchTodayPage = async (request, { signal }) => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    requests.push(request);
    try {
      const result = await database.query<{ page: unknown }>(
        "select public.get_today_todos_page($1::date,$2::integer,$3::integer,$4::text) as page",
        [request.p_local_date, request.p_offset, request.p_limit, request.p_snapshot_token],
      );
      return result.rows[0]!.page;
    } catch (error) {
      if ((error as { code?: string }).code === "40001") throw new TodaySnapshotChangedError();
      throw error;
    }
  };
  return { database, date, projectId, fetchPage, requests };
}

describe("Today database-to-client protocol", () => {
  it("reads every row beyond the API cap and confirms one atomic reorder without replay", async () => {
    const { database, date, fetchPage, requests } = await databaseFixture();
    try {
      const options = { signal: new AbortController().signal };
      const initial = await collectTodaySnapshot(fetchPage, date, options);
      expect(initial).toHaveLength(1001);
      expect(requests.map((request) => request.p_offset)).toEqual([0, 200, 400, 600, 800, 1000]);
      expect(initial.every((todo) => todo.isOverdue && todo.dueTime === "14:30:00.123456")).toBe(true);
      expect(initial.every((todo) => todo.projectTitle === "Original project")).toBe(true);
      expect(JSON.stringify(initial)).not.toContain(USER);

      const desired = initial.map((todo) => todo.id).reverse();
      // One write, one scalar result: never paginate this mutation or call it
      // again to retrieve the confirmation rows beyond PostgREST's row cap.
      const response = await database.query<{ receipt: unknown }>(
        "select public.reorder_today_todos($1::date,$2::uuid[]) as receipt", [date, desired],
      );
      expect(response.rows).toHaveLength(1);
      const ranks = await verifyTodayReorderReceipt(response.rows[0]!.receipt, date, desired, options);
      expect(ranks).toHaveLength(1001);
      expect(ranks.at(-1)).toEqual({ todoId: desired.at(-1), todayRank: 1001 * 1024 });
      const reloaded = await collectTodaySnapshot(fetchPage, date, options);
      expect(reloaded.map((todo) => todo.id)).toEqual(desired);
      expect(reloaded.map((todo) => todo.todayRank)).toEqual(ranks.map((row) => row.todayRank));
    } finally { await database.close(); }
  }, 30_000);

  it("restarts the entire snapshot after a joined project edit between pages", async () => {
    const { database, date, projectId, fetchPage, requests } = await databaseFixture();
    try {
      let edited = false;
      const changeBetweenPages: FetchTodayPage = async (request, options) => {
        if (!edited && request.p_offset > 0) {
          edited = true;
          await database.query("update public.projects set title = 'Renamed project' where id = $1", [projectId]);
        }
        return fetchPage(request, options);
      };
      const todos = await collectTodaySnapshot(changeBetweenPages, date, { signal: new AbortController().signal });
      expect(todos).toHaveLength(1001);
      expect(requests.map((request) => request.p_offset)).toEqual([0, 200, 0, 200, 400, 600, 800, 1000]);
      expect(todos.every((todo) => todo.projectTitle === "Renamed project")).toBe(true);
      expect(new Set(todos.map((todo) => todo.id)).size).toBe(1001);
    } finally { await database.close(); }
  }, 30_000);
});
