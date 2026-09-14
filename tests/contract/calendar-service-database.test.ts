import { storageHarnessSql } from "../helpers/storageHarness";
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

describe('Calendar private service storage', () => {
  it('isolates credentials, consumes PKCE once, preserves visibility, and prevents stale writes after disconnect', async () => {
    const db = new PGlite();
    try {
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
      const migrations = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
      for (const name of migrations) await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
      const owner = '11111111-1111-4111-8111-111111111111';
      const connection = '22222222-2222-4222-8222-222222222222';
      await db.query('insert into auth.users(id,email) values($1,$2)', [owner, 'calendar@example.test']);
      const denied = await db.query<{ allowed: boolean }>(`select has_function_privilege('authenticated',
        'public.read_calendar_credentials(uuid)', 'execute') as allowed`);
      expect(denied.rows[0]?.allowed).toBe(false);
      await db.exec('set role service_role');
      const stateHash = 'a'.repeat(64);
      const redirect = 'https://app.example.test/api/calendar/callback';
      await db.query(`select public.begin_calendar_oauth_attempt($1,$2,$3,clock_timestamp()+interval '5 minutes',$4)`,
        [owner, stateHash, redirect, 'v'.repeat(43)]);
      const attempt = await db.query<{ result: { code_verifier: string } }>(
        'select public.consume_calendar_oauth_attempt($1,$2,$3) as result', [owner, stateHash, redirect]);
      expect(attempt.rows[0]?.result.code_verifier).toBe('v'.repeat(43));
      await expect(db.query('select public.consume_calendar_oauth_attempt($1,$2,$3)', [owner, stateHash, redirect])).rejects.toThrow();
      const verifier = await db.query<{ code_verifier: null }>('select code_verifier from private.google_oauth_transactions where user_id=$1', [owner]);
      expect(verifier.rows[0]?.code_verifier).toBeNull();

      const save = (expected: string | null, envelope = 'encrypted-envelope') => db.query<{ saved: boolean }>(
        'select public.save_calendar_credentials($1,$2,$3,$4,1,$5::text[]) as saved',
        [owner, connection, expected, envelope, ['read-scope']]);
      expect((await save(null)).rows[0]?.saved).toBe(true);
      const stored = await db.query<{ result: { envelope: string; connection: { updated_at: string } } }>(
        'select public.read_calendar_credentials($1) as result', [owner]);
      expect(stored.rows[0]?.result.envelope).toBe('encrypted-envelope');
      const originalRevision = stored.rows[0]!.result.connection.updated_at;
      await db.query('select public.clear_calendar_credentials($1,$2)', [owner, 'disconnected']);
      expect((await save(originalRevision)).rows[0]?.saved).toBe(false);
      const cleared = await db.query<{ result: { envelope: null; connection: { connection_state: string } } }>(
        'select public.read_calendar_credentials($1) as result', [owner]);
      expect(cleared.rows[0]?.result.envelope).toBeNull();
      expect(cleared.rows[0]?.result.connection.connection_state).toBe('disconnected');

      const calendars = [{ calendarId: 'work', displayName: 'Work', color: { background: '#123456', foreground: null } }];
      await db.query('select public.sync_calendar_preferences($1,$2::jsonb)', [owner, JSON.stringify(calendars)]);
      await db.query('update public.google_calendar_preferences set is_visible=false where user_id=$1', [owner]);
      calendars[0]!.displayName = 'Renamed work';
      const discovered = await db.query<{ result: { display_name: string; is_visible: boolean }[] }>(
        'select public.sync_calendar_preferences($1,$2::jsonb) as result', [owner, JSON.stringify(calendars)]);
      expect(discovered.rows[0]?.result[0]).toMatchObject({ display_name: 'Renamed work', is_visible: false });
      await db.exec('reset role');
      await db.close();
    } catch (error) { await db.close(); throw error; }
  }, 30_000);
});
