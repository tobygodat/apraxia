-- Dedicated, non-bypass owner: browser RPC privileges are not expanded.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='orbitos_agent') then
   create role orbitos_agent nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
 end if;
 if exists(select 1 from pg_roles where rolname='orbitos_agent' and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)) then
   raise exception using errcode='42501',message='orbitos_agent has unsafe role attributes';
 end if;
end $$;
alter role orbitos_agent nologin noinherit;
grant orbitos_agent to postgres;
grant usage on schema public, internal, private to orbitos_agent;
grant create on schema internal to orbitos_agent;
grant usage on schema internal to service_role;

alter table public.class_notes add column updated_at timestamptz not null default statement_timestamp();
create trigger class_notes_updated before update on public.class_notes
for each row execute function private.set_updated_at();

create table private.agent_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id text not null,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,request_id)
);
create table private.agent_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor text not null default 'muse',
  bucket text not null,
  operation text not null,
  record_id text,
  request_id text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index agent_changes_owner_time on private.agent_changes(user_id,created_at,id);
alter table private.agent_requests enable row level security;
alter table private.agent_changes enable row level security;
revoke all on private.agent_requests, private.agent_changes from public,anon,authenticated,service_role,orbitos_rpc;
grant select,insert,update on private.agent_requests to orbitos_agent;
grant select,insert on private.agent_changes to orbitos_agent;
create policy agent_requests_owner on private.agent_requests to orbitos_agent
using(user_id=nullif(current_setting('orbitos.agent_owner',true),'')::uuid)
with check(user_id=nullif(current_setting('orbitos.agent_owner',true),'')::uuid);
create policy agent_changes_owner on private.agent_changes to orbitos_agent
using(user_id=nullif(current_setting('orbitos.agent_owner',true),'')::uuid)
with check(user_id=nullif(current_setting('orbitos.agent_owner',true),'')::uuid);

grant select on public.todos,public.projects,public.ideas,public.classes,public.class_notes,public.profiles to orbitos_agent;
grant insert(user_id,text,completed,due_date,due_time,project_id,class_id,assignment_type),
 update(text,completed,due_date,due_time,project_id,class_id,assignment_type) on public.todos to orbitos_agent;
grant insert(user_id,title,description,status),update(title,description,status) on public.projects to orbitos_agent;
grant insert(user_id,title,body,project_id),update(title,body,project_id) on public.ideas to orbitos_agent;
grant insert(user_id,id,name),update(name) on public.classes to orbitos_agent;
grant insert(user_id,course_id,name,source,drive_file_id),update(name,course_id) on public.class_notes to orbitos_agent;
do $$ declare t text; begin
  foreach t in array array['todos','projects','ideas','classes','class_notes','profiles'] loop
    execute format('create policy agent_read on public.%I for select to orbitos_agent using(user_id=nullif(current_setting(''orbitos.agent_owner'',true),'''')::uuid)',t);
    if t <> 'profiles' then
      execute format('create policy agent_insert on public.%I for insert to orbitos_agent with check(user_id=nullif(current_setting(''orbitos.agent_owner'',true),'''')::uuid)',t);
      execute format('create policy agent_update on public.%I for update to orbitos_agent using(user_id=nullif(current_setting(''orbitos.agent_owner'',true),'''')::uuid) with check(user_id=nullif(current_setting(''orbitos.agent_owner'',true),'''')::uuid)',t);
    end if;
  end loop;
end $$;
grant execute on function internal.lock_today_order(uuid) to orbitos_agent;

