import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("persists home appearance privately and rejects cross-account writes and oversized covers", async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    await db.exec(await readFile("supabase/migrations/20260907000100_home_appearance.sql", "utf8"));
    await db.query("insert into auth.users values ($1),($2)", [owner, other]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${owner}'`);
    await db.query("insert into home_appearance(title,cover_image) values ($1,$2)", ["My space", "data:image/webp;base64,AAAA"]);
    expect((await db.query("select title from home_appearance")).rows).toEqual([{ title: "My space" }]);
    await db.exec("reset role");
    await db.exec(await readFile("supabase/migrations/20260908000100_home_cover_position.sql", "utf8"));
    await db.exec("set role authenticated");
    expect((await db.query("select title,cover_position_x,cover_position_y from home_appearance")).rows).toEqual([{ title: "My space", cover_position_x: 50, cover_position_y: 50 }]);
    await db.exec("update home_appearance set cover_position_x=0,cover_position_y=100");
    await expect(db.exec("update home_appearance set cover_position_x=-1")).rejects.toThrow(/check constraint/);
    await expect(db.exec("update home_appearance set cover_position_y=101")).rejects.toThrow(/check constraint/);
    await expect(db.query("insert into home_appearance(user_id,title) values ($1,'Other')", [other])).rejects.toThrow(/row-level security/);
    await expect(db.query("update home_appearance set cover_image=$1", ["data:image/svg+xml;base64,AAAA"])).rejects.toThrow(/check constraint/);
    await expect(db.query("update home_appearance set cover_image=$1", ["data:image/webp;base64," + "A".repeat(350000)])).rejects.toThrow(/check constraint/);
    await expect(db.query("update home_appearance set title=$1", ["a".repeat(101)])).rejects.toThrow(/check constraint/);
    await db.exec(`set request.jwt.claim.sub = '${other}'`);
    expect((await db.query("select * from home_appearance")).rows).toEqual([]);
    expect((await db.query("update home_appearance set title='Changed' returning title")).rows).toEqual([]);
    expect((await db.query("update home_appearance set cover_position_x=50 returning cover_position_x")).rows).toEqual([]);
    await db.exec(`set request.jwt.claim.sub = '${owner}'`);
    expect((await db.query("select cover_position_x,cover_position_y from home_appearance")).rows).toEqual([{ cover_position_x: 0, cover_position_y: 100 }]);
    await db.exec("update home_appearance set cover_image=null, title='';");
    expect((await db.query("select title,cover_image from home_appearance")).rows).toEqual([{ title: "", cover_image: null }]);
    await db.exec("set role anon");
    await expect(db.query("select * from home_appearance")).rejects.toThrow(/permission denied/);
  } finally { await db.close(); }
}, 20000);
