-- Phase 1: secure cloud schema, ownership boundaries, and browser grants.

create schema if not exists internal;
create schema if not exists private;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'orbitos_rpc'
  ) then
    create role orbitos_rpc
      nologin
      noinherit
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls;
  end if;
end
$$;

do $$
begin
  -- Hosted Supabase demotes postgres from SUPERUSER. Validate privileged
  -- attributes instead of trying to ALTER them, which would fail remotely.
  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'orbitos_rpc'
      and (
        rolsuper
        or rolcreatedb
        or rolcreaterole
        or rolreplication
        or rolbypassrls
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'orbitos_rpc has unsafe role attributes';
  end if;
end
$$;

alter role orbitos_rpc
  nologin
  noinherit;

grant orbitos_rpc to postgres;

revoke all on schema internal
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke all on schema private
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke create on schema public
  from public, anon, authenticated, service_role, orbitos_rpc;
grant usage on schema internal to authenticated, orbitos_rpc;
grant create on schema internal to orbitos_rpc;
grant usage on schema private to service_role;
grant usage on schema public to orbitos_rpc;

alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role orbitos_rpc
  revoke execute on functions from public;
alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, orbitos_rpc;

create function internal.request_user_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

-- The managed postgres role cannot re-grant privileges on Supabase-owned
-- auth.uid(). Keep the limited helper owner independent of the auth schema.
revoke all on function internal.request_user_id()
  from public, anon, authenticated, service_role, orbitos_rpc;
grant execute on function internal.request_user_id() to orbitos_rpc;

create function internal.lock_today_order(p_user_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'orbitos:today-order:' || p_user_id::text,
      0
    )
  )
$$;

revoke all on function internal.lock_today_order(uuid)
  from public, anon, authenticated, service_role, orbitos_rpc;
grant execute on function internal.lock_today_order(uuid) to orbitos_rpc;

create type public.record_source as enum ('manual', 'migration');
create type public.media_type as enum ('book', 'movie');
create type public.media_status as enum ('saved', 'in_progress', 'finished');
create type public.project_status as enum (
  'active',
  'someday',
  'completed',
  'archived'
);
create type public.google_calendar_connection_state as enum (
  'connected',
  'reconnect_required',
  'disconnected'
);
create type public.orbitos_record_type as enum (
  'todo',
  'idea',
  'media',
  'project'
);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint profiles_timezone_nonempty check (btrim(timezone) <> '')
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  title text not null,
  description text,
  status public.project_status not null default 'active',
  source public.record_source not null default 'manual',
  legacy_id text,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  search_vector tsvector generated always as (
    setweight(
      to_tsvector('simple'::regconfig, coalesce(title, '')),
      'A'
    ) ||
    setweight(
      to_tsvector('simple'::regconfig, coalesce(description, '')),
      'B'
    )
  ) stored,
  constraint projects_title_nonempty check (btrim(title) <> ''),
  constraint projects_legacy_source check (
    legacy_id is null or (
      source = 'migration' and btrim(legacy_id) <> ''
    )
  ),
  constraint projects_owner_id_unique unique (user_id, id)
);

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  text text not null,
  completed boolean not null default false,
  completed_at timestamptz,
  due_date date,
  due_time time without time zone,
  project_id uuid,
  today_rank bigint,
  source public.record_source not null default 'manual',
  legacy_id text,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  search_vector tsvector generated always as (
    setweight(
      to_tsvector('simple'::regconfig, coalesce(text, '')),
      'A'
    )
  ) stored,
  constraint todos_text_nonempty check (btrim(text) <> ''),
  constraint todos_due_time_requires_date check (
    due_time is null or due_date is not null
  ),
  constraint todos_completion_consistent check (
    (completed and completed_at is not null) or
    (not completed and completed_at is null)
  ),
  constraint todos_today_rank_positive check (
    today_rank is null or today_rank > 0
  ),
  constraint todos_legacy_source check (
    legacy_id is null or (
      source = 'migration' and btrim(legacy_id) <> ''
    )
  ),
  constraint todos_project_same_owner foreign key (user_id, project_id)
    references public.projects (user_id, id)
    on delete set null (project_id)
);

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  title text,
  body text not null,
  project_id uuid,
  source public.record_source not null default 'manual',
  legacy_id text,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  search_vector tsvector generated always as (
    setweight(
      to_tsvector('simple'::regconfig, coalesce(title, '')),
      'A'
    ) ||
    setweight(
      to_tsvector('simple'::regconfig, coalesce(body, '')),
      'B'
    )
  ) stored,
  constraint ideas_body_nonempty check (btrim(body) <> ''),
  constraint ideas_title_nonempty check (
    title is null or btrim(title) <> ''
  ),
  constraint ideas_legacy_source check (
    legacy_id is null or (
      source = 'migration' and btrim(legacy_id) <> ''
    )
  ),
  constraint ideas_project_same_owner foreign key (user_id, project_id)
    references public.projects (user_id, id)
    on delete set null (project_id)
);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  media_type public.media_type not null,
  title text not null,
  creator text,
  release_year integer,
  status public.media_status not null default 'saved',
  rating numeric,
  notes text,
  source public.record_source not null default 'manual',
  legacy_id text,
  deleted_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  search_vector tsvector generated always as (
    setweight(
      to_tsvector('simple'::regconfig, coalesce(title, '')),
      'A'
    ) ||
    setweight(
      to_tsvector('simple'::regconfig, coalesce(creator, '')),
      'B'
    ) ||
    setweight(
      to_tsvector('simple'::regconfig, coalesce(notes, '')),
      'C'
    )
  ) stored,
  constraint media_title_nonempty check (btrim(title) <> ''),
  constraint media_legacy_source check (
    legacy_id is null or (
      source = 'migration' and btrim(legacy_id) <> ''
    )
  )
);

