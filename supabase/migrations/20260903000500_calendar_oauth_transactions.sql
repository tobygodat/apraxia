-- Server-only access to the private one-time OAuth store. These invoker RPCs
-- do not grant browser roles access to either transactions or credentials.
-- p_verified_user_id MUST be derived from the server-verified current session.
create function private.valid_calendar_oauth_transaction_input(
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
      p_redirect_uri ~ '^https://[^/?#@]+/api/calendar/callback$'
      or p_redirect_uri ~ '^http://(localhost|127(\.[0-9]{1,3}){3}|\[::1\])(:[0-9]{1,5})?/api/calendar/callback$'
    ),
    false
  )
$$;

comment on function private.valid_calendar_oauth_transaction_input(uuid,text,text)
is 'Structural bounds only. The server policy must derive the exact canonical redirect from configured APP_URL, never request data.';

create function public.begin_calendar_oauth_transaction(
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
  if not private.valid_calendar_oauth_transaction_input(
    p_verified_user_id, p_state_hash, p_redirect_uri
  ) then
    raise exception using errcode = '22023',
      message = 'Calendar authorization could not be verified.';
  end if;

  v_now := pg_catalog.clock_timestamp();
  if p_expires_at is null or not pg_catalog.isfinite(p_expires_at)
    or p_expires_at <= v_now then
    raise exception using errcode = '22023',
      message = 'Calendar authorization could not be verified.';
  end if;
  v_expires_at := least(p_expires_at, v_now + interval '10 minutes');

  insert into private.google_oauth_transactions (
    user_id, state_hash, redirect_uri, expires_at, created_at
  ) values (
    p_verified_user_id, p_state_hash, p_redirect_uri, v_expires_at, v_now
  ) returning id into v_id;

  return pg_catalog.jsonb_build_object('id', v_id, 'expires_at', v_expires_at);
exception
  when integrity_constraint_violation or data_exception then
    -- Do not expose the colliding hash, owner FK, or rejected field values.
    raise exception using errcode = '22023',
      message = 'Calendar authorization could not be verified.';
end
$$;

create function public.consume_calendar_oauth_transaction(
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
  v_transaction private.google_oauth_transactions%rowtype;
  v_now timestamptz;
begin
  if not private.valid_calendar_oauth_transaction_input(
    p_verified_user_id, p_state_hash, p_redirect_uri
  ) then
    raise exception using errcode = '22023',
      message = 'Calendar authorization could not be verified.';
  end if;

  -- Acquire the row lock BEFORE reading the real clock. A contender can wait
  -- past expiry; statement/transaction timestamps would accept a stale state.
  select transaction.* into v_transaction
  from private.google_oauth_transactions as transaction
  where transaction.user_id = p_verified_user_id
    and transaction.state_hash = p_state_hash
    and transaction.redirect_uri = p_redirect_uri
    and transaction.consumed_at is null
  for update;

  if not found then
    raise exception using errcode = '22023',
      message = 'Calendar authorization could not be verified.';
  end if;
  v_now := pg_catalog.clock_timestamp();
  if not pg_catalog.isfinite(v_transaction.expires_at)
    or not pg_catalog.isfinite(v_transaction.created_at)
    or v_transaction.expires_at <= v_now or v_transaction.created_at > v_now
    or v_transaction.expires_at > v_transaction.created_at + interval '10 minutes' then
    raise exception using errcode = '22023',
      message = 'Calendar authorization could not be verified.';
  end if;

  update private.google_oauth_transactions
  set consumed_at = v_now
  where id = v_transaction.id;

  return pg_catalog.jsonb_build_object('id', v_transaction.id, 'consumed_at', v_now);
exception
  when integrity_constraint_violation or data_exception then
    raise exception using errcode = '22023',
      message = 'Calendar authorization could not be verified.';
end
$$;

revoke all on function private.valid_calendar_oauth_transaction_input(uuid,text,text)
  from public, anon, authenticated, orbitos_rpc, service_role;
revoke all on function public.begin_calendar_oauth_transaction(uuid,text,text,timestamptz)
  from public, anon, authenticated, orbitos_rpc, service_role;
revoke all on function public.consume_calendar_oauth_transaction(uuid,text,text)
  from public, anon, authenticated, orbitos_rpc, service_role;
grant execute on function private.valid_calendar_oauth_transaction_input(uuid,text,text)
  to service_role;
grant execute on function public.begin_calendar_oauth_transaction(uuid,text,text,timestamptz)
  to service_role;
grant execute on function public.consume_calendar_oauth_transaction(uuid,text,text)
  to service_role;
