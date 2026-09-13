-- Separate Drive grant and private credential store; Calendar is unchanged.
create table public.google_drive_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  google_account_id text,
  display_email text,
  connection_state public.google_calendar_connection_state not null
    default 'disconnected',
  granted_scopes text[] not null default '{}',
  last_successful_refresh_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint google_drive_connections_one_per_user unique (user_id),
  constraint google_drive_connections_owner_id_unique unique (user_id, id),
  constraint google_drive_connections_account_nonempty check (
    google_account_id is null or btrim(google_account_id) <> ''
  ),
  constraint google_drive_connections_email_nonempty check (
    display_email is null or btrim(display_email) <> ''
  ),
  constraint google_drive_connections_scope_elements_nonnull check (
    array_position(granted_scopes, null) is null
  )
);

create table private.google_drive_credentials (
  connection_id uuid primary key,
  user_id uuid not null,
  refresh_token_envelope text not null,
  encryption_key_version integer not null,
  token_rotated_at timestamptz,
  last_refreshed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint google_drive_credentials_connection_owner foreign key (
    user_id,
    connection_id
  ) references public.google_drive_connections (user_id, id)
    on delete cascade,
  constraint google_drive_credentials_envelope_nonempty check (
    btrim(refresh_token_envelope) <> ''
  ),
  constraint google_drive_credentials_key_version_positive check (
    encryption_key_version > 0
  )
);

create table private.google_drive_oauth_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  state_hash text not null unique,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint google_drive_oauth_state_sha256_hex check (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_drive_oauth_redirect_nonempty check (
    btrim(redirect_uri) <> ''
  ),
  constraint google_drive_oauth_expiry_after_creation check (
    expires_at > created_at
  ),
  constraint google_drive_oauth_consumed_after_creation check (
    consumed_at is null or consumed_at >= created_at
  )
);

alter table public.google_drive_connections enable row level security;
revoke all on table public.google_drive_connections from public, anon, authenticated, orbitos_rpc;
grant select, insert, update, delete on table public.google_drive_connections to service_role;
alter table private.google_drive_credentials enable row level security;
revoke all on table private.google_drive_credentials from public, anon, authenticated, orbitos_rpc;
grant select, insert, update, delete on table private.google_drive_credentials to service_role;
alter table private.google_drive_oauth_transactions enable row level security;
revoke all on table private.google_drive_oauth_transactions from public, anon, authenticated, orbitos_rpc;
grant select, insert, update, delete on table private.google_drive_oauth_transactions to service_role;

-- Server-only access to the private one-time OAuth store. These invoker RPCs
-- do not grant browser roles access to either transactions or credentials.
-- p_verified_user_id MUST be derived from the server-verified current session.
create function private.valid_drive_oauth_transaction_input(
  p_verified_user_id uuid,
  p_state_hash text,
  p_redirect_uri text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    p_verified_user_id <> '00000000-0000-0000-0000-000000000000'::uuid
    and p_state_hash collate "C" ~ '^[0-9a-f]{64}$'
    and pg_catalog.length(p_redirect_uri) between 1 and 4096
    and p_redirect_uri collate "C" ~ '^[!-~]+$'
    and position(pg_catalog.chr(92) in p_redirect_uri) = 0
    and (
      p_redirect_uri ~ '^https://[^/?#@]+/api/drive/callback$'
      or p_redirect_uri ~ '^http://(localhost|127(\.[0-9]{1,3}){3}|\[::1\])(:[0-9]{1,5})?/api/drive/callback$'
    ),
    false
  )
$$;

comment on function private.valid_drive_oauth_transaction_input(uuid,text,text)
is 'Structural bounds only. The server policy must derive the exact canonical redirect from configured APP_URL, never request data.';

