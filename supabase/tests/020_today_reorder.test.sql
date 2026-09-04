begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;

select plan(24);

do $$
begin
  perform set_config(
    'orbitos.test_local_date',
    ((transaction_timestamp() at time zone 'America/New_York')::date)::text,
    true
  );
  perform set_config(
    'orbitos.test_forward_date',
    (
      (transaction_timestamp() at time zone 'Pacific/Kiritimati')::date
    )::text,
    true
  );
  perform set_config(
    'orbitos.test_backward_date',
    (
      (transaction_timestamp() at time zone 'Etc/GMT+12')::date
    )::text,
    true
  );
end
$$;

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'c@example.test');

insert into public.todos (id, user_id, text, due_date)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'A overdue',
    current_setting('orbitos.test_local_date')::date - 1
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'A due today',
    current_setting('orbitos.test_local_date')::date
  ),
  (
    'a1000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'A future',
    current_setting('orbitos.test_local_date')::date + 1
  ),
  (
    'a1000000-0000-4000-8000-000000000004',
    '11111111-1111-4111-8111-111111111111',
    'A inbox',
    null
  ),
  (
    'b1000000-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    'B overdue',
    current_setting('orbitos.test_local_date')::date - 1
  );

insert into public.todos (id, user_id, text, due_date, completed)
values (
  'a1000000-0000-4000-8000-000000000005',
  '11111111-1111-4111-8111-111111111111',
  'A completed',
  current_setting('orbitos.test_local_date')::date - 1,
  true
);

