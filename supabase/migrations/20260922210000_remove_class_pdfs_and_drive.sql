-- Retire class PDFs and the Google Drive connection that only existed to pick
-- them. A class keeps its written notes (public.classes.notes) and its
-- assignments; what goes is the saved-PDF list, device uploads, the Drive
-- Picker, and the agent API's notes bucket. Calendar's Google connection is a
-- separate store and is untouched.
--
-- The note rows are copied into a private table first, as
-- 20260915072221_remove_media.sql did for media: it has no API grants or
-- policies and nothing reads it, but the filenames, Drive file ids, and upload
-- object paths survive the drop.
--
-- The uploaded bytes are not deleted here. Supabase refuses SQL deletes from
-- storage.objects and storage.buckets (the protect_*_delete triggers), and a
-- catalog delete would not free the bytes anyway. Dropping the class-pdfs
-- policies leaves the private bucket unreachable from the browser; empty and
-- remove it through the Storage API or dashboard once the files are kept
-- elsewhere. The retired rows' object_path names each file.
--
-- Drive credentials are dropped, not backed up: they are encrypted refresh and
-- access tokens with no use once the server no longer calls Drive.
--
-- One statement keeps the backup, lock, and schema changes atomic even when
-- the Supabase CLI applies migration statements separately.
do $migration$
begin
lock table public.class_notes in access exclusive mode;
create table private.retired_class_notes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  row_data jsonb not null
);
alter table private.retired_class_notes enable row level security;
revoke all on table private.retired_class_notes
  from public, anon, authenticated, service_role, orbitos_rpc, orbitos_agent;
insert into private.retired_class_notes (id, user_id, row_data)
select id, user_id, to_jsonb(n) - 'search_vector' from public.class_notes as n;

if (select count(*) from public.class_notes)
  <> (select count(*) from private.retired_class_notes) then
  raise exception 'Class note backup count mismatch';
end if;

-- The object policies read public.class_notes, so they go before it.
drop policy class_pdf_read on storage.objects;
drop policy class_pdf_upload on storage.objects;
drop policy class_pdf_delete on storage.objects;
drop function public.finish_class_pdf(uuid);
drop function private.reap_abandoned_class_pdfs();
-- Takes its row policies (browser and agent), triggers, indexes, and generated
-- search vector with it.
drop table public.class_notes;

-- Search: the same function without the class_note branch, and the kind itself
-- removed so nothing can ask for it. search_records is the enum's only user.
drop function public.search_records(text, integer, integer);
drop type public.search_record_type;
create type public.search_record_type as enum (
  'todo',
  'assignment',
  'idea',
  'project',
  'class',
  'application'
);

