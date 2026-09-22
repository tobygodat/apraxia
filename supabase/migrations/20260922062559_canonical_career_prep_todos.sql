-- Career preparation actions are canonical todos. Career keeps the application
-- context and ordering; the todo owns the text, work date, completion state and
-- soft-delete revision. The mirrored career_prep columns keep the existing page
-- and service projection small, while triggers make every Tasks mutation visible
-- on the Career page after reload.
--
-- Existing linked rows take their canonical values from their todo. Existing
-- unlinked rows get a todo carrying their current values before todo_id becomes
-- required. No hosted row is discarded or rewritten from fixture data.
do $migration$
begin

-- Later internal helpers must repeat this temporary ownership setup. The role
-- remains NOLOGIN/NOBYPASSRLS and its functions keep row_security enabled.
grant orbitos_rpc to postgres;
grant create on schema internal to orbitos_rpc;

alter table public.career_prep
  add column deleted_at timestamptz;

-- A canonical todo has no text-size ceiling. Keep Career imports bounded at the
-- RPC boundary, but do not make a longer edit from Tasks fail in the mirror.
alter table public.career_prep
  drop constraint career_prep_body_bounded,
  add constraint career_prep_body_bounded check (btrim(body) <> '');

-- Inspect before enforcing the one-to-one relationship. A shared legacy link
-- is ambiguous: choosing either prep item would lose context, so fail the
-- transaction without changing hosted data and resolve it explicitly first.
if exists (
  select 1
  from public.career_prep
  where todo_id is not null
  group by user_id, todo_id
  having count(*) > 1
) then
  raise exception using
    errcode = '23505',
    message = 'A todo is linked to more than one career prep item.',
    constraint = 'career_prep_todo_unique';
end if;

alter table public.career_prep
  drop constraint career_prep_todo_same_owner;

-- A pre-existing link is already the user's declaration that the task is the
-- action. Preserve it and make its canonical fields authoritative.
update public.career_prep as prep
set body = todo.text,
    due_on = todo.due_date,
    done_at = todo.completed_at,
    deleted_at = todo.deleted_at
from public.todos as todo
where todo.user_id = prep.user_id
  and todo.id = prep.todo_id;

-- Give every isolated prep row a stable link, then materialize its current
-- state as a normal manual todo. The existing completion timestamp is kept.
update public.career_prep
set todo_id = gen_random_uuid()
where todo_id is null;

insert into public.todos (
  id,
  user_id,
  text,
  completed,
  completed_at,
  due_date,
  deleted_at,
  source
)
select
  prep.todo_id,
  prep.user_id,
  prep.body,
  prep.done_at is not null,
  prep.done_at,
  prep.due_on,
  prep.deleted_at,
  'manual'::public.record_source
from public.career_prep as prep
where not exists (
  select 1
  from public.todos as todo
  where todo.user_id = prep.user_id
    and todo.id = prep.todo_id
);

alter table public.career_prep
  alter column todo_id set not null,
  add constraint career_prep_todo_unique unique (todo_id),
  add constraint career_prep_todo_same_owner
    foreign key (user_id, todo_id)
    references public.todos (user_id, id)
    on delete cascade;

-- The browser reads the active projection, but all writes now go through the
-- atomic helpers below. This removes the old split-brain insert/update/delete
-- paths without changing how the page loads rows.
drop policy career_prep_read on public.career_prep;
drop policy career_prep_create on public.career_prep;
drop policy career_prep_write on public.career_prep;
drop policy career_prep_delete on public.career_prep;

-- The original migration granted these column by column. A table-level revoke
-- does not remove column grants, so name every inherited write column here.
revoke insert (
  id, user_id, application_id, body, due_on, done_at, todo_id, position
) on public.career_prep from authenticated;
revoke update (
  body, due_on, done_at, todo_id, position
) on public.career_prep from authenticated;
revoke delete on public.career_prep from authenticated;

create policy career_prep_read on public.career_prep
  for select to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null);

create policy career_prep_rpc_select_own on public.career_prep
  for select to orbitos_rpc
  using ((select internal.request_user_id()) = user_id);
create policy career_prep_rpc_insert_own on public.career_prep
  for insert to orbitos_rpc
  with check ((select internal.request_user_id()) = user_id);
