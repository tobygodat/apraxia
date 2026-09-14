import { storageHarnessSql } from "../helpers/storageHarness";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("persists assignments with account isolation, immutable ownership, date-only values, and retry-safe creation", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon nologin noinherit; create role authenticated nologin noinherit;
      create role service_role nologin noinherit bypassrls; create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;`);
    await db.exec(storageHarnessSql);
    for (const name of (await readdir("supabase/migrations")).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    }
    const alice = "11111111-1111-4111-8111-111111111111";
    const bob = "22222222-2222-4222-8222-222222222222";
    const id = "33333333-3333-4333-8333-333333333333";
    await db.query("insert into auth.users(id) values ($1), ($2)", [alice, bob]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${alice}'`);
    await db.exec("insert into classes(id,name) values ('math3012','MATH3012'),('other-class','Other class')");
    const insert = () => db.query("insert into class_assignments(id,course_id,title,due_date,assignment_type) values ($1,'math3012','Problem set','2020-03-08','Homework') on conflict(id) do nothing", [id]);
    await insert(); await insert();
    await db.exec("insert into class_assignments(course_id,title) values ('other-class','Reading')");
    expect((await db.query("select title from class_assignments where course_id='math3012'")).rows).toEqual([{ title: "Problem set" }]);
    await db.query("update class_assignments set title='Revised',completed=true where id=$1", [id]);
    expect((await db.query("select due_date::text,completed from class_assignments where id=$1", [id])).rows).toEqual([{ due_date: "2020-03-08", completed: true }]);
    await expect(db.query("update class_assignments set user_id=$1 where id=$2", [bob, id])).rejects.toThrow(/permission denied/);
    await expect(db.exec("update class_assignments set course_id='different'")).rejects.toThrow(/permission denied/);
    await expect(db.exec("update class_assignments set title=' '")).rejects.toThrow(/check constraint/);
    await expect(db.exec("update class_assignments set title=repeat('a',181)")).rejects.toThrow(/check constraint/);
    await expect(db.exec("update class_assignments set assignment_type='invalid'")).rejects.toThrow(/check constraint/);
    await expect(db.exec("update class_assignments set due_date='infinity'")).rejects.toThrow(/check constraint/);
    await expect(db.query("insert into class_assignments(user_id,course_id,title) values ($1,'math3012','Forged')", [bob])).rejects.toThrow(/row-level security/);
    await db.exec(`set request.jwt.claim.sub = '${bob}'`);
    expect((await db.query("select * from class_assignments")).rows).toEqual([]);
    expect((await db.query("update class_assignments set title='Hijacked' where id=$1 returning id", [id])).rows).toEqual([]);
    await db.exec(`set request.jwt.claim.sub = '${alice}'`);
    expect((await db.query("select title from class_assignments where id=$1", [id])).rows).toEqual([{ title: "Revised" }]);
    await expect(db.exec("delete from class_assignments")).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set role anon");
    await expect(db.exec("select * from class_assignments")).rejects.toThrow(/permission denied/);
  } finally { await db.close(); }
}, 30_000);
