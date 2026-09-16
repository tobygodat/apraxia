begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
grant usage on schema extensions to service_role,authenticated;
grant execute on all functions in schema extensions to service_role,authenticated;
select plan(13);
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','agent-a@example.test'),
 ('22222222-2222-4222-8222-222222222222','agent-b@example.test');
select ok(not (select rolbypassrls from pg_roles where rolname='orbitos_agent'),'helper owner cannot bypass RLS');
set local role authenticated;
select throws_ok($$select agent_workspace('11111111-1111-4111-8111-111111111111','list','todos')$$,'42501',null,'browser cannot invoke agent API');
set local role service_role;
create temporary table agent_results(result jsonb);
insert into agent_results select agent_workspace('11111111-1111-4111-8111-111111111111','create','todos',null,'{"text":"Study","due_date":"2020-03-08"}','{}','create');
select is(agent_workspace('11111111-1111-4111-8111-111111111111','create','todos',null,'{"text":"Study","due_date":"2020-03-08"}','{}','create'),(select result from agent_results),'retry returns original result');
select throws_ok($$select agent_workspace('11111111-1111-4111-8111-111111111111','create','todos',null,'{"text":"Different"}','{}','create')$$,'40001',null,'changed retry rejected');
select is(jsonb_array_length(agent_workspace('22222222-2222-4222-8222-222222222222','list','todos')->'items'),0,'other owner cannot see record');
select throws_ok($$select agent_workspace('11111111-1111-4111-8111-111111111111','update','todos',(select result->'item'->>'id' from agent_results),'{"user_id":"22222222-2222-4222-8222-222222222222"}','{}','forged',(select result->'item'->>'version' from agent_results))$$,'22023',null,'owner mutation rejected');
select lives_ok($$select agent_workspace('11111111-1111-4111-8111-111111111111','update','todos',(select result->'item'->>'id' from agent_results),'{"completed":true}','{}','complete',(select result->'item'->>'version' from agent_results))$$,'completion succeeds');
select throws_ok($$select agent_workspace('11111111-1111-4111-8111-111111111111','update','todos',(select result->'item'->>'id' from agent_results),'{"text":"Stale"}','{}','stale',(select result->'item'->>'version' from agent_results))$$,'40001',null,'stale version rejected');
select is(jsonb_array_length(agent_workspace('11111111-1111-4111-8111-111111111111','changes','all')->'items'),2,'only committed writes audit once');
select is(agent_provider_write('11111111-1111-4111-8111-111111111111','begin','calendar','{"event":"one"}')->>'state','new','provider reservation created');
select is(agent_provider_write('11111111-1111-4111-8111-111111111111','begin','calendar','{"event":"one"}')->>'state','pending','uncertain provider retry held');
select is(agent_provider_write('11111111-1111-4111-8111-111111111111','finish','calendar','{"event":"one"}','{"status":201}')->>'state','completed','provider result persisted');
select is(agent_provider_write('11111111-1111-4111-8111-111111111111','begin','calendar','{"event":"one"}')->'result','{"status":201}'::jsonb,'provider retry returns result');
select * from finish();
rollback;
