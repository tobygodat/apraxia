begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- The schema migration revokes default function EXECUTE from PUBLIC. These
-- grants are test-local and let assertions keep running after SET LOCAL ROLE.
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;

select plan(12);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
  and not has_schema_privilege('anon', 'private', 'CREATE')
  and not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_schema_privilege('authenticated', 'private', 'CREATE'),
  'browser roles have no private-schema privileges'
);

select ok(
  not exists (
    select 1
    from (
      values ('anon'), ('authenticated')
    ) as browser_role (role_name)
    cross join (
      values
        ('private.google_calendar_credentials'),
        ('private.google_oauth_transactions')
    ) as private_table (relation_name)
    cross join (
      values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
    ) as table_privilege (privilege_name)
    where has_table_privilege(
      browser_role.role_name,
      private_table.relation_name,
      table_privilege.privilege_name
    )
  ),
  'browser roles have no DML privileges on private tables'
);

select ok(
  has_schema_privilege('service_role', 'private', 'USAGE')
  and (
    select bool_and(
      has_table_privilege(
        'service_role',
        private_table.relation_name,
        table_privilege.privilege_name
      )
    )
    from (
      values
        ('private.google_calendar_credentials'),
        ('private.google_oauth_transactions')
    ) as private_table (relation_name)
    cross join (
      values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
    ) as table_privilege (privilege_name)
  ),
  'service_role retains the intended private-schema DML privileges'
);

select ok(
  not exists (
    select 1
    from (
      values
        ('public.profiles'),
        ('public.projects'),
        ('public.todos'),
        ('public.ideas'),
        ('public.google_calendar_connections'),
        ('public.google_calendar_preferences')
    ) as application_table (relation_name)
    cross join (
      values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
    ) as table_privilege (privilege_name)
    where has_table_privilege(
      'anon',
      application_table.relation_name,
      table_privilege.privilege_name
    )
  ),
  'anonymous callers have no DML privileges on personal tables'
);

select ok(
  (
    select bool_and(
      has_function_privilege(
        'authenticated',
        rpc.function_oid,
        'EXECUTE'
      )
      and not has_function_privilege(
        'anon',
        rpc.function_oid,
        'EXECUTE'
      )
    )
    from unnest(array[
      'public.get_today_todos_page(date,integer,integer,text)'::regprocedure,
      'public.reorder_today_todos(date,uuid[])'::regprocedure,
      'public.soft_delete_record(public.orbitos_record_type,uuid)'::regprocedure,
      'public.restore_record(public.orbitos_record_type,uuid,timestamptz)'::regprocedure,
      'public.search_records(text,integer,integer)'::regprocedure
    ]) as rpc (function_oid)
  ),
  'only authenticated can execute the public application RPCs'
);

select ok(
  has_schema_privilege('authenticated', 'internal', 'USAGE')
  and not has_schema_privilege('authenticated', 'internal', 'CREATE')
  and not has_schema_privilege('anon', 'internal', 'USAGE')
  and not has_function_privilege(
    'authenticated',
    'internal.request_user_id()'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'internal.lock_today_order(uuid)'::regprocedure,
    'EXECUTE'
  )
  and (
    select bool_and(
      has_function_privilege(
        'authenticated',
        helper.function_oid,
        'EXECUTE'
      )
      and not has_function_privilege(
        'anon',
        helper.function_oid,
        'EXECUTE'
      )
    )
    from unnest(array[
      'internal.reorder_today_todos(date,uuid[])'::regprocedure,
      'internal.soft_delete_record(public.orbitos_record_type,uuid)'::regprocedure,
      'internal.restore_record(public.orbitos_record_type,uuid,timestamptz)'::regprocedure
    ]) as helper (function_oid)
  ),
  'authenticated has only the internal access required by public wrappers'
);

select ok(
  (
    select count(*) = 3
      and bool_and(
        procedure.prosecdef
        and pg_get_userbyid(procedure.proowner) = 'orbitos_rpc'
        and 'search_path=""' = any(procedure.proconfig)
        and 'row_security=on' = any(procedure.proconfig)
      )
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'internal'
      and procedure.proname in (
        'reorder_today_todos',
        'soft_delete_record',
        'restore_record'
      )
  )
  and (
    select count(*) = 5
      and bool_and(
        not procedure.prosecdef
        and 'search_path=""' = any(procedure.proconfig)
      )
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'get_today_todos_page',
        'reorder_today_todos',
        'soft_delete_record',
        'restore_record',
        'search_records'
      )
  ),
  'public wrappers are invokers and internal helpers are hardened definers'
);

select ok(
  (
    select not role.rolcanlogin
      and not role.rolbypassrls
      and not role.rolsuper
    from pg_catalog.pg_roles as role
    where role.rolname = 'orbitos_rpc'
  ),
  'the RPC owner cannot log in or bypass row-level security'
);

select ok(
  (
    select count(*) = 2
      and bool_and(
        position(
          'internal.lock_today_order' in pg_get_functiondef(procedure.oid)
        ) > 0
        and position(
          'pg_advisory_xact_lock' in pg_get_functiondef(procedure.oid)
        ) = 0
        and position(
          'hashtextextended' in pg_get_functiondef(procedure.oid)
        ) = 0
        and position(
          'orbitos:today-order:' in pg_get_functiondef(procedure.oid)
        ) = 0
      )
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where (namespace.nspname, procedure.proname) in (
      ('internal', 'reorder_today_todos'),
      ('private', 'clear_ineligible_ranks_after_timezone_change')
    )
  ),
  'timezone cleanup and Today reorder delegate to one lock helper'
);

select ok(
  has_function_privilege(
    'orbitos_rpc',
    'internal.lock_today_order(uuid)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'internal.lock_today_order(uuid)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'internal.lock_today_order(uuid)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'internal.lock_today_order(uuid)'::regprocedure,
    'EXECUTE'
  )
  and (
    select not procedure.prosecdef
      and procedure.provolatile = 'v'
      and 'search_path=""' = any(procedure.proconfig)
      and position(
        'pg_advisory_xact_lock' in pg_get_functiondef(procedure.oid)
      ) > 0
      and position(
        'hashtextextended' in pg_get_functiondef(procedure.oid)
      ) > 0
      and position(
        'orbitos:today-order:' in pg_get_functiondef(procedure.oid)
      ) > 0
    from pg_catalog.pg_proc as procedure
    where procedure.oid = 'internal.lock_today_order(uuid)'::regprocedure
  ),
  'one RPC-only invoker helper owns the Today advisory-lock key contract'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select throws_ok(
  $$select * from private.google_calendar_credentials$$,
  '42501',
  null,
  'authenticated cannot resolve or read private credentials'
);

reset role;
set local role anon;

select throws_ok(
  $$select * from public.get_today_todos_page(current_date)$$,
  '42501',
  null,
  'anonymous callers cannot execute application RPCs'
);

reset role;
select * from finish();
rollback;
