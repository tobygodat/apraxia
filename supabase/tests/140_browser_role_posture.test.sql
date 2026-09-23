begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;

select plan(11);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'posture-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'posture-b@example.test');

insert into public.google_calendar_connections (user_id, google_account_id, display_email, connection_state)
values
  ('11111111-1111-4111-8111-111111111111', 'google-a', 'calendar-a@example.test', 'connected'),
  ('22222222-2222-4222-8222-222222222222', 'google-b', 'calendar-b@example.test', 'connected');

insert into public.google_calendar_preferences (user_id, calendar_id, display_name)
values
  ('11111111-1111-4111-8111-111111111111', 'calendar-a', 'A calendar'),
  ('22222222-2222-4222-8222-222222222222', 'calendar-b', 'B calendar');

insert into public.projects (id, user_id, title)
values (
  'a0000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'A project'
);

select ok(
  (
    select count(*) = 10 and bool_and(class.relrowsecurity)
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where (namespace.nspname, class.relname) in (
      ('public', 'profiles'),
      ('public', 'projects'),
      ('public', 'todos'),
      ('public', 'ideas'),
      ('private', 'retired_media'),
      ('private', 'retired_class_notes'),
      ('public', 'google_calendar_connections'),
      ('public', 'google_calendar_preferences'),
      ('private', 'google_calendar_credentials'),
      ('private', 'google_oauth_transactions')
    )
  ),
  'row-level security is enabled on every personal table'
);

select ok(
  has_function_privilege(
    'authenticated',
    'internal.get_today_todos(date)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'internal.get_today_todos(date)'::regprocedure,
    'EXECUTE'
  ),
  'only authenticated can execute the internal Today reader'
);

select ok(
  not exists (
    select 1
    from (values ('anon'), ('authenticated')) as browser_role (role_name)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as privilege (name)
    where has_table_privilege(
      browser_role.role_name,
      'public.google_calendar_connections',
      privilege.name
    )
  )
  and has_table_privilege(
    'authenticated',
    'public.google_calendar_connections',
    'SELECT'
  ),
  'calendar connections are read-only for browser roles'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.google_calendar_preferences',
    'INSERT'
  )
  and not has_table_privilege(
    'authenticated',
    'public.google_calendar_preferences',
    'DELETE'
  )
  and has_column_privilege(
    'authenticated',
    'public.google_calendar_preferences',
    'is_visible',
    'UPDATE'
  )
  and not has_column_privilege(
    'authenticated',
    'public.google_calendar_preferences',
    'calendar_id',
    'UPDATE'
  ),
  'calendar preferences expose only the visibility toggle to the browser'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select throws_ok(
  $$
    insert into public.google_calendar_connections (user_id)
    values ('11111111-1111-4111-8111-111111111111')
  $$,
  '42501',
  null,
  'the browser cannot create its own calendar connection'
);

select throws_ok(
  $$
    update public.google_calendar_connections
    set connection_state = 'disconnected'
  $$,
  '42501',
  null,
  'the browser cannot change its calendar connection state'
);

select throws_ok(
  $$
    insert into public.google_calendar_preferences (user_id, calendar_id, display_name)
    values (
      '11111111-1111-4111-8111-111111111111',
      'browser-created',
      'Browser-created calendar'
    )
  $$,
  '42501',
  null,
  'the browser cannot invent calendar preferences'
);

select throws_ok(
  $$
    insert into public.profiles (user_id)
    values ('22222222-2222-4222-8222-222222222222')
  $$,
  '42501',
  null,
  'the browser cannot create a profile for another account'
);

select throws_ok(
  $$delete from public.projects where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'browser roles cannot hard-delete their own projects'
);

select results_eq(
  $$
    update public.google_calendar_preferences
    set is_visible = false
    where calendar_id = 'calendar-a'
    returning calendar_id
  $$,
  array['calendar-a'::text],
  'the owner can hide one of their own calendars'
);

with changed as (
  update public.google_calendar_preferences
  set is_visible = false
  where calendar_id = 'calendar-b'
  returning id
)
select is(
  (select count(*) from changed),
  0::bigint,
  'hiding another account calendar affects zero rows'
);

reset role;
select * from finish();
rollback;
