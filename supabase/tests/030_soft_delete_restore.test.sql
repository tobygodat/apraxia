begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;

select plan(13);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.test');

insert into public.projects (id, user_id, title)
values (
  'a0000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  'A project'
);

insert into public.todos (id, user_id, text, due_date, today_rank)
values
  (
    'a0000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'A todo',
    current_date,
    1024
  ),
  (
    'b0000000-0000-4000-8000-000000000002',
    '22222222-2222-4222-8222-222222222222',
    'B todo',
    current_date,
    1024
  );

insert into public.ideas (id, user_id, title, body)
values (
  'a0000000-0000-4000-8000-000000000003',
  '11111111-1111-4111-8111-111111111111',
  'A idea',
  'A idea body'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

create temporary table delete_tokens (
  record_type public.orbitos_record_type primary key,
  record_id uuid not null unique,
  token timestamptz
);
grant select on pg_temp.delete_tokens to postgres;

select lives_ok(
  $test$
    insert into pg_temp.delete_tokens (record_type, record_id, token)
    values
      (
        'project',
        'a0000000-0000-4000-8000-000000000001',
        public.soft_delete_record(
          'project',
          'a0000000-0000-4000-8000-000000000001'
        )
      ),
      (
        'todo',
        'a0000000-0000-4000-8000-000000000002',
        public.soft_delete_record(
          'todo',
          'a0000000-0000-4000-8000-000000000002'
        )
      ),
      (
        'idea',
        'a0000000-0000-4000-8000-000000000003',
        public.soft_delete_record(
          'idea',
          'a0000000-0000-4000-8000-000000000003'
        )
      )
  $test$,
  'all record types soft-delete through the public wrappers'
);

select ok(
  (
    select count(*) = 3 and bool_and(token is not null)
    from pg_temp.delete_tokens
  ),
  'every soft delete returns an exact undo token'
);

select is(
  (
    select count(*)
    from (
      select id
      from public.projects
      where id = 'a0000000-0000-4000-8000-000000000001'
      union all
      select id
      from public.todos
      where id = 'a0000000-0000-4000-8000-000000000002'
      union all
      select id
      from public.ideas
      where id = 'a0000000-0000-4000-8000-000000000003'
    ) as visible_record
  ),
  0::bigint,
  'ordinary selects hide every deleted record'
);

select is(
  public.soft_delete_record(
    'todo',
    'a0000000-0000-4000-8000-000000000002'
  ),
  null::timestamptz,
  'soft-deleting an already-deleted row is a no-op'
);

select is(
  public.soft_delete_record(
    'todo',
    'b0000000-0000-4000-8000-000000000002'
  ),
  null::timestamptz,
  'soft-deleting a foreign row is a non-oracular no-op'
);

select is(
  public.restore_record(
    'todo',
    'b0000000-0000-4000-8000-000000000002',
    transaction_timestamp()
  ),
  false,
  'restoring a foreign row returns false'
);

select set_eq(
  $$
    select
      record_type::text,
      public.restore_record(
        record_type,
        record_id,
        token - interval '1 microsecond'
      )
    from pg_temp.delete_tokens
  $$,
  $$
    values
      ('project'::text, false),
      ('todo', false),
      ('idea', false)
  $$,
  'stale undo tokens restore nothing'
);

reset role;

select ok(
  (
    select deleted_at is null
    from public.todos
    where id = 'b0000000-0000-4000-8000-000000000002'
  ),
  'foreign lifecycle calls leave the other user row intact'
);

select set_eq(
  $$
    select 'project'::text, id, deleted_at
    from public.projects
    where id = 'a0000000-0000-4000-8000-000000000001'
    union all
    select 'todo', id, deleted_at
    from public.todos
    where id = 'a0000000-0000-4000-8000-000000000002'
    union all
    select 'idea', id, deleted_at
    from public.ideas
    where id = 'a0000000-0000-4000-8000-000000000003'
  $$,
  $$
    select record_type::text, record_id, token
    from pg_temp.delete_tokens
  $$,
  'failed restores preserve the exact stored deletion tokens'
);

set local role authenticated;

select set_eq(
  $$
    select
      record_type::text,
      public.restore_record(record_type, record_id, token)
    from pg_temp.delete_tokens
  $$,
  $$
    values
      ('project'::text, true),
      ('todo', true),
      ('idea', true)
  $$,
  'only the exact deletion tokens restore every record type'
);

select is(
  (
    select count(*)
    from (
      select id
      from public.projects
      where id = 'a0000000-0000-4000-8000-000000000001'
      union all
      select id
      from public.todos
      where id = 'a0000000-0000-4000-8000-000000000002'
      union all
      select id
      from public.ideas
      where id = 'a0000000-0000-4000-8000-000000000003'
    ) as visible_record
  ),
  3::bigint,
  'restored records return to ordinary selects'
);

select set_eq(
  $$
    select
      record_type::text,
      public.restore_record(record_type, record_id, token)
    from pg_temp.delete_tokens
  $$,
  $$
    values
      ('project'::text, false),
      ('todo', false),
      ('idea', false)
  $$,
  'a consumed undo token cannot be replayed'
);

select is(
  (
    select today_rank
    from public.todos
    where id = 'a0000000-0000-4000-8000-000000000002'
  ),
  null::bigint,
  'a restored todo does not regain its stale Today rank'
);

reset role;
select * from finish();
rollback;