create table public.google_calendar_connections (
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
  constraint google_connections_one_per_user unique (user_id),
  constraint google_connections_owner_id_unique unique (user_id, id),
  constraint google_connections_account_nonempty check (
    google_account_id is null or btrim(google_account_id) <> ''
  ),
  constraint google_connections_email_nonempty check (
    display_email is null or btrim(display_email) <> ''
  ),
  constraint google_connections_scope_elements_nonnull check (
    array_position(granted_scopes, null) is null
  )
);

create table public.google_calendar_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  calendar_id text not null,
  display_name text not null,
  background_color text,
  foreground_color text,
  is_visible boolean not null default true,
  last_seen_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint google_preferences_calendar_nonempty check (
    btrim(calendar_id) <> ''
  ),
  constraint google_preferences_name_nonempty check (
    btrim(display_name) <> ''
  ),
  constraint google_preferences_user_calendar_unique unique (
    user_id,
    calendar_id
  )
);

create table private.google_calendar_credentials (
  connection_id uuid primary key,
  user_id uuid not null,
  refresh_token_envelope text not null,
  encryption_key_version integer not null,
  token_rotated_at timestamptz,
  last_refreshed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint google_credentials_connection_owner foreign key (
    user_id,
    connection_id
  ) references public.google_calendar_connections (user_id, id)
    on delete cascade,
  constraint google_credentials_envelope_nonempty check (
    btrim(refresh_token_envelope) <> ''
  ),
  constraint google_credentials_key_version_positive check (
    encryption_key_version > 0
  )
);

create table private.google_oauth_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  state_hash text not null unique,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint google_oauth_state_sha256_hex check (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint google_oauth_redirect_nonempty check (
    btrim(redirect_uri) <> ''
  ),
  constraint google_oauth_expiry_after_creation check (
    expires_at > created_at
  ),
  constraint google_oauth_consumed_after_creation check (
    consumed_at is null or consumed_at >= created_at
  )
);

create unique index projects_user_legacy_id_uq
  on public.projects (user_id, legacy_id)
  where legacy_id is not null;
create unique index todos_user_legacy_id_uq
  on public.todos (user_id, legacy_id)
  where legacy_id is not null;
create unique index ideas_user_legacy_id_uq
  on public.ideas (user_id, legacy_id)
  where legacy_id is not null;
create unique index media_user_legacy_id_uq
  on public.media (user_id, legacy_id)
  where legacy_id is not null;

