begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to anon, authenticated;
grant execute on all functions in schema extensions to anon, authenticated;

select plan(33);

select set_config('orbitos.test_local_date',
  ((statement_timestamp() at time zone 'America/New_York')::date)::text, true);
insert into auth.users (id, email) values
  ('66666666-6666-4666-8666-666666666661', 'pages-a@example.test'),
  ('66666666-6666-4666-8666-666666666662', 'pages-b@example.test'),
  ('66666666-6666-4666-8666-666666666663', 'pages-empty@example.test');

set local role authenticated;
set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666662';
insert into public.todos (text, due_date)
values ('Foreign task', current_setting('orbitos.test_local_date')::date);
select set_config('orbitos.foreign_id', (select id::text from public.todos), true);

set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666661';
insert into public.projects (title) values ('Original project');
insert into public.todos (text, due_date, due_time, project_id)
select 'Page task ' || lpad(n::text, 4, '0'),
  current_setting('orbitos.test_local_date')::date,
  case when n % 2 = 0 then time '09:00:00.123456' else null end,
  (select id from public.projects)
from generate_series(1, 2500) as n;

create temporary table captures (name text primary key, payload jsonb not null);
insert into captures values ('first', public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date));

select ok(to_regprocedure('public.get_today_todos(date)') is null,
  'the unbounded set-returning reader is no longer an exposed public RPC');
select is((select (payload->>'total_count')::integer from captures where name = 'first'),
  2500, 'the first page reports all 2500 owned eligible todos');
select is((select jsonb_array_length(payload->'items') from captures where name = 'first'),
  200, 'the default page is bounded at 200 rows');
select ok((select payload->>'snapshot_token' ~ '^[0-9a-f]{64}$' from captures where name = 'first'),
  'the snapshot token uses the agreed lower-case SHA256 format');
select ok((select bool_and(item->'today_rank' = 'null'::jsonb
    and item->>'is_manually_ordered' = 'false'
    and item->>'is_overdue' = 'false')
  from captures, jsonb_array_elements(payload->'items') item where name = 'first'),
  'null ranks and Today flags survive scalar JSON projection');
select ok((select bool_and(item->>'due_time' = '09:00:00.123456'
    and item->>'created_at' ~ '\+00:00$' and item->>'updated_at' ~ '\+00:00$')
  from captures, jsonb_array_elements(payload->'items') item where name = 'first'),
  'SQL microseconds and explicit UTC timestamps reach the page unchanged');

set local timezone = 'Pacific/Auckland';
select is(public.get_today_todos_page(current_setting('orbitos.test_local_date')::date)->>'snapshot_token',
  (select payload->>'snapshot_token' from captures where name = 'first'),
  'a session timezone change does not alter canonical snapshot serialization');

create temporary table collected (position bigint primary key, item jsonb not null);
do $$
declare
  page jsonb;
  position integer := 0;
  token text := (select payload->>'snapshot_token' from captures where name = 'first');
begin
  while position < 2500 loop
    page := public.get_today_todos_page(
      current_setting('orbitos.test_local_date')::date, position, 200, token);
    if jsonb_array_length(page->'items') < 1
      or jsonb_array_length(page->'items') > 200 then
      raise exception 'pagination made no bounded progress';
    end if;
    insert into collected
    select position + ordinality, value from jsonb_array_elements(page->'items') with ordinality;
    position := position + jsonb_array_length(page->'items');
  end loop;
end
$$;
select is((select count(*) from collected), 2500::bigint,
  'bounded pages drain the complete 2500-row snapshot');
select is((select count(distinct item->>'id') from collected), 2500::bigint,
  'page boundaries do not repeat or lose record identities');
select results_eq(
  $$select (item->>'id')::uuid from collected order by position$$,
  $$select id from internal.get_today_todos(current_setting('orbitos.test_local_date')::date)$$,
  'drained pages retain the complete deterministic database order');

select throws_ok($$select public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date, 200)$$,
  '22023', 'invalid Today page request', 'later pages require their snapshot token');
select throws_ok($$select public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date, 0, 201)$$,
  '22023', 'invalid Today page request', 'requests cannot exceed the 200-row page bound');
select throws_ok($$select public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date, -1)$$,
  '22023', 'invalid Today page request', 'negative offsets are rejected');
select throws_ok($$select public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date, 0, 200, 'bad')$$,
  '22023', 'invalid Today page request', 'malformed tokens are rejected');
