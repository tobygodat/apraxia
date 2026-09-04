begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;

select plan(19);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.test');

insert into public.projects (id, user_id, title)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'A project'
  ),
  (
    'b0000000-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    'B project'
  );

insert into public.todos (id, user_id, text, project_id)
values
  (
    'a0000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'A todo',
    null
  ),
  (
    'b0000000-0000-4000-8000-000000000002',
    '22222222-2222-4222-8222-222222222222',
    'B todo',
    'b0000000-0000-4000-8000-000000000001'
  );

insert into public.ideas (id, user_id, title, body, project_id)
values
  (
    'a0000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'A idea',
    'A private idea body',
    null
  ),
  (
    'b0000000-0000-4000-8000-000000000003',
    '22222222-2222-4222-8222-222222222222',
    'B idea',
    'B private idea body',
    'b0000000-0000-4000-8000-000000000001'
  );

insert into public.media (id, user_id, media_type, title)
values
  (
    'a0000000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    'book',
    'A book'
  ),
  (
    'b0000000-0000-4000-8000-000000000004',
    '22222222-2222-4222-8222-222222222222',
    'movie',
    'B movie'
  );

insert into public.google_calendar_connections (id, user_id)
values
  (
    'a0000000-0000-4000-8000-000000000005',
    '11111111-1111-4111-8111-111111111111'
  ),
  (
    'b0000000-0000-4000-8000-000000000005',
    '22222222-2222-4222-8222-222222222222'
  );

insert into public.google_calendar_preferences (
  id,
  user_id,
  calendar_id,
  display_name
)
values
  (
    'a0000000-0000-4000-8000-000000000006',
    '11111111-1111-4111-8111-111111111111',
    'calendar-a',
    'A calendar'
  ),
  (
    'b0000000-0000-4000-8000-000000000006',
    '22222222-2222-4222-8222-222222222222',
    'calendar-b',
    'B calendar'
  );

select bag_eq(
  $$
    select user_id, timezone
    from public.profiles
    where user_id in (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    )
  $$,
  $$
    values
      (
        '11111111-1111-4111-8111-111111111111'::uuid,
        'America/New_York'::text
      ),
      (
        '22222222-2222-4222-8222-222222222222'::uuid,
        'America/New_York'::text
      )
  $$,
  'new Auth users receive profiles with the default timezone'
);