create index todos_user_due_active_idx
  on public.todos (user_id, due_date, today_rank, id)
  where deleted_at is null and completed_at is null;
create index todos_user_rank_active_idx
  on public.todos (user_id, today_rank, id)
  where deleted_at is null
    and completed_at is null
    and today_rank is not null;
create index todos_user_project_idx
  on public.todos (user_id, project_id)
  where project_id is not null;
create index ideas_user_project_idx
  on public.ideas (user_id, project_id)
  where project_id is not null;
create index ideas_user_updated_active_idx
  on public.ideas (user_id, updated_at desc, id)
  where deleted_at is null;
create index media_user_type_status_active_idx
  on public.media (user_id, media_type, status, updated_at desc, id)
  where deleted_at is null;
create index projects_user_status_active_idx
  on public.projects (user_id, status, updated_at desc, id)
  where deleted_at is null;

create index todos_search_idx
  on public.todos using gin (search_vector)
  where deleted_at is null;
create index ideas_search_idx
  on public.ideas using gin (search_vector)
  where deleted_at is null;
create index media_search_idx
  on public.media using gin (search_vector)
  where deleted_at is null;
create index projects_search_idx
  on public.projects using gin (search_vector)
  where deleted_at is null;

create index google_preferences_visible_idx
  on public.google_calendar_preferences (user_id, calendar_id)
  where is_visible;
create index google_oauth_unconsumed_expiry_idx
  on private.google_oauth_transactions (expires_at)
  where consumed_at is null;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end
$$;

create function private.validate_profile_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = new.timezone
  ) then
    raise exception using
      errcode = '23514',
      message = 'invalid profile timezone',
      constraint = 'profiles_timezone_valid';
  end if;

  return new;
end
$$;

create function private.sync_todo_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_local_today date;
begin
  if tg_op = 'INSERT' then
    if new.completed then
      new.completed_at = coalesce(new.completed_at, statement_timestamp());
    else
      new.completed_at = null;
    end if;

    if new.completed or new.deleted_at is not null then
      new.today_rank = null;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.completed then
      if old.completed = false or new.completed_at is null then
        new.completed_at = coalesce(new.completed_at, statement_timestamp());
      end if;
    else
      new.completed_at = null;
    end if;

    if new.completed is distinct from old.completed
      or new.deleted_at is distinct from old.deleted_at then
      new.today_rank = null;
    elsif new.due_date is distinct from old.due_date then
      select (
        statement_timestamp() at time zone profile.timezone
      )::date
      into v_local_today
      from public.profiles as profile
      where profile.user_id = new.user_id;

      v_local_today := coalesce(
        v_local_today,
        (statement_timestamp() at time zone 'America/New_York')::date
      );

      if new.due_date is null
        or new.due_date > v_local_today
        or old.due_date is null
        or old.due_date > v_local_today then
        new.today_rank = null;
      end if;
    end if;
  end if;

  return new;
end
$$;

create function private.validate_active_project_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is not distinct from old.user_id
      and new.project_id is not distinct from old.project_id then
      return new;
    end if;
  end if;

  if new.project_id is not null
    and not exists (
      select 1
      from public.projects as project
      where project.user_id = new.user_id
        and project.id = new.project_id
        and project.deleted_at is null
    ) then
    raise exception using
      errcode = '23503',
      message = 'project relationship requires an active same-owner project',
      constraint = tg_table_name || '_project_active_owner';
  end if;

  return new;
end
$$;

create function private.clear_ineligible_ranks_after_timezone_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_local_date date := (
    statement_timestamp() at time zone new.timezone
  )::date;
begin
  -- Reordering and timezone changes both mutate the meaning of today_rank.
  -- Serialize them per user so a reorder cannot validate the old timezone,
  -- wait for this cleanup, and then recreate a rank that is now ineligible.
  perform internal.lock_today_order(new.user_id);

  update public.todos
  set today_rank = null
  where user_id = new.user_id
    and today_rank is not null
    and (
      completed_at is not null
      or deleted_at is not null
      or due_date is null
      or due_date > v_new_local_date
    );

  return new;
end
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end
$$;

