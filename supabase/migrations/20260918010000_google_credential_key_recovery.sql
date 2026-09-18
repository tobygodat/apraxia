-- Separate "Google revoked this grant" from "this server cannot read its own
-- credential". Only the first should destroy the stored refresh token.
--
-- Before, clear_*_credentials always deleted private.*_credentials. A wrong or
-- rotated GOOGLE_TOKEN_ENCRYPTION_KEY made the first request after the deploy
-- look like a revoked grant, so the ciphertext was deleted; restoring the key
-- then recovered nothing, and disconnect could no longer revoke at Google
-- because that needs the plaintext.
--
-- New four-argument overloads take p_delete_credentials. The three-argument
-- forms remain and delegate with true, so every existing caller and the
-- disconnect path keep today's behaviour. The server passes false only for a
-- decryption failure, which leaves the ciphertext in place for the correct key.
--
-- Also fixes the precondition ordering: the connection row was inserted before
-- the expected-revision check, so a mismatched revision left a connection row
-- behind for an account that never connected, and the next save with a null
-- expectation then failed.

create function public.clear_calendar_credentials(
  p_verified_user_id uuid, p_state public.google_calendar_connection_state,
  p_expected_updated_at timestamptz, p_delete_credentials boolean
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_row public.google_calendar_connections%rowtype;
begin
  if p_state not in ('disconnected', 'reconnect_required') then
    raise exception using errcode = '22023', message = 'Invalid connection state.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_verified_user_id::text, 0));
  select * into current_row from public.google_calendar_connections where user_id = p_verified_user_id for update;
  -- Evaluate the precondition before writing anything.
  if p_expected_updated_at is not null and current_row.updated_at is distinct from p_expected_updated_at then return false; end if;
  if current_row.user_id is null then
    insert into public.google_calendar_connections(user_id, connection_state) values(p_verified_user_id, p_state);
  end if;
  if p_delete_credentials then
    delete from private.google_calendar_credentials where user_id = p_verified_user_id;
  else
    -- Keep the refresh-token ciphertext; drop only the short-lived access token
    -- cache, which is worthless once this server cannot read it.
    update private.google_calendar_credentials
      set access_token_envelope = null, access_token_expires_at = null
      where user_id = p_verified_user_id;
  end if;
  update public.google_calendar_connections set connection_state = p_state, granted_scopes = '{}',
    last_successful_refresh_at = null where user_id = p_verified_user_id;
  -- An explicit disconnect also invalidates unfinished connect attempts.
  if p_state = 'disconnected' then
    update private.google_oauth_transactions set consumed_at = clock_timestamp(), code_verifier = null
      where user_id = p_verified_user_id and consumed_at is null;
  end if;
  return true;
end $$;

create or replace function public.clear_calendar_credentials(
  p_verified_user_id uuid, p_state public.google_calendar_connection_state,
  p_expected_updated_at timestamptz default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  return public.clear_calendar_credentials(p_verified_user_id, p_state, p_expected_updated_at, true);
end $$;

create function public.clear_drive_credentials(
  p_verified_user_id uuid, p_state public.google_calendar_connection_state,
  p_expected_updated_at timestamptz, p_delete_credentials boolean
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_row public.google_drive_connections%rowtype;
begin
  if p_state not in ('disconnected', 'reconnect_required') then
    raise exception using errcode = '22023', message = 'Invalid connection state.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_verified_user_id::text, 0));
  select * into current_row from public.google_drive_connections where user_id = p_verified_user_id for update;
  if p_expected_updated_at is not null and current_row.updated_at is distinct from p_expected_updated_at then return false; end if;
  if current_row.user_id is null then
    insert into public.google_drive_connections(user_id, connection_state) values(p_verified_user_id, p_state);
  end if;
  if p_delete_credentials then
    delete from private.google_drive_credentials where user_id = p_verified_user_id;
  else
    update private.google_drive_credentials
      set access_token_envelope = null, access_token_expires_at = null
      where user_id = p_verified_user_id;
  end if;
  update public.google_drive_connections set connection_state = p_state, granted_scopes = '{}',
    last_successful_refresh_at = null where user_id = p_verified_user_id;
  if p_state = 'disconnected' then
    update private.google_drive_oauth_transactions set consumed_at = clock_timestamp(), code_verifier = null
      where user_id = p_verified_user_id and consumed_at is null;
  end if;
  return true;
end $$;

create or replace function public.clear_drive_credentials(
  p_verified_user_id uuid, p_state public.google_calendar_connection_state,
  p_expected_updated_at timestamptz default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  return public.clear_drive_credentials(p_verified_user_id, p_state, p_expected_updated_at, true);
end $$;

revoke all on function public.clear_calendar_credentials(uuid,public.google_calendar_connection_state,timestamptz,boolean)
  from public, anon, authenticated, orbitos_rpc;
revoke all on function public.clear_drive_credentials(uuid,public.google_calendar_connection_state,timestamptz,boolean)
  from public, anon, authenticated, orbitos_rpc;
grant execute on function public.clear_calendar_credentials(uuid,public.google_calendar_connection_state,timestamptz,boolean)
  to service_role;
grant execute on function public.clear_drive_credentials(uuid,public.google_calendar_connection_state,timestamptz,boolean)
  to service_role;
