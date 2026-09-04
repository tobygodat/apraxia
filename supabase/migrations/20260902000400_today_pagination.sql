-- Complete Today pagination and scalar atomic-order confirmation.
-- Historical migrations stay unchanged. No application data is rewritten.
grant orbitos_rpc to postgres;
grant create on schema internal to orbitos_rpc;

-- Set-returning reads remain reusable in SQL but are no longer Data API endpoints.
alter function public.get_today_todos(date) set schema internal;

create function public.get_today_todos_page(
  p_local_date date,
  p_offset integer default 0,
  p_limit integer default 200,
  p_snapshot_token text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  v_uid uuid := auth.uid();
  v_total bigint;
  v_token text;
  v_items jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_offset is null or p_offset < 0
    or p_limit is null or p_limit < 1 or p_limit > 200
    or (p_offset > 0 and p_snapshot_token is null)
    or (p_snapshot_token is not null and p_snapshot_token !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'invalid Today page request';
  end if;

  -- A STABLE function observes one statement snapshot across metadata and rows.
  -- Hash only browser-safe owned fields, including project titles and exact
  -- timestamps; a concurrent edit must never splice two different snapshots.
  with ordered as materialized (
    select
      row_number() over (order by
        case when t.today_rank is null then 1 else 0 end,
        t.today_rank nulls last, t.due_date, t.due_time nulls last,
        t.created_at, t.id
      ) as row_number,
      t.*
    from internal.get_today_todos(p_local_date) as t
  ),
  summary as (
    select count(*) as total_count,
      encode(sha256(convert_to(
        v_uid::text || '|' || p_local_date::text || '|' ||
        coalesce(string_agg(
          encode(sha256(convert_to((to_jsonb(ordered) - 'row_number')::text, 'UTF8')), 'hex'),
          ',' order by row_number
        ), ''),
        'UTF8'
      )), 'hex') as token
    from ordered
  ),
  bounded_page as (
    select * from ordered order by row_number limit p_limit offset p_offset
  )
  select summary.total_count, summary.token,
    coalesce((
      select jsonb_agg(to_jsonb(bounded_page) - 'row_number' order by row_number)
      from bounded_page
    ), '[]'::jsonb)
  into v_total, v_token, v_items
  from summary;

  if p_snapshot_token is not null and p_snapshot_token <> v_token then
    raise exception using errcode = '40001', message = 'Today changed while loading';
  end if;
  if p_offset > v_total then
    raise exception using errcode = '22023', message = 'invalid Today page request';
  end if;
  return jsonb_build_object(
    'local_date', p_local_date,
    'offset', p_offset,
    'total_count', v_total,
    'snapshot_token', v_token,
    'items', v_items
  );
end
$$;

create or replace function internal.reorder_today_todos(
  p_local_date date,
  p_todo_ids uuid[]
)
returns table (todo_id uuid, today_rank bigint)
language plpgsql
volatile
security definer
set search_path = ''
set row_security = on
as $$
declare
  v_uid uuid := internal.request_user_id();
  v_input_count integer;
  v_distinct_count integer;
  v_eligible_count integer;
  v_matched_count integer;
  v_profile_local_date date;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  if p_local_date is null
    or p_todo_ids is null
    or coalesce(array_ndims(p_todo_ids), 1) <> 1 then
    raise exception using
      errcode = '22023',
      message = 'invalid Today reorder request';
  end if;

  -- The profile-timezone trigger takes the same transaction-scoped lock before
  -- clearing ranks. This prevents either operation from observing the other's
  -- half-finished interpretation of local Today eligibility.
  perform internal.lock_today_order(v_uid);

  select (
    statement_timestamp() at time zone profile.timezone
  )::date
  into v_profile_local_date
  from public.profiles as profile
  where profile.user_id = v_uid;

  if v_profile_local_date is distinct from p_local_date then
    raise exception using
      errcode = '22023',
      message = 'invalid Today reorder request';
  end if;

  select count(*)::integer, count(distinct input.id)::integer
  into v_input_count, v_distinct_count
  from unnest(p_todo_ids) as input (id);

  if v_input_count <> v_distinct_count then
    raise exception using
      errcode = '22023',
      message = 'Today list changed; reload and try again';
  end if;

  perform t.id
  from public.todos as t
  where t.user_id = v_uid
    and t.completed_at is null
    and t.deleted_at is null
    and t.due_date is not null
    and t.due_date <= p_local_date
  order by t.id
  for update;

  select count(*)::integer
  into v_eligible_count
  from public.todos as t
  where t.user_id = v_uid
    and t.completed_at is null
    and t.deleted_at is null
    and t.due_date is not null
    and t.due_date <= p_local_date;

  select count(*)::integer
  into v_matched_count
  from public.todos as t
  where t.user_id = v_uid
    and t.completed_at is null
    and t.deleted_at is null
    and t.due_date is not null
    and t.due_date <= p_local_date
    and t.id = any (p_todo_ids);

  if v_eligible_count <> v_input_count
    or v_matched_count <> v_input_count then
    raise exception using
      errcode = '22023',
      message = 'Today list changed; reload and try again';
  end if;

  return query
  with desired as (
    select
      input.id,
      (input.ordinality * 1024)::bigint as rank
    from unnest(p_todo_ids) with ordinality as input (id, ordinality)
  ),
  changed as (
    update public.todos as t
    set today_rank = desired.rank
    from desired
    where t.id = desired.id
      and t.user_id = v_uid
    returning t.id, t.today_rank
  )
  select changed.id, changed.today_rank
  from changed
  order by changed.today_rank;
end
$$;

-- A mutating RPC must not be paginated or repeated just to fetch its result.
-- Change only this public wrapper's return type, retaining one internal write.
drop function public.reorder_today_todos(date, uuid[]);
create function public.reorder_today_todos(
  p_local_date date,
  p_todo_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count bigint;
  v_valid_ranks boolean;
  v_fingerprint text;
begin
  with saved as materialized (
    select * from internal.reorder_today_todos(p_local_date, p_todo_ids)
  ),
  ranked as (
    select todo_id, today_rank,
      row_number() over (order by today_rank) as ordinal
    from saved
  )
  select count(*),
    coalesce(bool_and(today_rank = ordinal * 1024), true),
    encode(sha256(convert_to(
      coalesce(string_agg(todo_id::text, ',' order by today_rank), ''), 'UTF8'
    )), 'hex')
  into v_count, v_valid_ranks, v_fingerprint
  from ranked;

  if not v_valid_ranks or v_count <> cardinality(p_todo_ids) then
    raise exception using errcode = '22023', message = 'Today order was not confirmed';
  end if;
  return jsonb_build_object(
    'local_date', p_local_date,
    'applied_count', v_count,
    'rank_step', 1024,
    'order_fingerprint', v_fingerprint
  );
end
$$;

-- Explicit grants are required; public wrappers remain invoker-only.
revoke all on function internal.get_today_todos(date)
  from public, anon, authenticated, service_role;
revoke all on function internal.reorder_today_todos(date, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.get_today_todos_page(date, integer, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reorder_today_todos(date, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function internal.get_today_todos(date) to authenticated;
grant execute on function internal.reorder_today_todos(date, uuid[]) to authenticated;
grant execute on function public.get_today_todos_page(date, integer, integer, text) to authenticated;
grant execute on function public.reorder_today_todos(date, uuid[]) to authenticated;

revoke create on schema internal from orbitos_rpc;
revoke orbitos_rpc from postgres;
notify pgrst, 'reload schema';
