begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;

select plan(25);

insert into auth.users(id, email) values
  ('77777777-7777-4777-8777-777777777771', 'oauth-a@example.test'),
  ('77777777-7777-4777-8777-777777777772', 'oauth-b@example.test');

select ok((
  select count(*) = 3 and bool_and(
    not p.prosecdef and 'search_path=""' = any(p.proconfig)
    and has_function_privilege('service_role',p.oid,'EXECUTE')
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and not has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not has_function_privilege('orbitos_rpc',p.oid,'EXECUTE')
  ) from pg_catalog.pg_proc p where p.oid in (
    'public.begin_calendar_oauth_transaction(uuid,text,text,timestamptz)'::regprocedure,
    'public.consume_calendar_oauth_transaction(uuid,text,text)'::regprocedure,
    'private.valid_calendar_oauth_transaction_input(uuid,text,text)'::regprocedure
  )
), 'OAuth functions are hardened invokers executable only by the server role');

set local role service_role;
create temporary table oauth_captures (name text primary key, receipt jsonb not null);
insert into oauth_captures values ('created', public.begin_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771', repeat('a',64),
  'https://app.example.test/api/calendar/callback', clock_timestamp()+interval '1 day'));

select is((select expires_at-created_at from private.google_oauth_transactions),
  interval '10 minutes', 'database time caps lifetime at ten minutes');
select is((select count(*)::integer from jsonb_object_keys((select receipt from oauth_captures where name='created'))),
  2, 'creation receipt contains only id and expiry');
select ok((select receipt ? 'id' and receipt ? 'expires_at' from oauth_captures where name='created'),
  'creation receipt has the expected fields');
select is((select user_id::text from private.google_oauth_transactions),
  '77777777-7777-4777-8777-777777777771', 'server-verified owner is persisted');
select is((select state_hash from private.google_oauth_transactions),
  repeat('a',64), 'only the supplied state hash enters the transaction');

select throws_ok($$select public.consume_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777772',repeat('a',64),
  'https://app.example.test/api/calendar/callback')$$,
  '22023','Calendar authorization could not be verified.','another owner cannot consume state');
select throws_ok($$select public.consume_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('a',64),
  'https://other.example.test/api/calendar/callback')$$,
  '22023','Calendar authorization could not be verified.','redirect must match exactly');
select throws_ok($$select public.consume_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('b',64),
  'https://app.example.test/api/calendar/callback')$$,
  '22023','Calendar authorization could not be verified.','unknown state is indistinguishable');
select throws_ok($$select public.begin_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777772',repeat('a',64),
  'https://app.example.test/api/calendar/callback',clock_timestamp()+interval '5 minutes')$$,
  '22023','Calendar authorization could not be verified.','a collision cannot overwrite another transaction');
select ok((select consumed_at is null from private.google_oauth_transactions),
  'failed attempts do not consume the correct state');

insert into oauth_captures values ('consumed', public.consume_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('a',64),
  'https://app.example.test/api/calendar/callback'));
select is((select receipt->>'id' from oauth_captures where name='consumed'),
  (select receipt->>'id' from oauth_captures where name='created'), 'consumption acknowledges the same transaction');
select ok((select consumed_at>=created_at and consumed_at<expires_at from private.google_oauth_transactions),
  'consumption occurs within the database-time lifetime');
select throws_ok($$select public.consume_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('a',64),
  'https://app.example.test/api/calendar/callback')$$,
  '22023','Calendar authorization could not be verified.','a second consumption is rejected');

insert into private.google_oauth_transactions(user_id,state_hash,redirect_uri,created_at,expires_at)
values ('77777777-7777-4777-8777-777777777771',repeat('c',64),
  'https://app.example.test/api/calendar/callback',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute');
select throws_ok($$select public.consume_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('c',64),
  'https://app.example.test/api/calendar/callback')$$,
  '22023','Calendar authorization could not be verified.','expired state is rejected');
select ok((select consumed_at is null from private.google_oauth_transactions where state_hash=repeat('c',64)),
  'expired state remains unconsumed');
select throws_ok($$select public.begin_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('d',64),
  'https://app.example.test/api/calendar/callback','infinity')$$,
  '22023','Calendar authorization could not be verified.','infinite expiry is rejected');
select throws_ok($$select public.begin_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('d',64),
  'https://app.example.test/api/calendar/callback',clock_timestamp()-interval '1 second')$$,
  '22023','Calendar authorization could not be verified.','past expiry is rejected');
select throws_ok($$select public.begin_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777779',repeat('d',64),
  'https://app.example.test/api/calendar/callback',clock_timestamp()+interval '5 minutes')$$,
  '22023','Calendar authorization could not be verified.','unknown owner does not disclose a foreign-key error');
select throws_ok($$select public.begin_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('D',64),
  'https://app.example.test/api/calendar/callback',clock_timestamp()+interval '5 minutes')$$,
  '22023','Calendar authorization could not be verified.','noncanonical state hash is rejected');
select throws_ok($$select public.begin_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('d',64),
  'http://app.example.test/api/calendar/callback',clock_timestamp()+interval '5 minutes')$$,
  '22023','Calendar authorization could not be verified.','nonlocal unencrypted redirects are rejected');

reset role;
set local role authenticated;
set local request.jwt.claim.sub='77777777-7777-4777-8777-777777777771';
select throws_ok($$select public.begin_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('d',64),
  'https://app.example.test/api/calendar/callback',clock_timestamp()+interval '5 minutes')$$,
  '42501',null,'authenticated browser cannot create even its own OAuth state');
select throws_ok($$select public.consume_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('a',64),
  'https://app.example.test/api/calendar/callback')$$,
  '42501',null,'authenticated browser cannot invoke consumption');
reset role;
set local role anon;
select throws_ok($$select public.begin_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('d',64),
  'https://app.example.test/api/calendar/callback',clock_timestamp()+interval '5 minutes')$$,
  '42501',null,'anonymous browser cannot create state');
select throws_ok($$select public.consume_calendar_oauth_transaction(
  '77777777-7777-4777-8777-777777777771',repeat('a',64),
  'https://app.example.test/api/calendar/callback')$$,
  '42501',null,'anonymous browser cannot consume state');

reset role;
select * from finish();
rollback;
