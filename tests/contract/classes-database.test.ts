import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { storageHarnessSql } from "../helpers/storageHarness";

it("recovers existing assignments, imports without overwrites, and enforces note and private-object ownership", async () => {
  const db = new PGlite();
  const alice = "11111111-1111-4111-8111-111111111111";
  const bob = "22222222-2222-4222-8222-222222222222";
  const note = "33333333-3333-4333-8333-333333333333";
  const path = `${alice}/${note}.pdf`;
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
    // Supabase rewind retains buckets while recreating application tables.
    await db.exec(
      "insert into storage.buckets(id,name,public) values ('class-pdfs','class-pdfs',true)",
    );
    for (const name of names.filter((n) => n >= "20260913000300"))
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    expect(
      (
        await db.query(
          "select public,file_size_limit::int as size from storage.buckets where id='class-pdfs'",
        )
      ).rows,
    ).toEqual([{ public: false, size: 52428800 }]);
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
    await db.query(
      "insert into class_notes(id,course_id,name,source,byte_size,content_sha256) values ($1,'math3012','Lecture.pdf','upload',10,repeat('a',64))",
      [note],
    );
    await expect(db.query("select finish_class_pdf($1)", [note])).rejects.toThrow(/incomplete/);
    await expect(db.exec("update class_notes set uploaded_at=now()")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.exec(
        "insert into class_notes(course_id,name,source,drive_file_id,byte_size,content_sha256) values ('math3012','Bad','drive','file',10,repeat('a',64))",
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.exec("insert into storage.objects(bucket_id,name) values ('class-pdfs','unreserved.pdf')"),
    ).rejects.toThrow(/row-level security/);
    await db.query(
      'insert into storage.objects(bucket_id,name,metadata) values (\'class-pdfs\',$1,\'{"size":10,"mimetype":"application/pdf","sha256":"deadbeef"}\')',
      [path],
    );
    await expect(db.query("select finish_class_pdf($1)", [note])).rejects.toThrow(/does not match/);
    await db.query("delete from storage.objects where name=$1", [path]);
    await db.query(
      'insert into storage.objects(bucket_id,name,metadata) values (\'class-pdfs\',$1,\'{"size":10,"mimetype":"application/pdf"}\')',
      [path],
    );
    await db.query("select finish_class_pdf($1)", [note]);
    await db.query("select finish_class_pdf($1)", [note]);
    expect(
      (await db.query("select uploaded_at is not null as ready from class_notes")).rows,
    ).toEqual([{ ready: true }]);
    expect(
      (await db.query("update storage.objects set metadata='{}' returning name")).rows,
    ).toEqual([]);
    await db.exec(
      "insert into class_notes(course_id,name,source,drive_file_id) values ('math3012','Drive.pdf','drive','file') on conflict (user_id,course_id,drive_file_id) do nothing",
    );
    await db.exec(
      "insert into class_notes(course_id,name,source,drive_file_id) values ('math3012','Drive.pdf','drive','file') on conflict (user_id,course_id,drive_file_id) do nothing",
    );
    expect((await db.query("select count(*)::int as count from class_notes")).rows).toEqual([
      { count: 2 },
    ]);
    // Owner-scoped deletes. The object must go before the note that authorizes it.
    expect((await db.query("delete from storage.objects returning name")).rows).toEqual([
      { name: path },
    ]);
    await db.exec("delete from class_notes where source='drive'");
    expect((await db.query("select count(*)::int as count from class_notes")).rows).toEqual([
      { count: 1 },
    ]);
    await expect(db.exec("delete from classes where id='math3012'")).rejects.toThrow(/foreign key/);
    await db.exec(`set request.jwt.claim.sub = '${bob}'`);
    expect((await db.query("select name from classes")).rows).toEqual([{ name: null }]);
    expect((await db.query("select * from class_notes")).rows).toEqual([]);
    expect((await db.query("select * from storage.objects")).rows).toEqual([]);
    await expect(db.query("select finish_class_pdf($1)", [note])).rejects.toThrow(/unavailable/);
    await expect(
      db.query("insert into storage.objects(bucket_id,name) values ('class-pdfs',$1)", [path]),
    ).rejects.toThrow(/row-level security/);
    await db.exec("reset role; set role anon");
    await expect(db.exec("select * from classes")).rejects.toThrow(/permission denied/);
    await expect(db.query("select finish_class_pdf($1)", [note])).rejects.toThrow(
      /permission denied/,
    );
  } finally {
    await db.close();
  }
}, 30_000);
