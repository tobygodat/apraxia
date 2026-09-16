import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { storageHarnessSql } from "../helpers/storageHarness";

it("isolates agent access, validates writes, detects conflicts and journals durable retries", async () => {
  const db = new PGlite();
  const alice = "11111111-1111-4111-8111-111111111111";
  const bob = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`create role anon nologin noinherit; create role authenticated nologin noinherit;
      create role service_role nologin noinherit bypassrls; create schema auth;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;`);
    await db.exec(storageHarnessSql);
    for (const name of (await readdir("supabase/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await db.query("insert into auth.users(id) values($1),($2)", [alice, bob]);
    const call = async (
      op: string,
      bucket: string,
      data = {},
      id: string | null = null,
      request: string | null = null,
      version: string | null = null,
      owner = alice,
      query = {},
    ) => {
      const result = await db.query<{ result: any }>(
        "select public.agent_workspace($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8) result",
        [owner, op, bucket, id, JSON.stringify(data), JSON.stringify(query), request, version],
      );
      return result.rows[0]!.result;
    };
    await db.exec("set role authenticated");
    await expect(call("list", "todos")).rejects.toThrow(/permission denied/);
    await db.exec("set role service_role");
    const first = await call(
      "create",
      "todos",
      { text: "Read", due_date: "2020-03-08" },
      null,
      "one",
    );
    expect(first.item.due_date).toBe("2020-03-08");
    for (const due_time of ["24:00", "23:59:60", "12:60", "12:30Z"]) {
      await expect(
        call(
          "create",
          "todos",
          { text: "Invalid time", due_date: "2026-09-16", due_time },
          null,
          `invalid-${due_time}`,
        ),
      ).rejects.toThrow(/due_time/);
    }
    expect(
      await call("replay", "todos", { text: "Read", due_date: "2020-03-08" }, null, "one"),
    ).toEqual({ found: true, result: first });
    expect(
      await call(
        "replay",
        "todos",
        { text: "Read", due_date: "2020-03-08" },
        null,
        "one",
        null,
        bob,
      ),
    ).toEqual({ found: false });
    expect(await call("replay", "todos", { text: "Read" }, null, "missing")).toEqual({
      found: false,
    });
    await expect(call("replay", "todos", { text: "Different" }, null, "one")).rejects.toThrow(
      /Idempotency/,
    );
    expect(first.item.user_id).toBeUndefined();
    expect(
      await call("create", "todos", { text: "Read", due_date: "2020-03-08" }, null, "one"),
    ).toEqual(first);
    await expect(call("create", "todos", { text: "Changed" }, null, "one")).rejects.toThrow(
      /Idempotency/,
    );
    expect((await call("list", "todos", {}, null, null, null, bob)).items).toEqual([]);
    await expect(call("get", "todos", {}, first.item.id, null, null, bob)).rejects.toThrow(
      /not found/,
    );
    await expect(
      call("update", "todos", { user_id: bob }, first.item.id, "forged", first.item.version),
    ).rejects.toThrow(/Unsupported/);
    const done = await call(
      "update",
      "todos",
      { completed: true },
      first.item.id,
      "complete",
      first.item.version,
    );
    expect(done.item.completed_at).toBeTruthy();
    expect(done.item.due_date).toBe("2020-03-08");
    await expect(
      call("update", "todos", { text: "stale" }, first.item.id, "stale", first.item.version),
    ).rejects.toThrow(/Version conflict/);
    expect(
      await call(
        "update",
        "todos",
        { completed: true },
        first.item.id,
        "complete",
        first.item.version,
      ),
    ).toEqual(done);
    await call("create", "classes", { id: "math", name: "Math" }, null, "class");
    const note = await call(
      "create",
      "notes",
      { course_id: "math", name: "Lecture", source: "drive", drive_file_id: "abc" },
      null,
      "note",
    );
    await expect(
      call(
        "update",
        "notes",
        { uploaded_at: "2026-01-01" },
        note.item.id,
        "upload",
        note.item.version,
      ),
    ).rejects.toThrow(/Unsupported/);
    const renamed = await call(
      "update",
      "notes",
      { name: "New lecture" },
      note.item.id,
      "rename",
      note.item.version,
    );
    expect(renamed.item.drive_file_id).toBe("abc");
    expect(
      (await call("search", "notes", {}, null, null, null, alice, { q: "New" })).items,
    ).toHaveLength(1);
    const changes = await call("changes", "all", {}, null, null, null, alice, { limit: 2 });
    expect(changes.items).toHaveLength(2);
    expect(changes.next_offset).toBe(2);
    expect((await call("changes", "all", {}, null, null, null, bob)).items).toEqual([]);
    const provider = async (op: string, payload = { title: "Event" }, result: unknown = null) =>
      (
        await db.query<{ result: any }>(
          "select public.agent_provider_write($1,$2,'provider',$3::jsonb,$4::jsonb) result",
          [alice, op, JSON.stringify(payload), result === null ? null : JSON.stringify(result)],
        )
      ).rows[0]!.result;
    expect(await provider("begin")).toEqual({ state: "new" });
    expect(await provider("begin")).toEqual({ state: "pending" });
    await expect(provider("begin", { title: "Different" })).rejects.toThrow(/Idempotency/);
    expect(
      await provider("finish", { title: "Event" }, { status: 201, body: { id: "google" } }),
    ).toEqual({ state: "completed", result: { status: 201, body: { id: "google" } } });
    expect((await provider("begin")).state).toBe("completed");
    await db.exec("reset role");
    expect(
      (await db.query("select rolbypassrls from pg_roles where rolname='orbitos_agent'")).rows,
    ).toEqual([{ rolbypassrls: false }]);
    expect(
      (await db.query("select current_setting('orbitos.agent_owner',true) owner")).rows[0],
    ).toEqual({ owner: "" });
  } finally {
    await db.close();
  }
}, 30000);
