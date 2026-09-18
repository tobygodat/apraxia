begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select plan(11);
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','recurring-a@example.test'),
 ('22222222-2222-4222-8222-222222222222','recurring-b@example.test');
-- Browser writes: the rule is input, its series link and spawn marker are not.
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select lives_ok($$insert into todos(text,due_date,due_time,recurrence_freq,recurrence_interval) values ('Problem set','2020-03-02','09:00','weekly',1)$$,'authenticated may set a repeat rule');
select throws_ok($$insert into todos(text,due_date,recurrence_freq,recurrence_series_id) values ('Forged','2026-09-18','weekly',gen_random_uuid())$$,'42501',null,'series link is not a browser column');
select throws_ok($$update todos set recurrence_spawned_at = now()$$,'42501',null,'spawn marker is not a browser column');
select throws_ok($$insert into todos(text,recurrence_freq) values ('No anchor','weekly')$$,'23514',null,'a rule requires a due date');
select throws_ok($$insert into todos(text,due_date,recurrence_freq,recurrence_interval) values ('Too often','2026-09-18','weekly',0)$$,'23514',null,'interval stays inside the stored range');
select ok((select recurrence_series_id is not null from todos),'the database assigns the series link');

-- Completion materializes exactly one successor, owned by the same account.
update todos set completed = true;
select is((select count(*)::int from todos where not completed),1,'completion creates one open occurrence');
select ok(
  (select bool_and(t.due_date >= (statement_timestamp() at time zone p.timezone)::date)
   from todos as t join profiles as p on p.user_id = t.user_id where not t.completed),
  'the successor is not created already overdue'
);
select ok(
  (select count(distinct recurrence_series_id) = 1 and count(*) = 2 from todos),
  'both occurrences share one series'
);

set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select is((select count(*)::int from todos),0,'the spawned occurrence stays inside its own account');

reset role;
select ok(
  not exists (
    select 1
    from (values ('anon'),('authenticated'),('service_role')) as browser_role (role_name)
    where has_function_privilege(
      browser_role.role_name,
      'private.spawn_recurring_todo()'::regprocedure,
      'EXECUTE'
    )
  ),
  'no browser role may execute the elevated spawn helper'
);
select * from finish();
rollback;