create trigger profiles_validate_timezone
before insert or update of timezone on public.profiles
for each row execute function private.validate_profile_timezone();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger profiles_clear_ineligible_today_ranks
after update of timezone on public.profiles
for each row
when (old.timezone is distinct from new.timezone)
execute function private.clear_ineligible_ranks_after_timezone_change();

create trigger projects_set_updated_at
before update on public.projects
for each row execute function private.set_updated_at();

create trigger todos_sync_state
before insert or update of completed, completed_at, due_date, deleted_at
on public.todos
for each row execute function private.sync_todo_state();

create trigger todos_validate_active_project
before insert or update of user_id, project_id on public.todos
for each row execute function private.validate_active_project_reference();

create trigger todos_set_updated_at
before update on public.todos
for each row execute function private.set_updated_at();

create trigger ideas_set_updated_at
before update on public.ideas
for each row execute function private.set_updated_at();

create trigger ideas_validate_active_project
before insert or update of user_id, project_id on public.ideas
for each row execute function private.validate_active_project_reference();

create trigger media_set_updated_at
before update on public.media
for each row execute function private.set_updated_at();

create trigger google_connections_set_updated_at
before update on public.google_calendar_connections
for each row execute function private.set_updated_at();

create trigger google_preferences_set_updated_at
before update on public.google_calendar_preferences
for each row execute function private.set_updated_at();

create trigger google_credentials_set_updated_at
before update on private.google_calendar_credentials
for each row execute function private.set_updated_at();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

insert into public.profiles (user_id)
select id
from auth.users
on conflict (user_id) do nothing;

revoke execute on function private.set_updated_at()
  from public, anon, authenticated, orbitos_rpc;
revoke execute on function private.validate_profile_timezone()
  from public, anon, authenticated, orbitos_rpc;
revoke execute on function private.sync_todo_state()
  from public, anon, authenticated, orbitos_rpc;
revoke execute on function private.validate_active_project_reference()
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke execute on function private.clear_ineligible_ranks_after_timezone_change()
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke execute on function private.handle_new_user()
  from public, anon, authenticated, orbitos_rpc;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.todos enable row level security;
alter table public.ideas enable row level security;
alter table public.media enable row level security;
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_preferences enable row level security;
alter table private.google_calendar_credentials enable row level security;
alter table private.google_oauth_transactions enable row level security;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy profiles_rpc_select_own
on public.profiles
for select
to orbitos_rpc
using ((select internal.request_user_id()) = user_id);

create policy projects_select_own_active
on public.projects
for select
to authenticated
using ((select auth.uid()) = user_id and deleted_at is null);

create policy projects_insert_own_active
on public.projects
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and deleted_at is null
  and source = 'manual'
  and legacy_id is null
);

create policy projects_update_own_active
on public.projects
for update
to authenticated
using ((select auth.uid()) = user_id and deleted_at is null)
with check ((select auth.uid()) = user_id and deleted_at is null);

create policy todos_select_own_active
on public.todos
for select
to authenticated
using ((select auth.uid()) = user_id and deleted_at is null);

create policy todos_insert_own_active
on public.todos
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and deleted_at is null
  and source = 'manual'
  and legacy_id is null
);

create policy todos_update_own_active
on public.todos
for update
to authenticated
using ((select auth.uid()) = user_id and deleted_at is null)
with check ((select auth.uid()) = user_id and deleted_at is null);

create policy ideas_select_own_active
on public.ideas
for select
to authenticated
using ((select auth.uid()) = user_id and deleted_at is null);

create policy ideas_insert_own_active
on public.ideas
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and deleted_at is null
  and source = 'manual'
  and legacy_id is null
);

create policy ideas_update_own_active
on public.ideas
for update
to authenticated
using ((select auth.uid()) = user_id and deleted_at is null)
with check ((select auth.uid()) = user_id and deleted_at is null);

create policy media_select_own_active
on public.media
for select
to authenticated
using ((select auth.uid()) = user_id and deleted_at is null);

create policy media_insert_own_active
on public.media
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and deleted_at is null
  and source = 'manual'
  and legacy_id is null
);

