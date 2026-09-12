-- Workspace reliability: explicit draft IDs, optimistic edit versions, and
-- one RLS-respecting cursor page chain for collection reads.

grant insert (id) on table public.projects, public.todos, public.ideas, public.media to authenticated;

create index if not exists todos_user_updated_active_idx
  on public.todos (user_id, updated_at desc, id asc)
  where deleted_at is null;
create index if not exists ideas_user_project_updated_active_idx
  on public.ideas (user_id, project_id, updated_at desc, id asc)
  where deleted_at is null;

create function public.list_collection_page(
  p_record_type public.orbitos_record_type,
  p_project_id uuid default null,
  p_status text default 'all',
  p_media_type text default 'all',
  p_cursor text default null,
  p_snapshot_token text default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_cursor text;
  v_cursor_updated timestamptz;
  v_cursor_id uuid;
  v_snapshot text;
  v_items jsonb := '[]'::jsonb;
  v_next_cursor text := null;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100
    or (p_cursor is not null and (length(p_cursor) > 512 or p_cursor !~ '^[A-Za-z0-9+/=_-]+$'))
    or (p_snapshot_token is not null and p_snapshot_token !~ '^[0-9a-f]{64}$') then
    raise exception using errcode = '22023', message = 'invalid collection page request';
  end if;
  if p_cursor is not null then
    begin
      v_cursor := convert_from(pg_catalog.decode(replace(replace(p_cursor, '-', '+'), '_', '/'), 'base64'), 'UTF8');
      v_cursor_updated := split_part(v_cursor, '|', 1)::timestamptz;
      v_cursor_id := split_part(v_cursor, '|', 2)::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid collection cursor';
    end;
  end if;

  if p_record_type = 'project' then
    if p_status not in ('all', 'active', 'someday', 'completed', 'archived') then
      raise exception using errcode = '22023', message = 'invalid project filter';
    end if;
    with matching as materialized (
      select p.id, p.updated_at from public.projects p
      where p.user_id = v_uid and p.deleted_at is null
        and (p_status = 'all' or p.status::text = p_status)
    )
    select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      coalesce(string_agg(m.id::text || '|' || m.updated_at::text, ',' order by m.updated_at desc, m.id), ''), 'UTF8')), 'hex')
      into v_snapshot from matching m;
    with page as (
      select p.* from public.projects p
      where p.user_id = v_uid and p.deleted_at is null
        and (p_status = 'all' or p.status::text = p_status)
        and (p_cursor is null or (p.updated_at, p.id) < (v_cursor_updated, v_cursor_id))
      order by p.updated_at desc, p.id asc limit p_limit
    )
    select coalesce(jsonb_agg(to_jsonb(page) order by page.updated_at desc, page.id), '[]'::jsonb) into v_items from page;
    with page as (
      select p.updated_at, p.id from public.projects p
      where p.user_id = v_uid and p.deleted_at is null
        and (p_status = 'all' or p.status::text = p_status)
        and (p_cursor is null or (p.updated_at, p.id) < (v_cursor_updated, v_cursor_id))
      order by p.updated_at desc, p.id asc limit p_limit
    )
    select case when count(*) = p_limit then (select pg_catalog.encode(pg_catalog.convert_to(last_row.updated_at::text || '|' || last_row.id::text, 'UTF8'), 'base64') from page last_row order by last_row.updated_at asc, last_row.id desc limit 1) else null end
      into v_next_cursor from page;
  elsif p_record_type = 'idea' then
    with matching as materialized (
      select i.id, i.updated_at from public.ideas i
      where i.user_id = v_uid and i.deleted_at is null and (p_project_id is null or i.project_id = p_project_id)
    )
    select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      coalesce(string_agg(m.id::text || '|' || m.updated_at::text, ',' order by m.updated_at desc, m.id), ''), 'UTF8')), 'hex')
      into v_snapshot from matching m;
    with page as (
      select i.* from public.ideas i
      where i.user_id = v_uid and i.deleted_at is null and (p_project_id is null or i.project_id = p_project_id)
        and (p_cursor is null or (i.updated_at, i.id) < (v_cursor_updated, v_cursor_id))
      order by i.updated_at desc, i.id asc limit p_limit
    )
    select coalesce(jsonb_agg(to_jsonb(page) order by page.updated_at desc, page.id), '[]'::jsonb) into v_items from page;
    with page as (
      select i.updated_at, i.id from public.ideas i
      where i.user_id = v_uid and i.deleted_at is null and (p_project_id is null or i.project_id = p_project_id)
        and (p_cursor is null or (i.updated_at, i.id) < (v_cursor_updated, v_cursor_id))
      order by i.updated_at desc, i.id asc limit p_limit
    )
    select case when count(*) = p_limit then (select pg_catalog.encode(pg_catalog.convert_to(last_row.updated_at::text || '|' || last_row.id::text, 'UTF8'), 'base64') from page last_row order by last_row.updated_at asc, last_row.id desc limit 1) else null end
      into v_next_cursor from page;
  elsif p_record_type = 'media' then
    if p_status not in ('all', 'saved', 'in_progress', 'finished') or p_media_type not in ('all', 'book', 'movie') then
      raise exception using errcode = '22023', message = 'invalid media filter';
    end if;
    with matching as materialized (
      select m.id, m.updated_at from public.media m
      where m.user_id = v_uid and m.deleted_at is null
        and (p_status = 'all' or m.status::text = p_status) and (p_media_type = 'all' or m.media_type::text = p_media_type)
    )
    select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      coalesce(string_agg(m.id::text || '|' || m.updated_at::text, ',' order by m.updated_at desc, m.id), ''), 'UTF8')), 'hex')
      into v_snapshot from matching m;
    with page as (
      select m.* from public.media m
      where m.user_id = v_uid and m.deleted_at is null
        and (p_status = 'all' or m.status::text = p_status) and (p_media_type = 'all' or m.media_type::text = p_media_type)
        and (p_cursor is null or (m.updated_at, m.id) < (v_cursor_updated, v_cursor_id))
      order by m.updated_at desc, m.id asc limit p_limit
    )
    select coalesce(jsonb_agg(to_jsonb(page) order by page.updated_at desc, page.id), '[]'::jsonb) into v_items from page;
    with page as (
      select m.updated_at, m.id from public.media m
      where m.user_id = v_uid and m.deleted_at is null
        and (p_status = 'all' or m.status::text = p_status) and (p_media_type = 'all' or m.media_type::text = p_media_type)
        and (p_cursor is null or (m.updated_at, m.id) < (v_cursor_updated, v_cursor_id))
      order by m.updated_at desc, m.id asc limit p_limit
    )
    select case when count(*) = p_limit then (select pg_catalog.encode(pg_catalog.convert_to(last_row.updated_at::text || '|' || last_row.id::text, 'UTF8'), 'base64') from page last_row order by last_row.updated_at asc, last_row.id desc limit 1) else null end
      into v_next_cursor from page;
  else
    with matching as materialized (
      select t.id, t.updated_at from public.todos t
      where t.user_id = v_uid and t.deleted_at is null and (p_project_id is null or t.project_id = p_project_id)
    )
    select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      coalesce(string_agg(m.id::text || '|' || m.updated_at::text, ',' order by m.updated_at desc, m.id), ''), 'UTF8')), 'hex')
      into v_snapshot from matching m;
    with page as (
      select t.* from public.todos t
      where t.user_id = v_uid and t.deleted_at is null and (p_project_id is null or t.project_id = p_project_id)
        and (p_cursor is null or (t.updated_at, t.id) < (v_cursor_updated, v_cursor_id))
      order by t.updated_at desc, t.id asc limit p_limit
    )
    select coalesce(jsonb_agg(to_jsonb(page) order by page.updated_at desc, page.id), '[]'::jsonb) into v_items from page;
    with page as (
      select t.updated_at, t.id from public.todos t
      where t.user_id = v_uid and t.deleted_at is null and (p_project_id is null or t.project_id = p_project_id)
        and (p_cursor is null or (t.updated_at, t.id) < (v_cursor_updated, v_cursor_id))
      order by t.updated_at desc, t.id asc limit p_limit
    )
    select case when count(*) = p_limit then (select pg_catalog.encode(pg_catalog.convert_to(last_row.updated_at::text || '|' || last_row.id::text, 'UTF8'), 'base64') from page last_row order by last_row.updated_at asc, last_row.id desc limit 1) else null end
      into v_next_cursor from page;
  end if;

  if p_snapshot_token is not null and p_snapshot_token <> v_snapshot then
    raise exception using errcode = '40001', message = 'Collection changed while loading';
  end if;
  return jsonb_build_object('items', v_items, 'next_cursor', v_next_cursor, 'snapshot_token', v_snapshot);
end
$$;

revoke all on function public.list_collection_page(public.orbitos_record_type, uuid, text, text, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_collection_page(public.orbitos_record_type, uuid, text, text, text, text, integer)
  to authenticated;
notify pgrst, 'reload schema';