create policy career_prep_rpc_update_own on public.career_prep
  for update to orbitos_rpc
  using ((select internal.request_user_id()) = user_id)
  with check ((select internal.request_user_id()) = user_id);

-- The helper role gets only the columns needed to create or edit the canonical
-- task. Existing RLS policies still restrict it to the JWT owner.
create policy todos_rpc_insert_own on public.todos
  for insert to orbitos_rpc
  with check ((select internal.request_user_id()) = user_id);

grant select on public.career_prep to orbitos_rpc;
grant insert (
  id, user_id, application_id, body, due_on, done_at, todo_id, position
) on public.career_prep to orbitos_rpc;
grant update (position) on public.career_prep to orbitos_rpc;

grant insert (id, user_id, text, completed, due_date)
  on public.todos to orbitos_rpc;
grant update (
  text, completed, due_date, due_time, recurrence_freq, recurrence_interval,
  recurrence_until
) on public.todos to orbitos_rpc;

-- Every canonical todo mutation (browser task edits, Today completion, soft
-- delete, restore, or a Career RPC) is reflected into its single prep row.
create function private.sync_career_prep_from_todo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.career_prep as prep
  set body = new.text,
      due_on = new.due_date,
      done_at = new.completed_at,
      deleted_at = new.deleted_at
  where prep.user_id = new.user_id
    and prep.todo_id = new.id;

  return null;
end
$$;

revoke all on function private.sync_career_prep_from_todo()
  from public, anon, authenticated, service_role, orbitos_rpc;

create trigger todos_sync_career_prep
after update of text, completed, completed_at, due_date, deleted_at
on public.todos
for each row execute function private.sync_career_prep_from_todo();

-- A repeating prep task keeps its application. Completing an occurrence
-- creates its successor (20260918060000_recurring_todos.sql); that successor
-- gets its own prep row, so Career lists each occurrence as Tasks does. When
-- undoing the completion withdraws the successor, its prep row follows through
-- the mirror trigger above. recurrence_spawned_id is set by a BEFORE trigger,
-- not by the statement, so an "update of" column list would never fire here.
create function private.link_career_prep_successor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.career_prep (
    id, user_id, application_id, body, due_on, done_at, todo_id, position
  )
  select
    successor.id,
    successor.user_id,
    prep.application_id,
    successor.text,
    successor.due_date,
    successor.completed_at,
    successor.id,
    (
      select coalesce(max(sibling.position), -1) + 1
      from public.career_prep as sibling
      where sibling.user_id = prep.user_id
        and sibling.application_id = prep.application_id
    )
  from public.career_prep as prep
  join public.todos as successor
    on successor.user_id = prep.user_id
   and successor.id = new.recurrence_spawned_id
  where prep.user_id = new.user_id
    and prep.todo_id = new.id
  on conflict do nothing;

  return null;
end
$$;

revoke all on function private.link_career_prep_successor()
  from public, anon, authenticated, service_role, orbitos_rpc;

create trigger todos_link_career_prep_successor
after update on public.todos
for each row
when (
  new.recurrence_spawned_id is not null
  and new.recurrence_spawned_id is distinct from old.recurrence_spawned_id
)
execute function private.link_career_prep_successor();

-- Deleting an application removes its actionable todos from Today. Restore
-- revives only rows carrying that exact application-delete token, so a task
-- independently deleted earlier stays deleted.
create function private.sync_career_application_todos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.todos as todo
    set deleted_at = new.deleted_at,
        today_rank = null
    from public.career_prep as prep
    where prep.user_id = new.user_id
      and prep.application_id = new.id
      and todo.user_id = prep.user_id
      and todo.id = prep.todo_id
      and todo.deleted_at is null;
  elsif old.deleted_at is not null and new.deleted_at is null then
    update public.todos as todo
    set deleted_at = null,
        today_rank = null
    from public.career_prep as prep
    where prep.user_id = new.user_id
      and prep.application_id = new.id
      and todo.user_id = prep.user_id
      and todo.id = prep.todo_id
      and todo.deleted_at = old.deleted_at;
  end if;

  return null;
end
$$;

