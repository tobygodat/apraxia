begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;

select plan(16);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'careers-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'careers-b@example.test');

select ok(
  (
    select count(*) = 7 and bool_and(class.relrowsecurity)
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where (namespace.nspname, class.relname) in (
      ('public', 'career_applications'),
      ('public', 'career_steps'),
      ('public', 'career_questions'),
      ('public', 'career_prep'),
      ('public', 'career_resources'),
      ('public', 'career_stories'),
      ('public', 'career_story_uses')
    )
  ),
  'row-level security is enabled on every career table'
);

select ok(
  not exists (
    select 1
    from (
      values
        ('public.career_applications'),
        ('public.career_steps'),
        ('public.career_questions'),
        ('public.career_prep'),
        ('public.career_resources'),
        ('public.career_stories'),
        ('public.career_story_uses')
    ) as career_table (relation_name)
    cross join (
      values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
    ) as table_privilege (privilege_name)
    where has_table_privilege(
      'anon',
      career_table.relation_name,
      table_privilege.privilege_name
    )
  ),
  'anonymous callers have no privileges on career tables'
);

select ok(
  not has_column_privilege(
    'authenticated', 'public.career_applications', 'deleted_at', 'UPDATE'
  )
  and not has_column_privilege(
    'authenticated', 'public.career_applications', 'deleted_at', 'INSERT'
  )
  and not has_table_privilege('authenticated', 'public.career_applications', 'DELETE')
  and has_column_privilege('orbitos_rpc', 'public.career_applications', 'deleted_at', 'UPDATE')
  and not has_column_privilege('orbitos_rpc', 'public.career_applications', 'stage', 'UPDATE'),
  'deleted_at is writable only by the soft-delete RPC owner'
);

select ok(
  not has_column_privilege('authenticated', 'public.career_prep', 'body', 'INSERT')
  and not has_column_privilege('authenticated', 'public.career_prep', 'body', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.career_prep', 'DELETE')
  and has_function_privilege(
    'authenticated', 'public.import_career_prep_items(uuid,jsonb)', 'EXECUTE'
  ),
  'career prep is created only by the atomic import RPC'
);

select ok(
  to_regprocedure('public.save_career_prep_item(uuid,jsonb)') is null
  and to_regprocedure('internal.save_career_prep_item(uuid,jsonb)') is null
  and to_regprocedure('public.remove_career_prep_item(uuid)') is null
  and to_regprocedure('internal.remove_career_prep_item(uuid)') is null
  and not has_column_privilege('orbitos_rpc', 'public.todos', 'text', 'UPDATE')
  and not has_column_privilege('orbitos_rpc', 'public.career_prep', 'position', 'UPDATE')
  and has_column_privilege('orbitos_rpc', 'public.todos', 'deleted_at', 'UPDATE'),
  'career prep edits go through the todo writes Tasks uses'
);

select ok(
  not has_column_privilege(
    'authenticated', 'public.career_resources', 'uploaded_at', 'UPDATE'
  )
  and not has_column_privilege(
    'authenticated', 'public.career_resources', 'uploaded_at', 'INSERT'
  )
  and not has_column_privilege(
    'authenticated', 'public.career_resources', 'byte_size', 'UPDATE'
  ),
  'the browser cannot claim an upload finished or resize one after the fact'
);

select ok(
  (
    select count(*) = 1
      and bool_and(not bucket.public and bucket.file_size_limit = 26214400)
    from storage.buckets as bucket
    where bucket.id = 'career-resources'
  ),
  'the resources bucket is private and size bounded'
);

select ok(
  (
    select count(*) = 3
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname in (
        'career_resource_read',
        'career_resource_upload',
        'career_resource_delete'
      )
  )
  and not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.cmd = 'UPDATE'
      and coalesce(policy.qual, '') like '%career-resources%'
  ),
  'a stored file can be read, written once and removed, never overwritten'
);

select ok(
  not exists (
    select 1
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'career_applications'
      and column_row.column_name in ('next_step_at', 'next_step_on')
  ),
  'the next step is derived from the steps, never stored on the application'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

insert into career_applications (id, company, role, stage)
values (
  'a1111111-1111-4111-8111-111111111111',
  'Stripe',
  'Backend engineer',
  'applied'
);

select throws_ok(
  $$update career_applications set deleted_at = now()$$,
  '42501',
  null,
  'the browser cannot soft delete an application by hand'
);

select throws_ok(
  $$delete from career_applications$$,
  '42501',
  null,
  'the browser never hard deletes an application'
);

select throws_ok(
  $$insert into career_applications (company, role) values ('Acme', '  ')$$,
  '23514',
  null,
  'an application needs a real role'
);

select lives_ok(
  $$select soft_delete_record('application', 'a1111111-1111-4111-8111-111111111111')$$,
  'the shared record RPC soft deletes an application'
);

select is(
  (select count(*)::int from career_applications),
  0,
  'a deleted application leaves the browser view'
);

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

select is(
  (select count(*)::int from career_applications),
  0,
  'applications are private to their owner'
);

select throws_ok(
  $$insert into career_questions (application_id, body)
    values ('a1111111-1111-4111-8111-111111111111', 'Borrowed')$$,
  '23503',
  null,
  'a question cannot reference another account application'
);

reset role;
select * from finish();
rollback;
