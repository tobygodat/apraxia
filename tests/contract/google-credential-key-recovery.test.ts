import { storageHarnessSql } from "../helpers/storageHarness";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

/**
 * A wrong or rotated encryption key must not destroy the stored refresh token:
 * the server cannot tell "Google revoked this" from "I cannot read my own
 * credential" without help, so `clear_*_credentials` takes the decision as an
 * argument. Covers the Calendar credential plus the precondition ordering fix.
 */
async function migratedDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
  `);
  await db.exec(storageHarnessSql);
  const migrations = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrations) {
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  }
  return db;
}

const owner = "11111111-1111-4111-8111-111111111111";
const connection = "22222222-2222-4222-8222-222222222222";

interface CredentialRead {
  envelope: string | null;
  key_version: number | null;
  access_token_envelope: string | null;
  connection: { connection_state: string; updated_at: string };
}

describe.each([{ provider: "calendar" }])("$provider credential clearing", ({ provider }) => {
  const read = async (db: PGlite) =>
    (
      await db.query<{ result: CredentialRead }>(
        `select public.read_${provider}_credentials($1) as result`,
        [owner],
      )
    ).rows[0]!.result;

  async function connected(db: PGlite): Promise<CredentialRead> {
    await db.query("insert into auth.users(id,email) values($1,$2)", [owner, "owner@example.test"]);
    await db.query(
      `select public.save_${provider}_credentials($1,$2,null,$3,1,$4::text[],$5,$6::timestamptz)`,
      [
        owner,
        connection,
        "sealed-envelope",
        ["read-scope"],
        "access-envelope",
        "2099-01-01T00:00:00Z",
      ],
    );
    return read(db);
  }

  it("keeps the refresh-token ciphertext when the server cannot decrypt it", async () => {
    const db = await migratedDatabase();
    try {
      const before = await connected(db);
      const cleared = await db.query<{ ok: boolean }>(
        `select public.clear_${provider}_credentials($1,$2,$3::timestamptz,false) as ok`,
        [owner, "reconnect_required", before.connection.updated_at],
      );
      expect(cleared.rows[0]?.ok).toBe(true);

      const after = await read(db);
      expect(after.connection.connection_state).toBe("reconnect_required");
      // The long-lived credential survives, so restoring the key recovers it
      // and disconnect can still revoke the grant at Google.
      expect(after.envelope).toBe("sealed-envelope");
      expect(after.key_version).toBe(1);
      // The short-lived access token cache is worthless and is dropped.
      expect(after.access_token_envelope).toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("still deletes the credential for a revoked grant, including the default form", async () => {
    const db = await migratedDatabase();
    try {
      const before = await connected(db);
      await db.query(`select public.clear_${provider}_credentials($1,$2,$3::timestamptz,true)`, [
        owner,
        "reconnect_required",
        before.connection.updated_at,
      ]);
      expect((await read(db)).envelope).toBeNull();

      // The three-argument form other callers use still deletes.
      await db.query(
        `select public.save_${provider}_credentials($1,$2,$3::timestamptz,$4,1,$5::text[])`,
        [owner, connection, (await read(db)).connection.updated_at, "sealed-again", ["read-scope"]],
      );
      expect((await read(db)).envelope).toBe("sealed-again");
      await db.query(`select public.clear_${provider}_credentials($1,$2)`, [owner, "disconnected"]);
      const after = await read(db);
      expect(after.envelope).toBeNull();
      expect(after.connection.connection_state).toBe("disconnected");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("writes nothing when the expected revision does not match and no row exists", async () => {
    const db = await migratedDatabase();
    try {
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        owner,
        "owner@example.test",
      ]);
      const cleared = await db.query<{ ok: boolean }>(
        `select public.clear_${provider}_credentials($1,$2,$3::timestamptz,true) as ok`,
        [owner, "reconnect_required", "2026-09-04T12:00:00Z"],
      );
      expect(cleared.rows[0]?.ok).toBe(false);
      // No connection row is left behind for an account that never connected,
      // so the next save with a null expectation still succeeds.
      expect(await read(db)).toBeNull();
      const saved = await db.query<{ saved: boolean }>(
        `select public.save_${provider}_credentials($1,$2,null,$3,1,$4::text[]) as saved`,
        [owner, connection, "sealed-envelope", ["read-scope"]],
      );
      expect(saved.rows[0]?.saved).toBe(true);
    } finally {
      await db.close();
    }
  }, 30_000);
});
