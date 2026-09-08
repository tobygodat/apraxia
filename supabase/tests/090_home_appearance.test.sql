begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select plan(10);
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'home-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'home-b@example.test');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into home_appearance(title) values ('My page');
select is((select title from home_appearance), 'My page', 'owner reads their appearance');
select is((select cover_position_x::integer from home_appearance), 50, 'default crop is centered');
update home_appearance set cover_position_x=0, cover_position_y=100;
select is((select cover_position_y::integer from home_appearance), 100, 'owner can position the crop');
select throws_ok($$update home_appearance set cover_position_x=-1$$, '23514', null, 'negative position rejected');
select throws_ok($$update home_appearance set cover_position_y=101$$, '23514', null, 'position above 100 rejected');
select throws_ok($$insert into home_appearance(user_id,title) values ('22222222-2222-4222-8222-222222222222','Other')$$,
  '42501', null, 'owner cannot insert another account appearance');
select throws_ok($$update home_appearance set cover_image='data:image/svg+xml;base64,AAAA'$$,
  '23514', null, 'active image formats are rejected');
select throws_ok($$update home_appearance set cover_image='data:image/webp;base64,' || repeat('A',350000)$$,
  '23514', null, 'cover size is bounded');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
select is((select count(*)::integer from home_appearance), 0, 'another account cannot read it');
update home_appearance set title='Changed';
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select is((select title from home_appearance), 'My page', 'another account cannot change it');
select * from finish();
rollback;
