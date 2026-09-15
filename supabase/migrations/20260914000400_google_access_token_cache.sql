-- Cache each Google access token (encrypted) beside its refresh-token envelope so
-- ordinary requests reuse it; the server refreshes only when the cache is missing,
-- within a minute of expiry, or after Google rejects the token. The credential read
-- for Calendar also returns the profile timezone to drop a separate profile request.
-- Forward-only: existing rows keep working with an empty cache.

alter table private.google_calendar_credentials
  add column access_token_envelope text,
  add column access_token_expires_at timestamptz,
  add constraint google_calendar_credentials_access_token_pair check (
    (access_token_envelope is null) = (access_token_expires_at is null)
  ),
  add constraint google_calendar_credentials_access_envelope_nonempty check (
    access_token_envelope is null or btrim(access_token_envelope) <> ''
  );

alter table private.google_drive_credentials
  add column access_token_envelope text,
  add column access_token_expires_at timestamptz,
  add constraint google_drive_credentials_access_token_pair check (
    (access_token_envelope is null) = (access_token_expires_at is null)
  ),
  add constraint google_drive_credentials_access_envelope_nonempty check (
    access_token_envelope is null or btrim(access_token_envelope) <> ''
  );

-- The invoker-rights credential read runs as service_role and now joins the profile
-- timezone; mirror the narrow column grant orbitos_rpc already has. Nothing else on
-- profiles is opened to the server role.
grant select (user_id, timezone) on table public.profiles to service_role;

-- Same signature as before: privileges are retained by CREATE OR REPLACE.
create or replace function public.read_calendar_credentials(p_verified_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('connection', to_jsonb(c), 'envelope', s.refresh_token_envelope,
    'key_version', s.encryption_key_version,
    'access_token_envelope', s.access_token_envelope, 'access_token_expires_at', s.access_token_expires_at,
    'timezone', (select p.timezone from public.profiles p where p.user_id = p_verified_user_id)) into result
  from public.google_calendar_connections c
  left join private.google_calendar_credentials s on s.connection_id = c.id and s.user_id = c.user_id
  where c.user_id = p_verified_user_id;
  return result;
end $$;

create or replace function public.read_drive_credentials(p_verified_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('connection', to_jsonb(c), 'envelope', s.refresh_token_envelope,
    'key_version', s.encryption_key_version,
    'access_token_envelope', s.access_token_envelope, 'access_token_expires_at', s.access_token_expires_at) into result
  from public.google_drive_connections c
  left join private.google_drive_credentials s on s.connection_id = c.id and s.user_id = c.user_id
  where c.user_id = p_verified_user_id;
  return result;
end $$;

-- New overloads accept the access-token cache. The server always passes all eight
-- named arguments, so PostgREST resolves them unambiguously; the six-argument forms
-- remain (delegating with an empty cache) for existing callers and privilege tests.
create function public.save_calendar_credentials(
  p_verified_user_id uuid, p_connection_id uuid, p_expected_updated_at timestamptz,
  p_envelope text, p_key_version integer, p_scopes text[],
  p_access_token_envelope text, p_access_token_expires_at timestamptz
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_row public.google_calendar_connections%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_verified_user_id::text, 0));
  select * into current_row from public.google_calendar_connections where user_id = p_verified_user_id for update;
  if found then
    if current_row.id <> p_connection_id or current_row.updated_at is distinct from p_expected_updated_at then return false; end if;
  elsif p_expected_updated_at is not null then return false;
  end if;
  insert into public.google_calendar_connections(id, user_id, connection_state, granted_scopes, last_successful_refresh_at)
    values(p_connection_id, p_verified_user_id, 'connected', p_scopes, statement_timestamp())
    on conflict (user_id) do update set connection_state = 'connected', granted_scopes = excluded.granted_scopes,
      last_successful_refresh_at = excluded.last_successful_refresh_at;
  insert into private.google_calendar_credentials(connection_id, user_id, refresh_token_envelope, encryption_key_version,
      last_refreshed_at, access_token_envelope, access_token_expires_at)
    values(p_connection_id, p_verified_user_id, p_envelope, p_key_version, statement_timestamp(),
      p_access_token_envelope, p_access_token_expires_at)
    on conflict (connection_id) do update set refresh_token_envelope = excluded.refresh_token_envelope,
      encryption_key_version = excluded.encryption_key_version, last_refreshed_at = excluded.last_refreshed_at,
      access_token_envelope = excluded.access_token_envelope, access_token_expires_at = excluded.access_token_expires_at;
  return true;
end $$;

create or replace function public.save_calendar_credentials(
  p_verified_user_id uuid, p_connection_id uuid, p_expected_updated_at timestamptz,
  p_envelope text, p_key_version integer, p_scopes text[]
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  return public.save_calendar_credentials(p_verified_user_id, p_connection_id, p_expected_updated_at,
    p_envelope, p_key_version, p_scopes, null, null);
end $$;

create function public.save_drive_credentials(
  p_verified_user_id uuid, p_connection_id uuid, p_expected_updated_at timestamptz,
  p_envelope text, p_key_version integer, p_scopes text[],
  p_access_token_envelope text, p_access_token_expires_at timestamptz
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_row public.google_drive_connections%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_verified_user_id::text, 0));
  select * into current_row from public.google_drive_connections where user_id = p_verified_user_id for update;
  if found then
    if current_row.id <> p_connection_id or current_row.updated_at is distinct from p_expected_updated_at then return false; end if;
  elsif p_expected_updated_at is not null then return false;
  end if;
  insert into public.google_drive_connections(id, user_id, connection_state, granted_scopes, last_successful_refresh_at)
    values(p_connection_id, p_verified_user_id, 'connected', p_scopes, statement_timestamp())
    on conflict (user_id) do update set connection_state = 'connected', granted_scopes = excluded.granted_scopes,
      last_successful_refresh_at = excluded.last_successful_refresh_at;
  insert into private.google_drive_credentials(connection_id, user_id, refresh_token_envelope, encryption_key_version,
      last_refreshed_at, access_token_envelope, access_token_expires_at)
    values(p_connection_id, p_verified_user_id, p_envelope, p_key_version, statement_timestamp(),
      p_access_token_envelope, p_access_token_expires_at)
    on conflict (connection_id) do update set refresh_token_envelope = excluded.refresh_token_envelope,
      encryption_key_version = excluded.encryption_key_version, last_refreshed_at = excluded.last_refreshed_at,
      access_token_envelope = excluded.access_token_envelope, access_token_expires_at = excluded.access_token_expires_at;
  return true;
end $$;

create or replace function public.save_drive_credentials(
  p_verified_user_id uuid, p_connection_id uuid, p_expected_updated_at timestamptz,
  p_envelope text, p_key_version integer, p_scopes text[]
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  return public.save_drive_credentials(p_verified_user_id, p_connection_id, p_expected_updated_at,
    p_envelope, p_key_version, p_scopes, null, null);
end $$;

revoke all on function public.save_calendar_credentials(uuid,uuid,timestamptz,text,integer,text[],text,timestamptz)
  from public, anon, authenticated, orbitos_rpc;
revoke all on function public.save_drive_credentials(uuid,uuid,timestamptz,text,integer,text[],text,timestamptz)
  from public, anon, authenticated, orbitos_rpc;
grant execute on function public.save_calendar_credentials(uuid,uuid,timestamptz,text,integer,text[],text,timestamptz)
  to service_role;
grant execute on function public.save_drive_credentials(uuid,uuid,timestamptz,text,integer,text[],text,timestamptz)
  to service_role;