revoke all on function private.sync_career_application_todos()
  from public, anon, authenticated, service_role, orbitos_rpc;

create trigger career_applications_sync_todos
after update of deleted_at on public.career_applications
for each row
when (old.deleted_at is distinct from new.deleted_at)
execute function private.sync_career_application_todos();

-- Bring any application already soft-deleted before this migration into the
-- same lifecycle without touching tasks independently deleted before it.
update public.todos as todo
set deleted_at = application.deleted_at,
    today_rank = null
from public.career_prep as prep
join public.career_applications as application
  on application.user_id = prep.user_id
 and application.id = prep.application_id
where todo.user_id = prep.user_id
  and todo.id = prep.todo_id
  and todo.deleted_at is null
  and application.deleted_at is not null;

-- A prep task deleted before its application stays with that application:
-- undoing the task alone while the application is deleted restores nothing,
-- so no live task hangs off a hidden application. Every other branch is
-- unchanged from 20260919000100_career_prep.sql.
create or replace function internal.restore_record(
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
      update public.todos as todo
      set deleted_at = null,
          today_rank = null
      where todo.id = p_record_id
        and todo.user_id = v_uid
        and todo.deleted_at = p_deleted_at
        and not exists (
          select 1
          from public.career_prep as prep
          join public.career_applications as application
            on application.user_id = prep.user_id
           and application.id = prep.application_id
          where prep.user_id = todo.user_id
            and prep.todo_id = todo.id
            and application.deleted_at is not null
        );
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
    when 'application' then
      update public.career_applications
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


-- Create up to 50 actions in one statement. IDs come from the reviewed client
-- draft. An already-owned ID in the same application is a committed replay:
-- return its current canonical state without applying the stale draft again.
-- A replayed item deleted since the first save is left deleted and omitted.
-- Imports into one application run one at a time, so a retry sent while the
-- first request is still running waits and replays instead of colliding.
create function internal.import_career_prep_items(
  p_application_id uuid,
  p_items jsonb
)
returns setof public.career_prep
language plpgsql
volatile
security definer
set search_path = ''
set row_security = on
as $$
declare
  v_uid uuid := internal.request_user_id();
  v_count integer;
  v_distinct_count integer;
  v_base_position integer;
  v_item record;
  v_id uuid;
  v_body text;
  v_due_on date;
  v_existing public.career_prep%rowtype;
  v_existing_todo uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_application_id is null
    or p_items is null
    or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid career prep import';
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 50 then
    raise exception using errcode = '22023', message = 'Import 1 to 50 prep items.';
  end if;

  select count(distinct (item.value ->> 'id')::uuid)::integer
  into v_distinct_count
  from jsonb_array_elements(p_items) as item(value);
  if v_distinct_count <> v_count then
    raise exception using errcode = '22023', message = 'Prep item IDs must be unique.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('career-prep-import:' || p_application_id::text, 0)
  );

  perform application.id
  from public.career_applications as application
  where application.user_id = v_uid
    and application.id = p_application_id
    and application.deleted_at is null
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Application unavailable.';
  end if;

  select coalesce(max(prep.position), -1) + 1
  into v_base_position
  from public.career_prep as prep
  where prep.user_id = v_uid
    and prep.application_id = p_application_id;

  for v_item in
    select item.value, item.ordinality::integer as ordinality
    from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
    order by item.ordinality
  loop
    if jsonb_typeof(v_item.value) <> 'object' then
      raise exception using errcode = '22023', message = 'Invalid prep item.';
    end if;

    v_id := (v_item.value ->> 'id')::uuid;
    v_body := btrim(v_item.value ->> 'body');
    v_due_on := nullif(v_item.value ->> 'due_on', '')::date;
    if v_id is null or v_body is null or v_body = '' or char_length(v_body) > 2000 then
      raise exception using errcode = '22023', message = 'Use a prep note of 1-2000 characters.';
    end if;

    select prep.*
    into v_existing
    from public.career_prep as prep
    where prep.user_id = v_uid
      and prep.id = v_id;

    if found then
      if v_existing.application_id <> p_application_id then
        raise exception using errcode = '23505', message = 'Prep item ID is already in use.';
      end if;
      -- A replay returns the current todo projection. Do not update it from the
      -- old request: Tasks may have edited, completed or deleted it after the
      -- first save, and the final query omits a deleted item.
      continue;
    end if;

    select todo.id
    into v_existing_todo
    from public.todos as todo
    where todo.user_id = v_uid
      and todo.id = v_id;
    if found then
      raise exception using errcode = '23505', message = 'Prep item ID is already in use.';
    end if;

    insert into public.todos (id, user_id, text, completed, due_date)
    values (v_id, v_uid, v_body, false, v_due_on);

    insert into public.career_prep (
      id, user_id, application_id, body, due_on, done_at, todo_id, position
    )
    select
      v_id,
      v_uid,
      p_application_id,
      todo.text,
      todo.due_date,
      todo.completed_at,
      todo.id,
      v_base_position + v_item.ordinality - 1
    from public.todos as todo
    where todo.user_id = v_uid
      and todo.id = v_id;
  end loop;

  return query
  select prep.*
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality)
  join public.career_prep as prep
    on prep.user_id = v_uid
   and prep.id = (item.value ->> 'id')::uuid
   and prep.application_id = p_application_id
   and prep.deleted_at is null
  order by item.ordinality;
