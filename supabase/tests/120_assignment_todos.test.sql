begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select plan(12);
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','aggregation-a@example.test'),
 ('22222222-2222-4222-8222-222222222222','aggregation-b@example.test');
insert into classes(user_id,id,name) values
 ('11111111-1111-4111-8111-111111111111','math','Math'),
 ('22222222-2222-4222-8222-222222222222','foreign','Foreign');
insert into class_assignments(id,user_id,course_id,title,due_date,completed,assignment_type) values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','math','Historical','2020-03-08',true,'Quiz');
-- Exercise the idempotent backfill against nonempty historical input.
insert into todos(id,user_id,text,due_date,class_id,assignment_type,completed,completed_at,source)
 select id,user_id,title,due_date,course_id,assignment_type,completed,
 case when completed then statement_timestamp() else null end,'manual' from class_assignments on conflict(id) do nothing;
select is((select id::text from todos),'33333333-3333-4333-8333-333333333333','backfill preserves ID');
select is((select due_date::text from todos),'2020-03-08','backfill preserves original date');
select ok((select completed and completed_at is not null and due_time is null from todos),'completion retained without invented due time');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select throws_ok($$insert into todos(text,class_id) values ('Foreign','foreign')$$,'23503',null,'class FK is owner scoped');
select throws_ok($$insert into todos(text,assignment_type) values ('No class','Quiz')$$,'23514',null,'type requires class');
insert into projects(title) values ('Project');
select throws_ok($$insert into todos(text,class_id,project_id) select 'Two parents','math',id from projects$$,'23514',null,'one parent only');
select lives_ok($$update todos set assignment_type='Homework', due_time='14:00'$$,'authenticated new column grants');
select throws_ok($$update todos set user_id='22222222-2222-4222-8222-222222222222'$$,'42501',null,'owner remains immutable');
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select is((select count(*)::int from todos),0,'other account cannot read class todos');
select is((select count(*)::int from class_assignments),0,'backup retains RLS');
reset role;
delete from classes where user_id='11111111-1111-4111-8111-111111111111' and id='math';
select ok((select class_id is null and assignment_type='' and user_id='11111111-1111-4111-8111-111111111111' from todos),'deleting class retains task and clears class-only metadata');
select is((select count(*)::int from class_assignments),1,'class deletion retains historical backup');
select * from finish();
rollback;