insert into public.todos (id, user_id, text, due_date, deleted_at)
values (
  'a1000000-0000-4000-8000-000000000006',
  '11111111-1111-4111-8111-111111111111',
  'A deleted',
  current_setting('orbitos.test_local_date')::date - 1,
  transaction_timestamp()
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select results_eq(
  $$
    select id, is_overdue, is_manually_ordered
    from internal.get_today_todos(
      current_setting('orbitos.test_local_date')::date
    )
  $$,
  $$
    values
      ('a1000000-0000-4000-8000-000000000001'::uuid, true, false),
      ('a1000000-0000-4000-8000-000000000002'::uuid, false, false)
  $$,
  'Today defaults to eligible A todos in overdue-first order'
);

select throws_ok(
  $$
    select *
    from internal.get_today_todos(
      current_setting('orbitos.test_local_date')::date + 1
    )
  $$,
  '22023',
  'local date changed; refresh and try again',
  'Today retrieval rejects a caller-supplied future local date'
);

select throws_ok(
  $$
    select *
    from public.reorder_today_todos(
      current_setting('orbitos.test_local_date')::date + 1,
      array[
        'a1000000-0000-4000-8000-000000000001'::uuid,
        'a1000000-0000-4000-8000-000000000002'::uuid,
        'a1000000-0000-4000-8000-000000000003'::uuid
      ]
    )
  $$,
  '22023',
  'invalid Today reorder request',
  'the public reorder wrapper rejects a future local date'
);

select throws_ok(
  $$
    select *
    from internal.reorder_today_todos(
      current_setting('orbitos.test_local_date')::date + 1,
      array[
        'a1000000-0000-4000-8000-000000000001'::uuid,
        'a1000000-0000-4000-8000-000000000002'::uuid,
        'a1000000-0000-4000-8000-000000000003'::uuid
      ]
    )
  $$,
  '22023',
  'invalid Today reorder request',
  'direct helper execution cannot bypass local-date validation'
);

select results_eq(
  $$
    select todo_id, today_rank
    from internal.reorder_today_todos(
      current_setting('orbitos.test_local_date')::date,
      array[
        'a1000000-0000-4000-8000-000000000002'::uuid,
        'a1000000-0000-4000-8000-000000000001'::uuid
      ]
    )
  $$,
  $$
    values
      ('a1000000-0000-4000-8000-000000000002'::uuid, 1024::bigint),
      ('a1000000-0000-4000-8000-000000000001'::uuid, 2048::bigint)
  $$,
  'reorder persists the requested order using stable rank steps'
);

select results_eq(
  $$
    select id, today_rank
    from internal.get_today_todos(
      current_setting('orbitos.test_local_date')::date
    )
  $$,
  $$
    values
      ('a1000000-0000-4000-8000-000000000002'::uuid, 1024::bigint),
      ('a1000000-0000-4000-8000-000000000001'::uuid, 2048::bigint)
  $$,
  'manual Today order survives a fresh retrieval'
);

select throws_ok(
  $$
    select *
    from public.reorder_today_todos(
      current_setting('orbitos.test_local_date')::date,
      array[
        'a1000000-0000-4000-8000-000000000001'::uuid,
        'a1000000-0000-4000-8000-000000000001'::uuid
      ]
    )
  $$,
  '22023',
  'Today list changed; reload and try again',
  'duplicate ids are rejected without an existence oracle'
);

select throws_ok(
  $$
    select *
    from public.reorder_today_todos(
      current_setting('orbitos.test_local_date')::date,
      array[
        'a1000000-0000-4000-8000-000000000001'::uuid,
        null::uuid
      ]
    )
  $$,
  '22023',
  'Today list changed; reload and try again',
  'null ids are rejected with the generic changed-list error'
);

select throws_ok(
  $$
    select *
    from public.reorder_today_todos(
      current_setting('orbitos.test_local_date')::date,
      array['a1000000-0000-4000-8000-000000000001'::uuid]
    )
  $$,
  '22023',
  'Today list changed; reload and try again',
  'an omitted eligible id is rejected atomically'
);

select throws_ok(
  $$
    select *
    from public.reorder_today_todos(
      current_setting('orbitos.test_local_date')::date,
      array[
        'a1000000-0000-4000-8000-000000000001'::uuid,
        'a1000000-0000-4000-8000-000000000003'::uuid
      ]
    )
  $$,
  '22023',
  'Today list changed; reload and try again',
  'an ineligible future id is rejected without revealing why'
);

select throws_ok(
  $$
    select *
    from public.reorder_today_todos(
      current_setting('orbitos.test_local_date')::date,
      array[
        'a1000000-0000-4000-8000-000000000001'::uuid,
        'b1000000-0000-4000-8000-000000000001'::uuid
      ]
    )
  $$,
  '22023',
  'Today list changed; reload and try again',
  'a foreign id is rejected without revealing its existence'
);

select throws_ok(
  $$
    select *
    from public.reorder_today_todos(
      current_setting('orbitos.test_local_date')::date,
      array[
        'a1000000-0000-4000-8000-000000000001'::uuid,
        '99999999-9999-4999-8999-999999999999'::uuid
      ]
    )
  $$,
  '22023',
  'Today list changed; reload and try again',
  'a missing id has the same response as a foreign id'
);

select results_eq(
  $$
    select id, today_rank
    from public.todos
    where id in (
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000002'
    )
    order by today_rank
  $$,
  $$
    values
      ('a1000000-0000-4000-8000-000000000002'::uuid, 1024::bigint),
      ('a1000000-0000-4000-8000-000000000001'::uuid, 2048::bigint)
  $$,
  'every rejected reorder leaves all saved ranks unchanged'
);

select lives_ok(
  $$
    update public.todos
    set due_date = current_setting('orbitos.test_local_date')::date - 3
    where id = 'a1000000-0000-4000-8000-000000000003'
  $$,
  'a future todo can become newly eligible'
);

select results_eq(
  $$
    select id, today_rank, is_overdue, is_manually_ordered
    from internal.get_today_todos(
      current_setting('orbitos.test_local_date')::date
    )
  $$,
  $$
    values
      (
        'a1000000-0000-4000-8000-000000000002'::uuid,
        1024::bigint,
        false,
        true
      ),
      (
        'a1000000-0000-4000-8000-000000000001'::uuid,
        2048::bigint,
        true,
        true
      ),
      (
        'a1000000-0000-4000-8000-000000000003'::uuid,
        null::bigint,
        true,
        false
      )
  $$,
  'newly eligible todos enter deterministically after the saved manual order'
);

set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

select lives_ok(
  $$
    update public.profiles
    set timezone = 'Pacific/Kiritimati'
  $$,
  'a user can configure a timezone whose local date leads the server date'
);

select lives_ok(
  $$
    insert into public.todos (text, due_date)
    values (
      'C timezone boundary',
      current_setting('orbitos.test_forward_date')::date
    )
  $$,
  'the timezone-boundary fixture is created through browser grants'
);

select results_eq(
  $$
    select todo_id, today_rank
    from internal.reorder_today_todos(
      current_setting('orbitos.test_forward_date')::date,
      array[
        (
          select id
          from public.todos
          where text = 'C timezone boundary'
        )
      ]
    )
  $$,
  $$
    select id, 1024::bigint
    from public.todos
    where text = 'C timezone boundary'
  $$,
  'Today accepts the explicit date derived from the configured timezone'
);

select throws_ok(
  $$
    select *
    from internal.get_today_todos(
      current_setting('orbitos.test_backward_date')::date
    )
  $$,
  '22023',
  'local date changed; refresh and try again',
  'Today rejects a date guaranteed stale for the configured timezone'
);

select lives_ok(
  $$
    update public.profiles
    set timezone = 'Etc/GMT+12'
  $$,
  'the profile can move across the opposite side of the date boundary'
);

select is(
  (
    select today_rank
    from public.todos
    where text = 'C timezone boundary'
  ),
  null::bigint,
  'moving the local date backward clears a now-ineligible saved rank'
);

select is(
  (
    select count(*)
    from internal.get_today_todos(
      current_setting('orbitos.test_backward_date')::date
    )
  ),
  0::bigint,
  'the todo is absent while its due date is future in the new timezone'
);

select lives_ok(
  $$
    update public.profiles
    set timezone = 'Pacific/Kiritimati'
  $$,
  'the profile can move forward across the date boundary again'
);

select results_eq(
  $$
    select text, today_rank
    from internal.get_today_todos(
      current_setting('orbitos.test_forward_date')::date
    )
  $$,
  $$values ('C timezone boundary'::text, null::bigint)$$,
  'a re-entering todo is appended without restoring its stale manual rank'
);

reset role;
select * from finish();
rollback;