end
$$;

alter function internal.import_career_prep_items(uuid, jsonb)
  owner to orbitos_rpc;

create function public.import_career_prep_items(
  p_application_id uuid,
  p_items jsonb
)
returns setof public.career_prep
language sql
volatile
security invoker
set search_path = ''
as $$
  select result.*
  from internal.import_career_prep_items(p_application_id, p_items) as result
$$;

-- Existing prep edits update the task inside the same statement. Missing JSON
-- keys preserve the corresponding canonical field, which is required for the
-- checkbox and date controls that each send only their own change.
create function internal.save_career_prep_item(
  p_application_id uuid,
  p_item jsonb
)
returns public.career_prep
language plpgsql
volatile
security definer
set search_path = ''
set row_security = on
as $$
declare
  v_uid uuid := internal.request_user_id();
  v_id uuid;
  v_body text;
  v_prep public.career_prep%rowtype;
  v_todo public.todos%rowtype;
  v_todo_id uuid;
  v_due_on date;
  v_completed boolean;
  v_position integer;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_application_id is null or p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid career prep update';
  end if;

  v_id := (p_item ->> 'id')::uuid;
  if v_id is null then
    raise exception using errcode = '22023', message = 'Prep item ID is required.';
  end if;

  -- Read the immutable link, then lock in canonical order: todo before prep.
  -- Ordinary Tasks updates take that order through the mirror trigger too.
  select prep.todo_id
  into v_todo_id
  from public.career_prep as prep
  where prep.user_id = v_uid
    and prep.id = v_id
    and prep.application_id = p_application_id
    and prep.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'Prep item unavailable.';
  end if;

  select todo.*
  into v_todo
  from public.todos as todo
  where todo.user_id = v_uid
    and todo.id = v_todo_id
    and todo.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Prep task unavailable.';
  end if;

  select prep.*
  into v_prep
  from public.career_prep as prep
  where prep.user_id = v_uid
    and prep.id = v_id
    and prep.application_id = p_application_id
    and prep.todo_id = v_todo.id
    and prep.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Prep item unavailable.';
  end if;

  if p_item ? 'body' then
    v_body := btrim(p_item ->> 'body');
    if v_body is null or v_body = '' then
      raise exception using errcode = '22023', message = 'Prep text is required.';
    end if;
  else
    v_body := v_todo.text;
  end if;
  if p_item ? 'due_on' then
    v_due_on := nullif(p_item ->> 'due_on', '')::date;
  else
    v_due_on := v_todo.due_date;
  end if;
  if p_item ? 'completed' then
    v_completed := (p_item ->> 'completed')::boolean;
  else
    v_completed := v_todo.completed;
  end if;
  if p_item ? 'position' then
    v_position := (p_item ->> 'position')::integer;
  else
    v_position := v_prep.position;
  end if;
  if v_position is null or v_position not between 0 and 1000000 then
    raise exception using errcode = '22023', message = 'Invalid prep position.';
  end if;

  if p_item ? 'body' or p_item ? 'due_on' or p_item ? 'completed' then
    update public.todos as todo
    set text = case when p_item ? 'body' then v_body else todo.text end,
        completed = case when p_item ? 'completed' then v_completed else todo.completed end,
        due_date = case when p_item ? 'due_on' then v_due_on else todo.due_date end,
        due_time = case
          when p_item ? 'due_on' and v_due_on is null then null
          else todo.due_time
        end,
        recurrence_freq = case
          when p_item ? 'due_on' and v_due_on is null then null
          else todo.recurrence_freq
        end,
        recurrence_interval = case
          when p_item ? 'due_on' and v_due_on is null then null
          else todo.recurrence_interval
        end,
        recurrence_until = case
          when p_item ? 'due_on' and v_due_on is null then null
          else todo.recurrence_until
        end
    where todo.user_id = v_uid
      and todo.id = v_todo.id
      and todo.deleted_at is null;
  end if;

  if p_item ? 'position' then
    update public.career_prep as prep
    set position = v_position
    where prep.user_id = v_uid
      and prep.id = v_id;
  end if;

  select prep.*
  into v_prep
  from public.career_prep as prep
  where prep.user_id = v_uid
    and prep.id = v_id
    and prep.deleted_at is null;
  return v_prep;
