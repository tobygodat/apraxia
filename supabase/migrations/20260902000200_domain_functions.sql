-- Phase 1: user-scoped Today, lifecycle, and global-search RPCs.

create function public.get_today_todos(p_local_date date)
returns table (
  id uuid,
  text text,
  due_date date,
  due_time time without time zone,
  project_id uuid,
  project_title text,
  today_rank bigint,
  is_overdue boolean,
  is_manually_ordered boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_local_date date;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  if p_local_date is null then
    raise exception using
      errcode = '22023',
      message = 'local date changed; refresh and try again';
  end if;

  select (
    statement_timestamp() at time zone profile.timezone
  )::date
  into v_profile_local_date
  from public.profiles as profile
  where profile.user_id = v_uid;

  if v_profile_local_date is distinct from p_local_date then
    raise exception using
      errcode = '22023',
      message = 'local date changed; refresh and try again';
  end if;

  return query
  select
    t.id,
    t.text,
    t.due_date,
    t.due_time,
    t.project_id,
    p.title,
    t.today_rank,
    t.due_date < p_local_date,
    t.today_rank is not null,
    t.created_at,
    t.updated_at
  from public.todos as t
  left join public.projects as p
    on p.id = t.project_id
   and p.user_id = t.user_id
   and p.deleted_at is null
  where t.user_id = v_uid
    and t.completed_at is null
    and t.deleted_at is null
    and t.due_date is not null
    and t.due_date <= p_local_date
  order by
    case when t.today_rank is null then 1 else 0 end,
    t.today_rank nulls last,
    t.due_date,
    t.due_time nulls last,
    t.created_at,
    t.id;
end
$$;

create function internal.reorder_today_todos(
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
    or cardinality(p_todo_ids) > 1000 then
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

alter function internal.reorder_today_todos(date, uuid[])
  owner to orbitos_rpc;

create function public.reorder_today_todos(
  p_local_date date,
  p_todo_ids uuid[]
)
returns table (todo_id uuid, today_rank bigint)
language sql
volatile
security invoker
set search_path = ''
as $$
  select result.todo_id, result.today_rank
  from internal.reorder_today_todos(p_local_date, p_todo_ids) as result
$$;

create function internal.soft_delete_record(
  p_record_type public.orbitos_record_type,
  p_record_id uuid
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
set row_security = on
as $$
declare
  v_uid uuid := internal.request_user_id();
  v_deleted_at timestamptz := statement_timestamp();
  v_result timestamptz;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  case p_record_type
    when 'todo' then
      update public.todos
      set deleted_at = v_deleted_at,
          today_rank = null
      where id = p_record_id
        and user_id = v_uid
        and deleted_at is null
      returning deleted_at into v_result;
    when 'idea' then
      update public.ideas
      set deleted_at = v_deleted_at
      where id = p_record_id
        and user_id = v_uid
        and deleted_at is null
      returning deleted_at into v_result;
    when 'media' then
      update public.media
      set deleted_at = v_deleted_at
      where id = p_record_id
        and user_id = v_uid
        and deleted_at is null
      returning deleted_at into v_result;
    when 'project' then
      update public.projects
      set deleted_at = v_deleted_at
      where id = p_record_id
        and user_id = v_uid
        and deleted_at is null
      returning deleted_at into v_result;
    else
      raise exception using
        errcode = '22023',
        message = 'invalid record type';
  end case;

  return v_result;
end
$$;

alter function internal.soft_delete_record(public.orbitos_record_type, uuid)
  owner to orbitos_rpc;

create function public.soft_delete_record(
  p_record_type public.orbitos_record_type,
  p_record_id uuid
)
returns timestamptz
language sql
volatile
security invoker
set search_path = ''
as $$
  select internal.soft_delete_record(p_record_type, p_record_id)
$$;

create function internal.restore_record(
  p_record_type public.orbitos_record_type,
  p_record_id uuid,
  p_deleted_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
set row_security = on
as $$
declare
  v_uid uuid := internal.request_user_id();
  v_restored_count bigint := 0;
begin
  if v_uid is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  case p_record_type
    when 'todo' then
      update public.todos
      set deleted_at = null,
          today_rank = null
      where id = p_record_id
        and user_id = v_uid
        and deleted_at = p_deleted_at;
    when 'idea' then
      update public.ideas
      set deleted_at = null
      where id = p_record_id
        and user_id = v_uid
        and deleted_at = p_deleted_at;
    when 'media' then
      update public.media
      set deleted_at = null
      where id = p_record_id
        and user_id = v_uid
        and deleted_at = p_deleted_at;
    when 'project' then
      update public.projects
      set deleted_at = null
      where id = p_record_id
        and user_id = v_uid
        and deleted_at = p_deleted_at;
    else
      raise exception using
        errcode = '22023',
        message = 'invalid record type';
  end case;

  get diagnostics v_restored_count = row_count;
  return v_restored_count > 0;
end
$$;

alter function internal.restore_record(
  public.orbitos_record_type,
  uuid,
  timestamptz
) owner to orbitos_rpc;

create function public.restore_record(
  p_record_type public.orbitos_record_type,
  p_record_id uuid,
  p_deleted_at timestamptz
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select internal.restore_record(
    p_record_type,
    p_record_id,
    p_deleted_at
  )
$$;

create function public.search_records(
  p_query text,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table (
  record_type public.orbitos_record_type,
  record_id uuid,
  title text,
  snippet text,
  updated_at timestamptz,
  relevance real,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query_text text := btrim(coalesce(p_query, ''));
  v_query tsquery;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  if char_length(v_query_text) > 256 then
    raise exception using
      errcode = '22023',
      message = 'search query is too long';
  end if;

  if p_limit is null
    or p_limit < 1
    or p_limit > 100
    or p_offset is null
    or p_offset < 0
    or p_offset > 10000 then
    raise exception using
      errcode = '22023',
      message = 'invalid search pagination';
  end if;

  if v_query_text = '' then
    return;
  end if;

  v_query := websearch_to_tsquery('simple'::regconfig, v_query_text);
  if numnode(v_query) = 0 then
    return;
  end if;

  if querytree(v_query)::text in ('', 'T') then
    return;
  end if;

  return query
  with matches as (
    select
      'todo'::public.orbitos_record_type as record_type,
      t.id as record_id,
      left(t.text, 160) as title,
      left(t.text, 200) as snippet,
      t.updated_at,
      ts_rank_cd(t.search_vector, v_query)::real as relevance
    from public.todos as t
    where t.user_id = (select auth.uid())
      and t.deleted_at is null
      and t.search_vector @@ v_query

    union all

    select
      'idea'::public.orbitos_record_type,
      i.id,
      left(coalesce(i.title, left(i.body, 80)), 160),
      left(i.body, 200),
      i.updated_at,
      ts_rank_cd(i.search_vector, v_query)::real
    from public.ideas as i
    where i.user_id = (select auth.uid())
      and i.deleted_at is null
      and i.search_vector @@ v_query

    union all

    select
      'media'::public.orbitos_record_type,
      m.id,
      left(m.title, 160),
      left(
        concat_ws(' · ', nullif(m.creator, ''), nullif(m.notes, '')),
        200
      ),
      m.updated_at,
      ts_rank_cd(m.search_vector, v_query)::real
    from public.media as m
    where m.user_id = (select auth.uid())
      and m.deleted_at is null
      and m.search_vector @@ v_query

    union all

    select
      'project'::public.orbitos_record_type,
      p.id,
      left(p.title, 160),
      left(coalesce(p.description, ''), 200),
      p.updated_at,
      ts_rank_cd(p.search_vector, v_query)::real
    from public.projects as p
    where p.user_id = (select auth.uid())
      and p.deleted_at is null
      and p.search_vector @@ v_query
  ),
  counted as (
    select
      matches.*,
      count(*) over () as total_count
    from matches
  )
  select
    counted.record_type,
    counted.record_id,
    counted.title,
    counted.snippet,
    counted.updated_at,
    counted.relevance,
    counted.total_count
  from counted
  order by
    counted.relevance desc,
    counted.updated_at desc,
    counted.record_type,
    counted.record_id
  limit p_limit
  offset p_offset;
end
$$;

revoke all on function public.get_today_todos(date)
  from public, anon, authenticated, service_role;
revoke all on function public.reorder_today_todos(date, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.soft_delete_record(
  public.orbitos_record_type,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function public.restore_record(
  public.orbitos_record_type,
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.search_records(text, integer, integer)
  from public, anon, authenticated, service_role;

revoke all on function internal.reorder_today_todos(date, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function internal.soft_delete_record(
  public.orbitos_record_type,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function internal.restore_record(
  public.orbitos_record_type,
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.get_today_todos(date) to authenticated;
grant execute on function public.reorder_today_todos(date, uuid[])
  to authenticated;
grant execute on function public.soft_delete_record(
  public.orbitos_record_type,
  uuid
) to authenticated;
grant execute on function public.restore_record(
  public.orbitos_record_type,
  uuid,
  timestamptz
) to authenticated;
grant execute on function public.search_records(text, integer, integer)
  to authenticated;

grant execute on function internal.reorder_today_todos(date, uuid[])
  to authenticated;
grant execute on function internal.soft_delete_record(
  public.orbitos_record_type,
  uuid
) to authenticated;
grant execute on function internal.restore_record(
  public.orbitos_record_type,
  uuid,
  timestamptz
) to authenticated;

revoke create on schema internal from orbitos_rpc;
revoke orbitos_rpc from postgres;
