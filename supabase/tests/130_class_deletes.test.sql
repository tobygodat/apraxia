begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select plan(5);
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','class-delete-a@example.test'),
 ('22222222-2222-4222-8222-222222222222','class-delete-b@example.test');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into classes(id,name) values ('math3012','MATH3012');
insert into todos(id,class_id,text,assignment_type) values
 ('44444444-4444-4444-8444-444444444444','math3012','Problem set','Homework');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
delete from classes;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select is((select count(*)::int from classes), 1, 'another account cannot delete classes');
select lives_ok($$delete from classes$$, 'owner can delete a class');
select is((select count(*)::int from classes), 0, 'class deletion persists');
select ok((select class_id is null and assignment_type = '' and deleted_at is null from todos
  where id = '44444444-4444-4444-8444-444444444444'), 'class deletion detaches its tasks instead of deleting them');
reset role;
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'class_pdf%'),
  0, 'no browser policy reaches the retired class PDF bucket');
select * from finish();
rollback;
