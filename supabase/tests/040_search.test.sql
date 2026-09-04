begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;

select plan(18);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.test');

insert into public.todos (id, user_id, text, updated_at)
values
  (
    'a4000000-0000-4000-8000-000000000001',
    '11111111-1111-4111-8111-111111111111',
    'Needle todo',
    '2026-01-01 01:00:00+00'
  ),
  (
    'b4000000-0000-4000-8000-000000000001',
    '22222222-2222-4222-8222-222222222222',
    'Needle foreign todo',
    '2026-01-01 05:00:00+00'
  );

insert into public.ideas (id, user_id, title, body, deleted_at, updated_at)
values
  (
    'a4000000-0000-4000-8000-000000000002',
    '11111111-1111-4111-8111-111111111111',
    'Needle idea',
    'Useful thought',
    null,
    '2026-01-01 02:00:00+00'
  ),
  (
    'a4000000-0000-4000-8000-000000000003',
    '11111111-1111-4111-8111-111111111111',
    'Needle deleted idea',
    'Should stay hidden',
    transaction_timestamp(),
    '2026-01-01 06:00:00+00'
  );

insert into public.media (id, user_id, media_type, title, notes, updated_at)
values (
  'a4000000-0000-4000-8000-000000000004',
  '11111111-1111-4111-8111-111111111111',
  'book',
  'Needle media',
  'Review later',
  '2026-01-01 03:00:00+00'
);

insert into public.projects (id, user_id, title, description, updated_at)
values (
  'a4000000-0000-4000-8000-000000000005',
  '11111111-1111-4111-8111-111111111111',
  'Needle project',
  'Active collection',
  '2026-01-01 04:00:00+00'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select set_eq(
  $$
    select record_type::text, title
    from public.search_records('needle')
  $$,
  $$
    values
      ('todo'::text, 'Needle todo'::text),
      ('idea', 'Needle idea'),
      ('media', 'Needle media'),
      ('project', 'Needle project')
  $$,
  'search returns every active record type owned by the caller'
);

select is(
  (select count(*) from public.search_records('needle')),
  4::bigint,
  'search excludes both soft-deleted and foreign records'
);

select ok(
  (
    select bool_and(total_count = 4)
    from public.search_records('needle')
  ),
  'every result reports the full filtered result count'
);

select is(
  (select count(*) from public.search_records('-needle')),
  0::bigint,
  'negative-only searches return no unbounded result set'
);

select is(
  (select count(*) from public.search_records('   ')),
  0::bigint,
  'blank searches return no rows'
);

select set_eq(
  $$
    select record_type::text
    from public.search_records('needle -project')
  $$,
  $$values ('todo'::text), ('idea'), ('media')$$,
  'web-style exclusion terms are applied safely'
);

select is(
  (select count(*) from public.search_records('needle', 2, 0)),
  2::bigint,
  'the requested result limit is enforced'
);

select ok(
  (
    select bool_and(total_count = 4)
    from public.search_records('needle', 2, 0)
  ),
  'limited pages retain the complete result count'
);

select results_eq(
  $$select record_id from public.search_records('needle', 2, 0)$$,
  array[
    'a4000000-0000-4000-8000-000000000005'::uuid,
    'a4000000-0000-4000-8000-000000000004'::uuid
  ],
  'the first page returns the exact newest stable record IDs'
);

select results_eq(
  $$select record_id from public.search_records('needle', 2, 2)$$,
  array[
    'a4000000-0000-4000-8000-000000000002'::uuid,
    'a4000000-0000-4000-8000-000000000001'::uuid
  ],
  'the second page returns the exact remaining stable record IDs'
);

select is(
  (
    with first_page as (
      select record_id from public.search_records('needle', 2, 0)
    ),
    second_page as (
      select record_id from public.search_records('needle', 2, 2)
    )
    select count(*)
    from first_page
    join second_page using (record_id)
  ),
  0::bigint,
  'adjacent search pages never overlap'
);

select throws_ok(
  $$select * from public.search_records(repeat('x', 257))$$,
  '22023',
  'search query is too long',
  'search rejects queries beyond the documented bound'
);

select throws_ok(
  $$select * from public.search_records('needle', 0, 0)$$,
  '22023',
  'invalid search pagination',
  'search rejects a zero result limit'
);

select throws_ok(
  $$select * from public.search_records('needle', 101, 0)$$,
  '22023',
  'invalid search pagination',
  'search rejects a result limit above the bound'
);

select throws_ok(
  $$select * from public.search_records('needle', 40, -1)$$,
  '22023',
  'invalid search pagination',
  'search rejects negative offsets'
);

select throws_ok(
  $$select * from public.search_records('needle', 40, 10001)$$,
  '22023',
  'invalid search pagination',
  'search rejects offsets above the bound'
);

select lives_ok(
  $test$
    select count(*)
    from public.search_records(
      $query$needle'); drop table public.todos; --$query$
    )
  $test$,
  'SQL-like punctuation remains inert search text'
);

select ok(
  to_regclass('public.todos') is not null,
  'injection-like search text cannot alter application tables'
);

reset role;
select * from finish();
rollback;
