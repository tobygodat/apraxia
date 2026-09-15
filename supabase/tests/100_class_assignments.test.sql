begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select plan(16);
insert into auth.users(id,email) values
  ('11111111-1111-4111-8111-111111111111','assignments-a@example.test'),
  ('22222222-2222-4222-8222-222222222222','assignments-b@example.test');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into classes(id,name) values ('math3012','MATH3012');
insert into todos(id,class_id,text,due_date) values
  ('33333333-3333-4333-8333-333333333333','math3012','Problem set','2020-03-08');
select is((select text from todos), 'Problem set', 'owner reads saved assignment');
insert into todos(id,class_id,text) values
  ('33333333-3333-4333-8333-333333333333','math3012','Retry') on conflict(id) do nothing;
select is((select count(*)::integer from todos), 1, 'retried create does not duplicate');
update todos set text='Revised',completed=true;
select is((select due_date::text from todos), '2020-03-08', 'editing preserves overdue date');
select is((select completed from todos), true, 'completion persists');
update todos set completed=false;
select is((select completed from todos), false, 'completion can be undone');
select throws_ok($$update todos set user_id='22222222-2222-4222-8222-222222222222'$$, '42501', null, 'ownership is immutable');
select throws_ok($$update todos set class_id='other'$$, '23503', null, 'class must belong to owner');
select throws_ok($$update todos set text=' '$$, '23514', null, 'blank texts rejected');
select throws_ok($$update todos set assignment_type='Invalid'$$, '23514', null, 'type is constrained');
select throws_ok($$update todos set due_date='infinity'$$, '23514', null, 'dates stay in supported range');
select throws_ok($$insert into todos(user_id,class_id,text) values ('22222222-2222-4222-8222-222222222222','math3012','Forged')$$, '42501', null, 'cannot write another account');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select is((select count(*)::integer from todos), 0, 'another account cannot read assignments');
update todos set text='Hijacked';
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select is((select text from todos), 'Revised', 'another account cannot change assignments');
select throws_ok($$delete from todos$$, '42501', null, 'browser cannot permanently delete assignments');
select throws_ok($$insert into class_assignments(course_id,title) values ('math3012','Legacy write')$$, '42501', null, 'backup rejects inserts');
select throws_ok($$update class_assignments set title='Legacy write'$$, '42501', null, 'backup rejects column updates');
select * from finish();
rollback;