end
$$;

alter function internal.save_career_prep_item(uuid, jsonb)
  owner to orbitos_rpc;

create function public.save_career_prep_item(
  p_application_id uuid,
  p_item jsonb
)
returns public.career_prep
language sql
volatile
security invoker
set search_path = ''
as $$
  select internal.save_career_prep_item(p_application_id, p_item)
$$;

create function internal.remove_career_prep_item(p_item_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
set row_security = on
as $$
declare
  v_uid uuid := internal.request_user_id();
  v_todo_id uuid;
  v_locked_todo uuid;
  v_locked_prep uuid;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  -- Match the canonical todo -> prep lock order used by every edit.
  select prep.todo_id
  into v_todo_id
  from public.career_prep as prep
  where prep.user_id = v_uid
    and prep.id = p_item_id
    and prep.deleted_at is null;
  if not found then
    return false;
  end if;

  select todo.id
  into v_locked_todo
  from public.todos as todo
  where todo.user_id = v_uid
    and todo.id = v_todo_id
    and todo.deleted_at is null
  for update;
  if not found then
    return false;
  end if;

  select prep.id
  into v_locked_prep
  from public.career_prep as prep
  where prep.user_id = v_uid
    and prep.id = p_item_id
    and prep.todo_id = v_locked_todo
    and prep.deleted_at is null
  for update;
  if not found then
    return false;
  end if;

  update public.todos as todo
  set deleted_at = statement_timestamp(),
      today_rank = null
  where todo.user_id = v_uid
    and todo.id = v_locked_todo
    and todo.deleted_at is null;
  return found;
end
$$;

alter function internal.remove_career_prep_item(uuid)
  owner to orbitos_rpc;

create function public.remove_career_prep_item(p_item_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select internal.remove_career_prep_item(p_item_id)
$$;

revoke all on function internal.import_career_prep_items(uuid, jsonb)
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke all on function internal.save_career_prep_item(uuid, jsonb)
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke all on function internal.remove_career_prep_item(uuid)
  from public, anon, authenticated, service_role, orbitos_rpc;
grant execute on function internal.import_career_prep_items(uuid, jsonb) to authenticated;
grant execute on function internal.save_career_prep_item(uuid, jsonb) to authenticated;
grant execute on function internal.remove_career_prep_item(uuid) to authenticated;

revoke all on function public.import_career_prep_items(uuid, jsonb)
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke all on function public.save_career_prep_item(uuid, jsonb)
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke all on function public.remove_career_prep_item(uuid)
  from public, anon, authenticated, service_role, orbitos_rpc;
grant execute on function public.import_career_prep_items(uuid, jsonb) to authenticated;
grant execute on function public.save_career_prep_item(uuid, jsonb) to authenticated;
grant execute on function public.remove_career_prep_item(uuid) to authenticated;

revoke create on schema internal from orbitos_rpc;
revoke orbitos_rpc from postgres;

notify pgrst, 'reload schema';

end
$migration$;