create policy media_update_own_active
on public.media
for update
to authenticated
using ((select auth.uid()) = user_id and deleted_at is null)
with check ((select auth.uid()) = user_id and deleted_at is null);

create policy google_connections_select_own
on public.google_calendar_connections
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy google_preferences_select_own
on public.google_calendar_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy google_preferences_update_own
on public.google_calendar_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy projects_rpc_select_own
on public.projects
for select
to orbitos_rpc
using ((select internal.request_user_id()) = user_id);

create policy projects_rpc_update_own
on public.projects
for update
to orbitos_rpc
using ((select internal.request_user_id()) = user_id)
with check ((select internal.request_user_id()) = user_id);

create policy todos_rpc_select_own
on public.todos
for select
to orbitos_rpc
using ((select internal.request_user_id()) = user_id);

create policy todos_rpc_update_own
on public.todos
for update
to orbitos_rpc
using ((select internal.request_user_id()) = user_id)
with check ((select internal.request_user_id()) = user_id);

create policy ideas_rpc_select_own
on public.ideas
for select
to orbitos_rpc
using ((select internal.request_user_id()) = user_id);

create policy ideas_rpc_update_own
on public.ideas
for update
to orbitos_rpc
using ((select internal.request_user_id()) = user_id)
with check ((select internal.request_user_id()) = user_id);

create policy media_rpc_select_own
on public.media
for select
to orbitos_rpc
using ((select internal.request_user_id()) = user_id);

create policy media_rpc_update_own
on public.media
for update
to orbitos_rpc
using ((select internal.request_user_id()) = user_id)
with check ((select internal.request_user_id()) = user_id);

revoke all on table public.profiles
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke all on table public.projects
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke all on table public.todos
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke all on table public.ideas
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke all on table public.media
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke all on table public.google_calendar_connections
  from public, anon, authenticated, service_role, orbitos_rpc;
revoke all on table public.google_calendar_preferences
  from public, anon, authenticated, service_role, orbitos_rpc;

grant select on table public.profiles to authenticated;
grant update (timezone) on table public.profiles to authenticated;

grant select on table public.projects to authenticated;
grant insert (title, description, status) on table public.projects
  to authenticated;
grant update (title, description, status) on table public.projects
  to authenticated;

grant select on table public.todos to authenticated;
grant insert (text, due_date, due_time, project_id) on table public.todos
  to authenticated;
grant update (text, completed, due_date, due_time, project_id)
  on table public.todos to authenticated;

grant select on table public.ideas to authenticated;
grant insert (title, body, project_id) on table public.ideas
  to authenticated;
grant update (title, body, project_id) on table public.ideas
  to authenticated;

grant select on table public.media to authenticated;
grant insert (
  media_type,
  title,
  creator,
  release_year,
  status,
  rating,
  notes
) on table public.media to authenticated;
grant update (
  media_type,
  title,
  creator,
  release_year,
  status,
  rating,
  notes
) on table public.media to authenticated;

grant select on table public.google_calendar_connections to authenticated;
grant select on table public.google_calendar_preferences to authenticated;
grant update (is_visible) on table public.google_calendar_preferences
  to authenticated;

grant select, insert, update, delete
  on table public.google_calendar_connections to service_role;
grant select, insert, update, delete
  on table public.google_calendar_preferences to service_role;

grant select on table public.projects to orbitos_rpc;
grant select (user_id, timezone) on table public.profiles to orbitos_rpc;
grant update (deleted_at) on table public.projects to orbitos_rpc;
grant select on table public.todos to orbitos_rpc;
grant update (deleted_at, today_rank) on table public.todos to orbitos_rpc;
grant select on table public.ideas to orbitos_rpc;
grant update (deleted_at) on table public.ideas to orbitos_rpc;
grant select on table public.media to orbitos_rpc;
grant update (deleted_at) on table public.media to orbitos_rpc;

revoke all on table private.google_calendar_credentials
  from public, anon, authenticated, orbitos_rpc;
revoke all on table private.google_oauth_transactions
  from public, anon, authenticated, orbitos_rpc;
grant select, insert, update, delete
  on table private.google_calendar_credentials to service_role;
grant select, insert, update, delete
  on table private.google_oauth_transactions to service_role;