create function public.begin_drive_oauth_transaction(
  p_verified_user_id uuid,
  p_state_hash text,
  p_redirect_uri text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_now timestamptz;
  v_expires_at timestamptz;
  v_id uuid;
begin
  if not private.valid_drive_oauth_transaction_input(
    p_verified_user_id, p_state_hash, p_redirect_uri
  ) then
    raise exception using errcode = '22023',
      message = 'Drive authorization could not be verified.';
  end if;

  v_now := pg_catalog.clock_timestamp();
  if p_expires_at is null or not pg_catalog.isfinite(p_expires_at)
    or p_expires_at <= v_now then
    raise exception using errcode = '22023',
      message = 'Drive authorization could not be verified.';
  end if;
  v_expires_at := least(p_expires_at, v_now + interval '10 minutes');

  insert into private.google_drive_oauth_transactions (
    user_id, state_hash, redirect_uri, expires_at, created_at
  ) values (
    p_verified_user_id, p_state_hash, p_redirect_uri, v_expires_at, v_now
  ) returning id into v_id;

  return pg_catalog.jsonb_build_object('id', v_id, 'expires_at', v_expires_at);
exception
  when integrity_constraint_violation or data_exception then
    -- Do not expose the colliding hash, owner FK, or rejected field values.
    raise exception using errcode = '22023',
      message = 'Drive authorization could not be verified.';
end
$$;

create function public.consume_drive_oauth_transaction(
  p_verified_user_id uuid,
  p_state_hash text,
  p_redirect_uri text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_transaction private.google_drive_oauth_transactions%rowtype;
  v_now timestamptz;
begin
  if not private.valid_drive_oauth_transaction_input(
    p_verified_user_id, p_state_hash, p_redirect_uri
  ) then
    raise exception using errcode = '22023',
      message = 'Drive authorization could not be verified.';
  end if;

  -- Acquire the row lock BEFORE reading the real clock. A contender can wait
  -- past expiry; statement/transaction timestamps would accept a stale state.
  select transaction.* into v_transaction
  from private.google_drive_oauth_transactions as transaction
  where transaction.user_id = p_verified_user_id
    and transaction.state_hash = p_state_hash
    and transaction.redirect_uri = p_redirect_uri
    and transaction.consumed_at is null
  for update;

  if not found then
    raise exception using errcode = '22023',
      message = 'Drive authorization could not be verified.';
  end if;
  v_now := pg_catalog.clock_timestamp();
  if not pg_catalog.isfinite(v_transaction.expires_at)
    or not pg_catalog.isfinite(v_transaction.created_at)
    or v_transaction.expires_at <= v_now or v_transaction.created_at > v_now
    or v_transaction.expires_at > v_transaction.created_at + interval '10 minutes' then
    raise exception using errcode = '22023',
      message = 'Drive authorization could not be verified.';
  end if;

  update private.google_drive_oauth_transactions
  set consumed_at = v_now
  where id = v_transaction.id;

  return pg_catalog.jsonb_build_object('id', v_transaction.id, 'consumed_at', v_now);
exception
  when integrity_constraint_violation or data_exception then
    raise exception using errcode = '22023',
      message = 'Drive authorization could not be verified.';
end
$$;

revoke all on function private.valid_drive_oauth_transaction_input(uuid,text,text)
  from public, anon, authenticated, orbitos_rpc, service_role;
revoke all on function public.begin_drive_oauth_transaction(uuid,text,text,timestamptz)
  from public, anon, authenticated, orbitos_rpc, service_role;
revoke all on function public.consume_drive_oauth_transaction(uuid,text,text)
  from public, anon, authenticated, orbitos_rpc, service_role;
grant execute on function private.valid_drive_oauth_transaction_input(uuid,text,text)
  to service_role;
grant execute on function public.begin_drive_oauth_transaction(uuid,text,text,timestamptz)
  to service_role;
grant execute on function public.consume_drive_oauth_transaction(uuid,text,text)
  to service_role;

-- Drive adapters use only service-role RPCs; private is never exposed to PostgREST.
alter table private.google_drive_oauth_transactions add column code_verifier text;

create function public.begin_drive_oauth_attempt(
  p_verified_user_id uuid, p_state_hash text, p_redirect_uri text,
  p_expires_at timestamptz, p_code_verifier text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_code_verifier is null or p_code_verifier !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = '22023', message = 'Invalid Drive attempt.';
  end if;
  result := public.begin_drive_oauth_transaction(p_verified_user_id, p_state_hash, p_redirect_uri, p_expires_at);
  update private.google_drive_oauth_transactions set code_verifier = p_code_verifier
    where id = (result->>'id')::uuid;
  return result;
end $$;

create function public.consume_drive_oauth_attempt(
  p_verified_user_id uuid, p_state_hash text, p_redirect_uri text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb; verifier text;
begin
  result := public.consume_drive_oauth_transaction(p_verified_user_id, p_state_hash, p_redirect_uri);
  select code_verifier into verifier from private.google_drive_oauth_transactions where id = (result->>'id')::uuid;
  if verifier is null then
    raise exception using errcode = '22023', message = 'Invalid Drive attempt.';
  end if;
  update private.google_drive_oauth_transactions set code_verifier = null where id = (result->>'id')::uuid;
  return result || jsonb_build_object('code_verifier', verifier);
end $$;

create function public.read_drive_credentials(p_verified_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  select jsonb_build_object('connection', to_jsonb(c), 'envelope', s.refresh_token_envelope,
    'key_version', s.encryption_key_version) into result
  from public.google_drive_connections c
  left join private.google_drive_credentials s on s.connection_id = c.id and s.user_id = c.user_id
  where c.user_id = p_verified_user_id;
  return result;
end $$;

-- Compare the connection revision under a lock so late refreshes cannot resurrect
-- credentials after disconnect or overwrite a newer connection attempt.
create function public.save_drive_credentials(
  p_verified_user_id uuid, p_connection_id uuid, p_expected_updated_at timestamptz,
  p_envelope text, p_key_version integer, p_scopes text[]
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
  insert into private.google_drive_credentials(connection_id, user_id, refresh_token_envelope, encryption_key_version, last_refreshed_at)
    values(p_connection_id, p_verified_user_id, p_envelope, p_key_version, statement_timestamp())
    on conflict (connection_id) do update set refresh_token_envelope = excluded.refresh_token_envelope,
      encryption_key_version = excluded.encryption_key_version, last_refreshed_at = excluded.last_refreshed_at;
  return true;
end $$;

create function public.clear_drive_credentials(
  p_verified_user_id uuid, p_state public.google_calendar_connection_state,
  p_expected_updated_at timestamptz default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare current_row public.google_drive_connections%rowtype;
begin
  if p_state not in ('disconnected', 'reconnect_required') then
    raise exception using errcode = '22023', message = 'Invalid connection state.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_verified_user_id::text, 0));
  select * into current_row from public.google_drive_connections where user_id = p_verified_user_id for update;
  if not found then
    insert into public.google_drive_connections(user_id, connection_state) values(p_verified_user_id, p_state);
  end if;
  if p_expected_updated_at is not null and current_row.updated_at is distinct from p_expected_updated_at then return false; end if;
  delete from private.google_drive_credentials where user_id = p_verified_user_id;
  update public.google_drive_connections set connection_state = p_state, granted_scopes = '{}',
    last_successful_refresh_at = null where user_id = p_verified_user_id;
  -- An explicit disconnect also invalidates unfinished connect attempts.
  if p_state = 'disconnected' then
    update private.google_drive_oauth_transactions set consumed_at = clock_timestamp(), code_verifier = null
      where user_id = p_verified_user_id and consumed_at is null;
  end if;
  return true;
end $$;

revoke all on function public.begin_drive_oauth_attempt(uuid,text,text,timestamptz,text) from public, anon, authenticated, orbitos_rpc;
revoke all on function public.consume_drive_oauth_attempt(uuid,text,text) from public, anon, authenticated, orbitos_rpc;
revoke all on function public.read_drive_credentials(uuid) from public, anon, authenticated, orbitos_rpc;
revoke all on function public.save_drive_credentials(uuid,uuid,timestamptz,text,integer,text[]) from public, anon, authenticated, orbitos_rpc;
revoke all on function public.clear_drive_credentials(uuid,public.google_calendar_connection_state,timestamptz) from public, anon, authenticated, orbitos_rpc;
grant execute on function public.begin_drive_oauth_attempt(uuid,text,text,timestamptz,text) to service_role;
grant execute on function public.consume_drive_oauth_attempt(uuid,text,text) to service_role;
grant execute on function public.read_drive_credentials(uuid) to service_role;
grant execute on function public.save_drive_credentials(uuid,uuid,timestamptz,text,integer,text[]) to service_role;
grant execute on function public.clear_drive_credentials(uuid,public.google_calendar_connection_state,timestamptz) to service_role;

create trigger google_drive_connections_set_updated_at before update on public.google_drive_connections
for each row execute function private.set_updated_at();
create trigger google_drive_credentials_set_updated_at before update on private.google_drive_credentials
for each row execute function private.set_updated_at();
create index google_drive_oauth_unconsumed_expiry_idx on private.google_drive_oauth_transactions(expires_at) where consumed_at is null;
