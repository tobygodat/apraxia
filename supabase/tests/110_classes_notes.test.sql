begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select plan(8);
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','class-a@example.test'),
 ('22222222-2222-4222-8222-222222222222','class-b@example.test');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select import_classes('[{"id":"math3012","name":"MATH3012"}]');
update classes set name='Renamed';
select import_classes('[{"id":"math3012","name":"Old browser"}]');
select is((select name from classes), 'Renamed', 'stale import cannot overwrite name');
select throws_ok($$insert into todos(class_id,text) values ('missing','Orphan')$$, '23503', null, 'assignment requires own class');
select throws_ok($$insert into classes(id,name) values ('blank',null)$$, '42501', null, 'normal create requires name');
update classes set notes = '# Week 1

- [ ] read chapter 2';
select is((select notes from classes), E'# Week 1\n\n- [ ] read chapter 2', 'owner writes class notes');
select throws_ok($$update classes set notes = repeat('x', 40001)$$, '23514', null, 'class notes are bounded');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
update classes set notes = 'not mine';
select is((select count(*)::int from classes where notes = 'not mine'),0,'class notes private');
select is((select count(*)::int from classes),0,'classes private');
reset role;
select ok(
  not has_table_privilege('authenticated', 'private.retired_class_notes', 'SELECT')
    and not has_table_privilege('service_role', 'private.retired_class_notes', 'SELECT'),
  'the retired PDF note backup is readable by no API role');
select * from finish();
rollback;
