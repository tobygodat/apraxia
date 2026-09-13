begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select plan(14);
insert into auth.users(id,email) values
  ('11111111-1111-4111-8111-111111111111','assignments-a@example.test'),
  ('22222222-2222-4222-8222-222222222222','assignments-b@example.test');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into class_assignments(id,course_id,title,due_date) values
  ('33333333-3333-4333-8333-333333333333','math3012','Problem set','2020-03-08');
select is((select title from class_assignments), 'Problem set', 'owner reads saved assignment');
insert into class_assignments(id,course_id,title) values
  ('33333333-3333-4333-8333-333333333333','math3012','Retry') on conflict(id) do nothing;
select is((select count(*)::integer from class_assignments), 1, 'retried create does not duplicate');
update class_assignments set title='Revised',completed=true;
select is((select due_date::text from class_assignments), '2020-03-08', 'editing preserves overdue date');
select is((select completed from class_assignments), true, 'completion persists');
update class_assignments set completed=false;
select is((select completed from class_assignments), false, 'completion can be undone');
select throws_ok($$update class_assignments set user_id='22222222-2222-4222-8222-222222222222'$$, '42501', null, 'ownership is immutable');
select throws_ok($$update class_assignments set course_id='other'$$, '42501', null, 'course is immutable');
select throws_ok($$update class_assignments set title=' '$$, '23514', null, 'blank titles rejected');
select throws_ok($$update class_assignments set assignment_type='Invalid'$$, '23514', null, 'type is constrained');
select throws_ok($$update class_assignments set due_date='infinity'$$, '23514', null, 'dates stay in supported range');
select throws_ok($$insert into class_assignments(user_id,course_id,title) values ('22222222-2222-4222-8222-222222222222','math3012','Forged')$$, '42501', null, 'cannot write another account');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select is((select count(*)::integer from class_assignments), 0, 'another account cannot read assignments');
update class_assignments set title='Hijacked';
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select is((select title from class_assignments), 'Revised', 'another account cannot change assignments');
select throws_ok($$delete from class_assignments$$, '42501', null, 'browser cannot permanently delete assignments');
select * from finish();
rollback;
