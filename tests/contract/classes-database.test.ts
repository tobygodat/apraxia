import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { storageHarnessSql } from "../helpers/storageHarness";

it("recovers existing assignments, imports without overwrites, and keeps classes private", async () => {
  const db = new PGlite();
  const alice = "11111111-1111-4111-8111-111111111111";
  const bob = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`create role anon nologin noinherit; create role authenticated nologin noinherit;
      create role service_role nologin noinherit bypassrls; create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;`);
    await db.exec(storageHarnessSql);
    const names = (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();
    for (const name of names.filter((n) => n < "20260913000300"))
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await db.query("insert into auth.users(id) values ($1),($2)", [alice, bob]);
    await db.query(
      "insert into class_assignments(user_id,course_id,title,due_date) values ($1,'math3012','Existing','2020-03-08'),($2,'math3012','Other account',null)",
      [alice, bob],
    );
    for (const name of names.filter((n) => n >= "20260913000300"))
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    expect((await db.query("select name from classes")).rows).toEqual([
      { name: null },
      { name: null },
    ]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${alice}'`);
    const importRows = (rows: unknown) =>
      db.query("select import_classes($1::jsonb)", [JSON.stringify(rows)]);
    await importRows([{ id: "math3012", name: "MATH3012" }]);
    await db.exec("update classes set name='New name' where id='math3012'");
    await importRows([
      { id: "math3012", name: "Stale browser name" },
      { id: "other", name: "New name" },
    ]);
    expect((await db.query("select name from classes where id='math3012'")).rows).toEqual([
      { name: "New name" },
    ]);
    await expect(
      importRows([
        { id: "rolled-back", name: "Valid" },
        { id: "", name: "Invalid" },
      ]),
    ).rejects.toThrow();
    expect((await db.query("select id from classes where id='rolled-back'")).rows).toEqual([]);
    expect((await db.query("select title,due_date::text from class_assignments")).rows).toEqual([
      { title: "Existing", due_date: "2020-03-08" },
    ]);
    await expect(db.exec("insert into classes(id,name) values ('blank',null)")).rejects.toThrow(
      /row-level security/,
    );
    await expect(
      db.exec("insert into todos(class_id,text) values ('missing','No parent')"),
    ).rejects.toThrow(/foreign key/);
    await expect(
      db.query("insert into classes(user_id,id,name) values ($1,'forged','Forged')", [bob]),
    ).rejects.toThrow(/row-level security/);
    await db.exec(`set request.jwt.claim.sub = '${bob}'`);
    expect((await db.query("select name from classes")).rows).toEqual([{ name: null }]);
    await db.exec("reset role; set role anon");
    await expect(db.exec("select * from classes")).rejects.toThrow(/permission denied/);
  } finally {
    await db.close();
  }
}, 30_000);
