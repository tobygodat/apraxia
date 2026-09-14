import { storageHarnessSql } from "../helpers/storageHarness";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("migrates real legacy rows once, retains backup, isolates parents, and fingerprints class changes", async () => {
  const db = new PGlite();
  const alice = "11111111-1111-4111-8111-111111111111", bob = "22222222-2222-4222-8222-222222222222";
  const id = "33333333-3333-4333-8333-333333333333", doneId = "44444444-4444-4444-8444-444444444444";
  try {
    await db.exec(`create role anon nologin noinherit; create role authenticated nologin noinherit;
      create role service_role nologin noinherit bypassrls; create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;`);
    await db.exec(storageHarnessSql);
    for (const name of (await readdir("supabase/migrations")).filter(name => name.endsWith(".sql") && name < "20260914000100").sort()) await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await db.exec(`insert into auth.users(id) values ('${alice}'),('${bob}');
      insert into classes(user_id,id,name) values ('${alice}','math','Math'),('${bob}','foreign','Foreign');
      insert into class_assignments(id,user_id,course_id,title,due_date,assignment_type,completed) values
      ('${id}','${alice}','math','Open','2020-03-08','Quiz',false),
      ('${doneId}','${alice}','math','Done',null,'Homework',true);`);
    const migration = await readFile("supabase/migrations/20260914000100_assignment_todos.sql", "utf8");
    await db.exec(migration);
    expect((await db.query("select id,text,due_date::text,due_time,class_id,assignment_type,completed,completed_at is not null as has_completion,source from todos order by id")).rows).toEqual([
      { id, text: "Open", due_date: "2020-03-08", due_time: null, class_id: "math", assignment_type: "Quiz", completed: false, has_completion: false, source: "manual" },
      { id: doneId, text: "Done", due_date: null, due_time: null, class_id: "math", assignment_type: "Homework", completed: true, has_completion: true, source: "manual" },
    ]);
    await db.exec(`update todos set text='Edited after migration' where id='${id}'`);
    await db.exec(migration.slice(migration.indexOf("insert into public.todos"), migration.indexOf("-- The backup")));
    expect((await db.query(`select text from todos where id='${id}'`)).rows).toEqual([{ text: "Edited after migration" }]);
    expect((await db.query("select count(*)::int as n from class_assignments")).rows).toEqual([{ n: 2 }]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${alice}'`);
    await expect(db.exec("insert into todos(text,class_id) values ('Bad','foreign')")).rejects.toThrow(/foreign key/);
    await expect(db.exec("insert into todos(text,assignment_type) values ('Bad','Quiz')")).rejects.toThrow(/check constraint/);
    await expect(db.exec("insert into class_assignments(course_id,title) values ('math','Bad')")).rejects.toThrow(/permission denied/);
    await expect(db.exec("update class_assignments set completed=true")).rejects.toThrow(/permission denied/);
    const page = async () => (await db.query<{ page: { snapshot_token: string; items: { class_id: string; class_name: string; assignment_type: string }[] } }>("select get_today_todos_page((statement_timestamp() at time zone (select timezone from profiles))::date) as page")).rows[0]!.page;
    const first = await page();
    expect(first.items[0]).toMatchObject({ class_id: "math", class_name: "Math", assignment_type: "Quiz" });
    await db.exec("update classes set name='Renamed' where id='math'");
    expect((await page()).snapshot_token).not.toBe(first.snapshot_token);
    const second = await page();
    await db.exec(`update todos set assignment_type='Reading' where id='${id}'`);
    expect((await page()).snapshot_token).not.toBe(second.snapshot_token);
    await db.exec(`set request.jwt.claim.sub='${bob}'`);
    expect((await db.query("select id from todos")).rows).toEqual([]);
    expect((await db.query("select id from class_assignments")).rows).toEqual([]);
    await db.exec(`reset role; delete from classes where user_id='${alice}' and id='math'`);
    expect((await db.query("select class_id,assignment_type,user_id from todos")).rows).toEqual([{ class_id: null, assignment_type: "", user_id: alice }, { class_id: null, assignment_type: "", user_id: alice }]);
    expect((await db.query("select count(*)::int as n from class_assignments")).rows).toEqual([{ n: 2 }]);
  } finally { await db.close(); }
}, 30_000);