create function public.search_records(
  p_query text,
  p_limit integer default 40,
  p_offset integer default 0
)
returns table (
  record_type public.search_record_type,
  record_id text,
  parent_id text,
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
as $fn$
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

  -- A query of nothing but English stopwords ('IT') stems away to an empty
  -- query. The literal configuration keeps it, and identifiers are indexed
  -- under that configuration too, so a course code still finds its class.
  v_query := websearch_to_tsquery('english'::regconfig, v_query_text);
  if numnode(v_query) = 0 or querytree(v_query)::text in ('', 'T') then
    v_query := websearch_to_tsquery('simple'::regconfig, v_query_text);
  end if;

  -- A query that is empty, or only negations, would otherwise match everything.
  if numnode(v_query) = 0 or querytree(v_query)::text in ('', 'T') then
    return;
  end if;

  return query
  with matches as (
    -- A task has no name of its own: its text is all it is.
    select
      case when t.class_id is null then 'todo' else 'assignment' end
        ::public.search_record_type as record_type,
      t.id::text as record_id,
      t.class_id as parent_id,
      null::text as heading,
      t.text as body,
      t.updated_at,
      ts_rank_cd(t.search_vector, v_query)::real as relevance
    from public.todos as t
    where t.user_id = (select auth.uid())
      and t.deleted_at is null
      and t.search_vector @@ v_query

    union all

    select
      'idea'::public.search_record_type,
      i.id::text,
      null::text,
      i.title,
      i.body,
      i.updated_at,
      ts_rank_cd(i.search_vector, v_query)::real
    from public.ideas as i
    where i.user_id = (select auth.uid())
      and i.deleted_at is null
      and i.search_vector @@ v_query

    union all

    select
      'project'::public.search_record_type,
      p.id::text,
      null::text,
      p.title,
      p.description,
      p.updated_at,
      ts_rank_cd(p.search_vector, v_query)::real
    from public.projects as p
    where p.user_id = (select auth.uid())
      and p.deleted_at is null
      and p.search_vector @@ v_query

    union all

    -- A class recovered without a name is titled by the course code, and then
    -- that code is not repeated underneath it.
    select
      'class'::public.search_record_type,
      c.id,
      null::text,
      coalesce(c.name, c.id),
      case when c.name is null then null else c.id end,
      c.updated_at,
      ts_rank_cd(c.search_vector, v_query)::real
    from public.classes as c
    where c.user_id = (select auth.uid())
      and c.search_vector @@ v_query

    union all

    -- The company is how an application is looked for, so it is the heading and
    -- the role is the line under it.
    select
      'application'::public.search_record_type,
      a.id::text,
      null::text,
      a.company,
      a.role,
      a.updated_at,
      ts_rank_cd(a.search_vector, v_query)::real
    from public.career_applications as a
    where a.user_id = (select auth.uid())
      and a.deleted_at is null
      and a.search_vector @@ v_query
  ),
  named as (
    select
      m.*,
      -- What the title is cut from: the record's own name, or its text.
      coalesce(m.heading, m.body, '') as source
    from matches as m
  ),
  titled as (
    select
      n.*,
      case
        when char_length(n.source) <= 160 then n.source
        -- 161 characters cut back to the last word boundary, so a title that
        -- has to be cut still ends on a whole word.
        else left(regexp_replace(left(n.source, 161), '\s\S*$', ''), 160)
      end as title
    from named as n
  ),
  described as (
    select
      t.*,
      case
        -- The title is the opening of the text itself, so the snippet carries
        -- what is left of that text instead of repeating it.
        when t.heading is null
          then btrim(substr(coalesce(t.body, ''), char_length(t.title) + 1, 200))
        else left(coalesce(t.body, ''), 200)
      end as snippet
    from titled as t
  ),
  counted as (
    select
      described.*,
      count(*) over () as total_count
    from described
  )
  select
    counted.record_type,
    counted.record_id,
    counted.parent_id,
    counted.title,
    -- A record whose two fields hold the same words (an idea titled with its
    -- own body, a project described by its title) would print that text twice.
    case when counted.snippet = counted.title then '' else counted.snippet end,
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
$fn$;

revoke all on function public.search_records(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_records(text, integer, integer)
  to authenticated;

-- Agent API: the same function without the notes bucket, which now answers
-- 'Unknown bucket' like any other. The replacement keeps orbitos_agent as
-- owner and keeps its grants; the temporary privileges below are the ones the
-- migrations README requires for a helper that role owns.
grant orbitos_agent to postgres;
grant create on schema internal to orbitos_agent;

create or replace function internal.agent_workspace(
 p_user_id uuid,p_operation text,p_bucket text,p_id text default null,
 p_data jsonb default '{}',p_query jsonb default '{}',p_request_id text default null,p_expected_version text default null
) returns jsonb language plpgsql security definer set search_path='' set row_security=on as $fn$
declare
 old_owner text := current_setting('orbitos.agent_owner',true);
 tab text; allowed text[]; query_allowed text[]; cols text; vals text;
 row_before jsonb; row_after jsonb; answer jsonb; saved private.agent_requests%rowtype;
 payload jsonb; lim integer; off integer; items jsonb; key text;
begin
 if p_user_id is null or p_operation is null or p_bucket is null
    or jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_query) is distinct from 'object' then
   raise exception using errcode='22023',message='Invalid agent request';
 end if;
 perform set_config('orbitos.agent_owner',p_user_id::text,true);
 if p_operation='changes' then
   if exists(select 1 from jsonb_object_keys(p_query) k where k not in ('limit','offset','updated_since')) then
     raise exception using errcode='22023',message='Unsupported changes filter';
   end if;
 else
   tab := case p_bucket when 'todos' then 'todos' when 'projects' then 'projects' when 'ideas' then 'ideas' when 'classes' then 'classes' end;
   if tab is null then raise exception using errcode='22023',message='Unknown bucket'; end if;
 end if;
 lim := coalesce((p_query->>'limit')::integer,50); off := coalesce((p_query->>'offset')::integer,0);
 if lim not between 1 and 100 or off not between 0 and 100000 then raise exception using errcode='22023',message='Invalid pagination'; end if;
 if p_operation='changes' then
   select coalesce(jsonb_agg(x.j order by x.created_at,x.id),'[]') into items from (
     select to_jsonb(c)-'user_id' as j,c.created_at,c.id from private.agent_changes c
     where c.user_id=p_user_id and (p_query->>'updated_since' is null or c.created_at>(p_query->>'updated_since')::timestamptz)
     order by c.created_at,c.id limit lim+1 offset off
   ) x;
   answer := jsonb_build_object('items',case when jsonb_array_length(items)>lim then items-lim else items end,'next_offset',case when jsonb_array_length(items)>lim then off+lim end);
 elsif p_operation in ('list','search') then
   query_allowed := array['limit','offset','q','updated_since'];
   if tab='todos' then query_allowed:=query_allowed||array['completed','due_from','due_to','class_id','project_id']; end if;
   if tab='ideas' then query_allowed:=query_allowed||array['project_id']; end if;
   if exists(select 1 from jsonb_object_keys(p_query) k where not(k=any(query_allowed))) then raise exception using errcode='22023',message='Unsupported filter'; end if;
   if p_operation='search' and nullif(btrim(p_query->>'q'),'') is null then raise exception using errcode='22023',message='Search requires q'; end if;
   execute format($sql$
     select coalesce(jsonb_agg(j order by j->>'id'),'[]') from (
       select (to_jsonb(t)-'search_vector'-'user_id') || jsonb_build_object('version',md5(to_jsonb(t)::text)) as j
       from public.%I t where user_id=$1 and to_jsonb(t)->>'deleted_at' is null
       and ($2->>'updated_since' is null or (to_jsonb(t)->>'updated_at')::timestamptz>($2->>'updated_since')::timestamptz)
       and ($2->>'q' is null or position(lower($2->>'q') in lower(concat_ws(' ',to_jsonb(t)->>'text',to_jsonb(t)->>'title',to_jsonb(t)->>'description',to_jsonb(t)->>'body',to_jsonb(t)->>'name'))) > 0)
       and ($2->>'completed' is null or (to_jsonb(t)->>'completed')::boolean=($2->>'completed')::boolean)
       and ($2->>'due_from' is null or (to_jsonb(t)->>'due_date')::date>=($2->>'due_from')::date)
       and ($2->>'due_to' is null or (to_jsonb(t)->>'due_date')::date<=($2->>'due_to')::date)
       and ($2->>'class_id' is null or to_jsonb(t)->>'class_id'=$2->>'class_id')
       and ($2->>'project_id' is null or to_jsonb(t)->>'project_id'=$2->>'project_id')
       order by t.id limit $3 offset $4
     ) page
   $sql$,tab) into items using p_user_id,p_query,lim+1,off;
   answer:=jsonb_build_object('items',case when jsonb_array_length(items)>lim then items-lim else items end,'next_offset',case when jsonb_array_length(items)>lim then off+lim end);
 elsif p_operation in ('get','create','update','replay') then
   if p_operation in ('create','update','replay') then
     if p_request_id is null or char_length(p_request_id) not between 1 and 200 then raise exception using errcode='22023',message='request_id required'; end if;
     payload:=jsonb_build_object('operation',case when p_operation='replay' then 'create' else p_operation end,'bucket',p_bucket,'id',p_id,'data',p_data,'expected_version',p_expected_version);
     perform pg_advisory_xact_lock(hashtextextended('agent-request:'||p_user_id::text||':'||p_request_id,0));
     select * into saved from private.agent_requests where user_id=p_user_id and request_id=p_request_id;
     if found then
       if saved.payload<>payload then raise exception using errcode='40001',message='Idempotency key reused with different request'; end if;
       perform set_config('orbitos.agent_owner',coalesce(old_owner,''),true);
       return case when p_operation='replay' then jsonb_build_object('found',true,'result',saved.result) else saved.result end;
     end if;
     if p_operation='replay' then
       perform set_config('orbitos.agent_owner',coalesce(old_owner,''),true);
       return jsonb_build_object('found',false);
     end if;
     if tab='todos' then perform internal.lock_today_order(p_user_id); end if;
   end if;
   if p_operation<>'create' then
     execute format('select to_jsonb(t) from public.%I t where user_id=$1 and id::text=$2 and to_jsonb(t)->>''deleted_at'' is null for update',tab) into row_before using p_user_id,p_id;
     if row_before is null then raise exception using errcode='P0002',message='Record not found'; end if;
   end if;
   if p_operation='get' then row_after:=row_before;
   else
     allowed:=case tab when 'todos' then array['text','completed','due_date','due_time','project_id','class_id','assignment_type'] when 'projects' then array['title','description','status'] when 'ideas' then array['title','body','project_id'] when 'classes' then array['name'] end;
     if p_operation='create' and tab='classes' then allowed:=allowed||array['id']; end if;
     if p_data='{}' or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception using errcode='22023',message='Unsupported or empty fields'; end if;
     for key in select jsonb_object_keys(p_data) loop
       if p_data->key <> 'null'::jsonb and jsonb_typeof(p_data->key) <> (case when key='completed' then 'boolean' else 'string' end) then raise exception using errcode='22023',message='Invalid field type'; end if;
     end loop;
     if tab='classes' and (p_operation='create' or p_data ? 'name') and p_data->>'name' is null then raise exception using errcode='22023',message='Class name required'; end if;
     if p_data->>'due_date' is not null and p_data->>'due_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='due_date must be YYYY-MM-DD'; end if;
     if p_data->>'due_time' is not null and p_data->>'due_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?$' then raise exception using errcode='22023',message='due_time must be local HH:MM or HH:MM:SS'; end if;
     if p_operation='update' and (p_expected_version is null or p_expected_version<>md5(row_before::text)) then raise exception using errcode='40001',message='Version conflict'; end if;
     select string_agg(format('%I',k),',' order by k),string_agg(format('r.%I',k),',' order by k) into cols,vals from jsonb_object_keys(p_data) k;
     if p_operation='create' then
       execute format('insert into public.%I as t (user_id,%s) select $1,%s from jsonb_populate_record(null::public.%I,$2) r returning to_jsonb(t)',tab,cols,vals,tab) into row_after using p_user_id,p_data;
     else
       execute format('update public.%I t set (%s)=(select %s from jsonb_populate_record(null::public.%I,$3) r) where user_id=$1 and id::text=$2 returning to_jsonb(t)',tab,cols,vals,tab) into row_after using p_user_id,p_id,p_data;
     end if;
   end if;
   answer:=jsonb_build_object('item',(row_after-'search_vector'-'user_id')||jsonb_build_object('version',md5(row_after::text)));
   if p_operation<>'get' then
     insert into private.agent_requests(user_id,request_id,payload,result) values(p_user_id,p_request_id,payload,answer);
     insert into private.agent_changes(user_id,bucket,operation,record_id,request_id,before_data,after_data)
     values(p_user_id,p_bucket,p_operation,row_after->>'id',p_request_id,row_before-'search_vector'-'user_id',row_after-'search_vector'-'user_id');
   end if;
 else raise exception using errcode='22023',message='Unknown operation'; end if;
 perform set_config('orbitos.agent_owner',coalesce(old_owner,''),true);
 return answer;
end $fn$;
revoke create on schema internal from orbitos_agent;
revoke orbitos_agent from postgres;

-- Drive: every RPC overload, then the private stores, then the connection row
-- they reference. google_calendar_connection_state stays; Calendar uses it.
drop function public.begin_drive_oauth_attempt(uuid, text, text, timestamptz, text);
drop function public.consume_drive_oauth_attempt(uuid, text, text);
drop function public.begin_drive_oauth_transaction(uuid, text, text, timestamptz);
drop function public.consume_drive_oauth_transaction(uuid, text, text);
drop function private.valid_drive_oauth_transaction_input(uuid, text, text);
drop function public.read_drive_credentials(uuid);
drop function public.save_drive_credentials(uuid, uuid, timestamptz, text, integer, text[]);
drop function public.save_drive_credentials(
  uuid, uuid, timestamptz, text, integer, text[], text, timestamptz
);
drop function public.clear_drive_credentials(
  uuid, public.google_calendar_connection_state, timestamptz
);
drop function public.clear_drive_credentials(
  uuid, public.google_calendar_connection_state, timestamptz, boolean
);
drop table private.google_drive_oauth_transactions;
drop table private.google_drive_credentials;
drop table public.google_drive_connections;
end
$migration$;