create function internal.agent_workspace(
 p_user_id uuid,p_operation text,p_bucket text,p_id text default null,
 p_data jsonb default '{}',p_query jsonb default '{}',p_request_id text default null,p_expected_version text default null
) returns jsonb language plpgsql security definer set search_path='' set row_security=on as $$
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
   tab := case p_bucket when 'todos' then 'todos' when 'projects' then 'projects' when 'ideas' then 'ideas' when 'classes' then 'classes' when 'notes' then 'class_notes' end;
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
   if tab='class_notes' then query_allowed:=query_allowed||array['class_id']; end if;
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
       and ($2->>'class_id' is null or coalesce(to_jsonb(t)->>'class_id',to_jsonb(t)->>'course_id')=$2->>'class_id')
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
     allowed:=case tab when 'todos' then array['text','completed','due_date','due_time','project_id','class_id','assignment_type'] when 'projects' then array['title','description','status'] when 'ideas' then array['title','body','project_id'] when 'classes' then array['name'] when 'class_notes' then array['name','course_id'] end;
     if p_operation='create' and tab='classes' then allowed:=allowed||array['id']; end if;
     if p_operation='create' and tab='class_notes' then allowed:=allowed||array['source','drive_file_id']; end if;
     if p_data='{}' or exists(select 1 from jsonb_object_keys(p_data) k where not(k=any(allowed))) then raise exception using errcode='22023',message='Unsupported or empty fields'; end if;
     for key in select jsonb_object_keys(p_data) loop
       if p_data->key <> 'null'::jsonb and jsonb_typeof(p_data->key) <> (case when key='completed' then 'boolean' else 'string' end) then raise exception using errcode='22023',message='Invalid field type'; end if;
     end loop;
     if tab='class_notes' and p_operation='create' and p_data->>'source' is distinct from 'drive' then raise exception using errcode='22023',message='Only Drive note attachments can be created'; end if;
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
end $$;
alter function internal.agent_workspace(uuid,text,text,text,jsonb,jsonb,text,text) owner to orbitos_agent;
create function public.agent_workspace(p_user_id uuid,p_operation text,p_bucket text,p_id text default null,p_data jsonb default '{}',p_query jsonb default '{}',p_request_id text default null,p_expected_version text default null)
returns jsonb language sql security invoker set search_path='' as $$ select internal.agent_workspace(p_user_id,p_operation,p_bucket,p_id,p_data,p_query,p_request_id,p_expected_version) $$;
revoke all on function internal.agent_workspace(uuid,text,text,text,jsonb,jsonb,text,text),public.agent_workspace(uuid,text,text,text,jsonb,jsonb,text,text) from public,anon,authenticated,orbitos_rpc;
grant execute on function internal.agent_workspace(uuid,text,text,text,jsonb,jsonb,text,text),public.agent_workspace(uuid,text,text,text,jsonb,jsonb,text,text) to service_role;

create function internal.agent_provider_write(p_user_id uuid,p_operation text,p_request_id text,p_payload jsonb default '{}',p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path='' set row_security=on as $$
declare old_owner text:=current_setting('orbitos.agent_owner',true); saved private.agent_requests%rowtype; payload jsonb; answer jsonb;
begin
 if p_user_id is null or p_operation not in ('begin','finish') or p_operation is null or p_request_id is null or char_length(p_request_id) not between 1 and 200 or jsonb_typeof(p_payload) is distinct from 'object' then raise exception using errcode='22023',message='Invalid provider request'; end if;
 perform set_config('orbitos.agent_owner',p_user_id::text,true);
 payload:=jsonb_build_object('provider','calendar','payload',p_payload);
 perform pg_advisory_xact_lock(hashtextextended('agent-request:'||p_user_id::text||':'||p_request_id,0));
 select * into saved from private.agent_requests where user_id=p_user_id and request_id=p_request_id for update;
 if found then
   if saved.payload<>payload then raise exception using errcode='40001',message='Idempotency key reused with different request'; end if;
   if saved.result is not null then answer:=jsonb_build_object('state','completed','result',saved.result);
   elsif p_operation='begin' then answer:=jsonb_build_object('state','pending');
   else
     if p_result is null then raise exception using errcode='22023',message='Provider result required'; end if;
     update private.agent_requests set result=p_result where user_id=p_user_id and request_id=p_request_id;
     insert into private.agent_changes(user_id,bucket,operation,request_id,before_data,after_data) values(p_user_id,'calendar','provider_write',p_request_id,p_payload,p_result);
     answer:=jsonb_build_object('state','completed','result',p_result);
   end if;
 elsif p_operation='begin' then
   insert into private.agent_requests(user_id,request_id,payload) values(p_user_id,p_request_id,payload);
   answer:=jsonb_build_object('state','new');
 else raise exception using errcode='P0002',message='Provider request not found'; end if;
 perform set_config('orbitos.agent_owner',coalesce(old_owner,''),true);
 return answer;
end $$;
alter function internal.agent_provider_write(uuid,text,text,jsonb,jsonb) owner to orbitos_agent;
create function public.agent_provider_write(p_user_id uuid,p_operation text,p_request_id text,p_payload jsonb default '{}',p_result jsonb default null)
returns jsonb language sql security invoker set search_path='' as $$select internal.agent_provider_write(p_user_id,p_operation,p_request_id,p_payload,p_result)$$;
revoke all on function internal.agent_provider_write(uuid,text,text,jsonb,jsonb),public.agent_provider_write(uuid,text,text,jsonb,jsonb) from public,anon,authenticated,orbitos_rpc;
grant execute on function internal.agent_provider_write(uuid,text,text,jsonb,jsonb),public.agent_provider_write(uuid,text,text,jsonb,jsonb) to service_role;
revoke create on schema internal from orbitos_agent;
revoke orbitos_agent from postgres;

