-- Calendar adapters use only service-role RPCs; private is never exposed to PostgREST.
alter table private.google_oauth_transactions add column code_verifier text;

create function public.begin_calendar_oauth_attempt(
  p_verified_user_id uuid, p_state_hash text, p_redirect_uri text,
  p_expires_at timestamptz, p_code_verifier text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_code_verifier is null or p_code_verifier !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = '22023', message = 'Invalid Calendar attempt.';
  end if;
  result := public.begin_calendar_oauth_transaction(p_verified_user_id, p_state_hash, p_redirect_uri, p_expires_at);
  update private.google_oauth_transactions set code_verifier = p_code_verifier
    where id = (result->>'id')::uuid;
  return result;
end $$;

create function public.consume_calendar_oauth_attempt(
  p_verified_user_id uuid, p_state_hash text, p_redirect_uri text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb; verifier text;
begin
  result := public.consume_calendar_oauth_transaction(p_verified_user_id, p_state_hash, p_redirect_uri);
  select code_verifier into verifier from private.google_oauth_transactions where id = (result->>'id')::uuid;
  if verifier is null then
    raise exception using errcode = '22023', message = 'Invalid Calendar attempt.';
  end if;
  update private.google_oauth_transactions set code_verifier = null where id = (result->>'id')::uuid;
  return result || jsonb_build_object('code_verifier', verifier);
end $$;

create function public.read_calendar_credentials(p_verified_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('connection', to_jsonb(c), 'envelope', s.refresh_token_envelope,
    'key_version', s.encryption_key_version) into result
  from public.google_calendar_connections c
  left join private.google_calendar_credentials s on s.connection_id = c.id and s.user_id = c.user_id
  where c.user_id = p_verified_user_id;
  return result;
end $$;

-- Compare the connection revision under a lock so late refreshes cannot resurrect
-- credentials after disconnect or overwrite a newer connection attempt.
create function public.save_calendar_credentials(
  p_verified_user_id uuid, p_connection_id uuid, p_expected_updated_at timestamptz,
  p_envelope text, p_key_version integer, p_scopes text[]
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
  insert into private.google_calendar_credentials(connection_id, user_id, refresh_token_envelope, encryption_key_version, last_refreshed_at)
    values(p_connection_id, p_verified_user_id, p_envelope, p_key_version, statement_timestamp())
    on conflict (connection_id) do update set refresh_token_envelope = excluded.refresh_token_envelope,
      encryption_key_version = excluded.encryption_key_version, last_refreshed_at = excluded.last_refreshed_at;
  return true;
end $$;

create function public.clear_calendar_credentials(
  p_verified_user_id uuid, p_state public.google_calendar_connection_state,
  p_expected_updated_at timestamptz default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_row public.google_calendar_connections%rowtype;
begin
  if p_state not in ('disconnected', 'reconnect_required') then
    raise exception using errcode = '22023', message = 'Invalid connection state.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_verified_user_id::text, 0));
  select * into current_row from public.google_calendar_connections where user_id = p_verified_user_id for update;
  if not found then
    insert into public.google_calendar_connections(user_id, connection_state) values(p_verified_user_id, p_state);
  end if;
  if p_expected_updated_at is not null and current_row.updated_at is distinct from p_expected_updated_at then return false; end if;
  delete from private.google_calendar_credentials where user_id = p_verified_user_id;
  update public.google_calendar_connections set connection_state = p_state, granted_scopes = '{}',
    last_successful_refresh_at = null where user_id = p_verified_user_id;
  -- An explicit disconnect also invalidates unfinished connect attempts.
  if p_state = 'disconnected' then
    update private.google_oauth_transactions set consumed_at = clock_timestamp(), code_verifier = null
      where user_id = p_verified_user_id and consumed_at is null;
  end if;
  return true;
end $$;

-- Preserve visibility during discovery, including an in-flight browser toggle.
create function public.sync_calendar_preferences(p_verified_user_id uuid, p_calendars jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if jsonb_typeof(p_calendars) <> 'array' or jsonb_array_length(p_calendars) > 5000 then
    raise exception using errcode = '22023', message = 'Invalid calendar list.';
  end if;
  insert into public.google_calendar_preferences(user_id, calendar_id, display_name, background_color, foreground_color, last_seen_at)
    select p_verified_user_id, value->>'calendarId', value->>'displayName', value->'color'->>'background',
      value->'color'->>'foreground', statement_timestamp() from jsonb_array_elements(p_calendars)
    on conflict(user_id, calendar_id) do update set display_name = excluded.display_name,
      background_color = excluded.background_color, foreground_color = excluded.foreground_color,
      last_seen_at = excluded.last_seen_at;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.display_name, p.calendar_id), '[]') into result
    from public.google_calendar_preferences p where p.user_id = p_verified_user_id
      and p.calendar_id in (select value->>'calendarId' from jsonb_array_elements(p_calendars));
  return result;
end $$;

revoke all on function public.begin_calendar_oauth_attempt(uuid,text,text,timestamptz,text) from public, anon, authenticated, orbitos_rpc;
revoke all on function public.consume_calendar_oauth_attempt(uuid,text,text) from public, anon, authenticated, orbitos_rpc;
revoke all on function public.read_calendar_credentials(uuid) from public, anon, authenticated, orbitos_rpc;
revoke all on function public.save_calendar_credentials(uuid,uuid,timestamptz,text,integer,text[]) from public, anon, authenticated, orbitos_rpc;
revoke all on function public.clear_calendar_credentials(uuid,public.google_calendar_connection_state,timestamptz) from public, anon, authenticated, orbitos_rpc;
revoke all on function public.sync_calendar_preferences(uuid,jsonb) from public, anon, authenticated, orbitos_rpc;
grant execute on function public.begin_calendar_oauth_attempt(uuid,text,text,timestamptz,text) to service_role;
grant execute on function public.consume_calendar_oauth_attempt(uuid,text,text) to service_role;
grant execute on function public.read_calendar_credentials(uuid) to service_role;
grant execute on function public.save_calendar_credentials(uuid,uuid,timestamptz,text,integer,text[]) to service_role;
grant execute on function public.clear_calendar_credentials(uuid,public.google_calendar_connection_state,timestamptz) to service_role;
grant execute on function public.sync_calendar_preferences(uuid,jsonb) to service_role;