select ok(
  not exists (
    select 1
    from (
      values ('projects'), ('todos'), ('ideas'), ('media')
    ) as content_table (table_name)
    cross join (
      values ('INSERT'), ('UPDATE')
    ) as ownership_write (privilege_name)
    where has_column_privilege(
      'authenticated',
      format('public.%I', content_table.table_name),
      'user_id',
      ownership_write.privilege_name
    )
  ),
  'browser grants never expose user_id for insert or update'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select throws_ok(
  $$update public.profiles set timezone = 'Not/A_Real_Timezone'$$,
  '23514',
  'invalid profile timezone',
  'profiles reject timezone names that PostgreSQL does not recognize'
);

select bag_eq(
  $$
    select 'profiles'::text as relation_name, user_id from public.profiles
    union all
    select 'projects', user_id from public.projects
    union all
    select 'todos', user_id from public.todos
    union all
    select 'ideas', user_id from public.ideas
    union all
    select 'media', user_id from public.media
    union all
    select 'connections', user_id from public.google_calendar_connections
    union all
    select 'preferences', user_id from public.google_calendar_preferences
  $$,
  $$
    values
      ('profiles'::text, '11111111-1111-4111-8111-111111111111'::uuid),
      ('projects', '11111111-1111-4111-8111-111111111111'::uuid),
      ('todos', '11111111-1111-4111-8111-111111111111'::uuid),
      ('ideas', '11111111-1111-4111-8111-111111111111'::uuid),
      ('media', '11111111-1111-4111-8111-111111111111'::uuid),
      ('connections', '11111111-1111-4111-8111-111111111111'::uuid),
      ('preferences', '11111111-1111-4111-8111-111111111111'::uuid)
  $$,
  'A sees only A rows in every public user-owned table'
);

select lives_ok(
  $$insert into public.todos (text) values ('A browser-owned todo')$$,
  'A can insert an owned todo without supplying user_id'
);

select results_eq(
  $$select user_id from public.todos where text = 'A browser-owned todo'$$,
  array['11111111-1111-4111-8111-111111111111'::uuid],
  'the browser insert derives ownership from auth.uid()'
);

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

select bag_eq(
  $$
    select 'profiles'::text as relation_name, user_id from public.profiles
    union all
    select 'projects', user_id from public.projects
    union all
    select 'todos', user_id from public.todos
    union all
    select 'ideas', user_id from public.ideas
    union all
    select 'media', user_id from public.media
    union all
    select 'connections', user_id from public.google_calendar_connections
    union all
    select 'preferences', user_id from public.google_calendar_preferences
  $$,
  $$
    values
      ('profiles'::text, '22222222-2222-4222-8222-222222222222'::uuid),
      ('projects', '22222222-2222-4222-8222-222222222222'::uuid),
      ('todos', '22222222-2222-4222-8222-222222222222'::uuid),
      ('ideas', '22222222-2222-4222-8222-222222222222'::uuid),
      ('media', '22222222-2222-4222-8222-222222222222'::uuid),
      ('connections', '22222222-2222-4222-8222-222222222222'::uuid),
      ('preferences', '22222222-2222-4222-8222-222222222222'::uuid)
  $$,
  'B sees only B rows in every public user-owned table'
);

-- browser-owned-unlinked-todo:start
insert into public.todos (text)
values ('B unlinked todo');
-- browser-owned-unlinked-todo:end

select isnt(
  public.soft_delete_record(
    'project',
    'b0000000-0000-4000-8000-000000000001'
  ),
  null::timestamptz,
  'B can soft-delete an owned project before relationship validation'
);

select results_eq(
  $$
    update public.todos
    set
      text = 'B todo edited after project deletion',
      completed = false,
      due_date = null,
      due_time = null,
      project_id = 'b0000000-0000-4000-8000-000000000001'
    where id = 'b0000000-0000-4000-8000-000000000002'
    returning text
  $$,
  array['B todo edited after project deletion'::text],
  'a full todo update may preserve its unchanged soft-deleted project reference'
);

select results_eq(
  $$
    update public.ideas
    set
      title = 'B idea edited after project deletion',
      body = 'B private idea body edited',
      project_id = 'b0000000-0000-4000-8000-000000000001'
    where id = 'b0000000-0000-4000-8000-000000000003'
    returning body
  $$,
  array['B private idea body edited'::text],
  'a full idea update may preserve its unchanged soft-deleted project reference'
);

select throws_ok(
  $$
    update public.todos
    set project_id = 'b0000000-0000-4000-8000-000000000001'
    where text = 'B unlinked todo'
  $$,
  '23503',
  'project relationship requires an active same-owner project',
  'an existing todo cannot newly target a soft-deleted same-owner project'
);

select throws_ok(
  $$
    insert into public.todos (text, project_id)
    values (
      'relation to deleted project',
      'b0000000-0000-4000-8000-000000000001'
    )
  $$,
  '23503',
  'project relationship requires an active same-owner project',
  'a todo cannot newly target a soft-deleted same-owner project'
);

select throws_ok(
  $$
    insert into public.ideas (body, project_id)
    values (
      'relation to deleted project',
      'b0000000-0000-4000-8000-000000000001'
    )
  $$,
  '23503',
  'project relationship requires an active same-owner project',
  'an idea cannot newly target a soft-deleted same-owner project'
);

select throws_ok(
  $$
    insert into public.todos (user_id, text)
    values (
      '11111111-1111-4111-8111-111111111111',
      'spoofed ownership'
    )
  $$,
  '42501',
  null,
  'B cannot supply A as the owner of a new todo'
);

select is(
  (
    with changed as (
      update public.todos
      set text = 'tampered by B'
      where id = 'a0000000-0000-4000-8000-000000000002'
      returning id
    )
    select count(*) from changed
  ),
  0::bigint,
  'B update of an A row affects zero rows'
);

select throws_ok(
  $$
    insert into public.todos (text, project_id)
    values ('cross-owner todo', 'a0000000-0000-4000-8000-000000000001')
  $$,
  '23503',
  null,
  'B cannot relate a todo to A project'
);

select throws_ok(
  $$
    insert into public.ideas (body, project_id)
    values ('cross-owner idea', 'a0000000-0000-4000-8000-000000000001')
  $$,
  '23503',
  null,
  'B cannot relate an idea to A project'
);

select throws_ok(
  $$
    delete from public.todos
    where id = 'b0000000-0000-4000-8000-000000000002'
  $$,
  '42501',
  null,
  'browser roles cannot hard-delete even their own rows'
);

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select is(
  (
    select text
    from public.todos
    where id = 'a0000000-0000-4000-8000-000000000002'
  ),
  'A todo'::text,
  'A row remains intact after B attempted an update'
);

reset role;
select * from finish();
rollback;
