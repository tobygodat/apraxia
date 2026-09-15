-- One statement keeps the backup, lock, and schema changes atomic even when
-- the Supabase CLI applies migration statements separately.
do $migration$
begin
-- Retire Media without discarding existing user data. The backup is private,
-- has no API grants or policies, and is not used by the application.
lock table public.media in access exclusive mode;
create table private.retired_media (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  row_data jsonb not null
);
alter table private.retired_media enable row level security;
revoke all on table private.retired_media from public, anon, authenticated, service_role, orbitos_rpc;
insert into private.retired_media (id, user_id, row_data)
select id, user_id, to_jsonb(m) from public.media as m;

do $$
begin
  if (select count(*) from public.media) <> (select count(*) from private.retired_media) then
    raise exception 'Media backup count mismatch';
  end if;
end
$$;

drop function public.soft_delete_record(public.orbitos_record_type, uuid);
drop function public.restore_record(public.orbitos_record_type, uuid, timestamptz);
drop function public.search_records(text, integer, integer);
drop function internal.soft_delete_record(public.orbitos_record_type, uuid);
drop function internal.restore_record(public.orbitos_record_type, uuid, timestamptz);
drop table public.media;
drop type public.media_type;
drop type public.media_status;
drop type public.orbitos_record_type;
create type public.orbitos_record_type as enum ('todo', 'idea', 'project');

grant orbitos_rpc to postgres;
grant create on schema internal to orbitos_rpc;

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

revoke all on function internal.soft_delete_record(
  public.orbitos_record_type,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function internal.restore_record(
  public.orbitos_record_type,
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;

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

end
$migration$;