select throws_ok($$select public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date, 2501, 200,
  (select payload->>'snapshot_token' from captures where name = 'first'))$$,
  '22023', 'invalid Today page request', 'an offset beyond the total is rejected');
select throws_ok($$select public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date, 200, 200, repeat('0', 64))$$,
  '40001', 'Today changed while loading', 'a valid but mismatching token is a retryable stale snapshot');

insert into captures values ('order', public.reorder_today_todos(
  current_setting('orbitos.test_local_date')::date,
  array(select (item->>'id')::uuid from collected order by position desc)));
select is((select (payload->>'applied_count')::integer from captures where name = 'order'),
  2500, 'one scalar receipt confirms an atomic reorder above 1000 rows');
select is((select (payload->>'rank_step')::integer from captures where name = 'order'),
  1024, 'the receipt confirms the deterministic rank step');
select is((select payload->>'order_fingerprint' from captures where name = 'order'),
  (select encode(sha256(convert_to(string_agg(item->>'id', ',' order by position desc), 'UTF8')), 'hex')
   from collected), 'the receipt fingerprints the complete actual saved UUID order');
select results_eq(
  $$select id from internal.get_today_todos(current_setting('orbitos.test_local_date')::date)$$,
  $$select (item->>'id')::uuid from collected order by position desc$$,
  'a fresh read retains all 2500 saved ranks in the requested order');
select throws_ok($$select public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date, 200, 200,
  (select payload->>'snapshot_token' from captures where name = 'first'))$$,
  '40001', 'Today changed while loading', 'reordering invalidates an earlier page snapshot');

insert into captures values ('renamed', public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date));
update public.projects set title = 'Renamed project';
select throws_ok($$select public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date, 200, 200,
  (select payload->>'snapshot_token' from captures where name = 'renamed'))$$,
  '40001', 'Today changed while loading', 'a joined project title change invalidates the snapshot');

insert into captures values ('timestamp', public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date));
update public.todos set text = text where text = 'Page task 0001';
select throws_ok($$select public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date, 200, 200,
  (select payload->>'snapshot_token' from captures where name = 'timestamp'))$$,
  '40001', 'Today changed while loading', 'updated-at-only changes invalidate the snapshot');

select throws_ok($$select public.reorder_today_todos(
  current_setting('orbitos.test_local_date')::date,
  array[current_setting('orbitos.foreign_id')::uuid])$$,
  '22023', 'Today list changed; reload and try again', 'foreign reorder IDs fail without revealing ownership');
select throws_ok($$select public.reorder_today_todos(
  current_setting('orbitos.test_local_date')::date,
  array[array[current_setting('orbitos.foreign_id')::uuid]])$$,
  '22023', 'invalid Today reorder request', 'multidimensional UUID inputs are rejected');
select results_eq(
  $$select id from internal.get_today_todos(current_setting('orbitos.test_local_date')::date)$$,
  $$select (item->>'id')::uuid from collected order by position desc$$,
  'rejected public reorders leave the complete saved order unchanged');

set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666662';
select is((public.get_today_todos_page(current_setting('orbitos.test_local_date')::date)->>'total_count')::integer,
  1, 'a second user receives only their own Today row');
select throws_ok($$select public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date, 0, 200,
  (select payload->>'snapshot_token' from captures where name = 'timestamp'))$$,
  '40001', 'Today changed while loading', 'snapshot tokens cannot be reused across owners');

set local request.jwt.claim.sub = '66666666-6666-4666-8666-666666666663';
insert into captures values ('empty', public.get_today_todos_page(
  current_setting('orbitos.test_local_date')::date));
select is((select (payload->>'total_count')::integer from captures where name = 'empty'),
  0, 'an empty Today page still carries an explicit total');
select is((select payload->'items' from captures where name = 'empty'),
  '[]'::jsonb, 'empty Today is an empty array, not absent metadata');
select is(public.reorder_today_todos(
  current_setting('orbitos.test_local_date')::date, '{}'::uuid[])->>'order_fingerprint',
  encode(sha256(''::bytea), 'hex'), 'empty reordering returns the SHA256 empty-order receipt');

reset role;
set local role anon;
select throws_ok($$select public.get_today_todos_page(current_date)$$,
  '42501', null, 'anonymous callers cannot use the public page RPC');
select throws_ok($$select public.reorder_today_todos(current_date, '{}'::uuid[])$$,
  '42501', null, 'anonymous callers cannot use the scalar mutation RPC');
reset role;
select * from finish();
rollback;
