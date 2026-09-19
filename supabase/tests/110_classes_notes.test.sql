begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select plan(18);
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
insert into class_notes(id,course_id,name,source,byte_size,content_sha256) values
 ('33333333-3333-4333-8333-333333333333','math3012','Lecture.pdf','upload',10,repeat('a',64));
select throws_ok($$select finish_class_pdf('33333333-3333-4333-8333-333333333333')$$, '22023', null, 'cannot finalize missing PDF');
select throws_ok($$update class_notes set uploaded_at=now()$$, '42501', null, 'browser cannot claim upload completion');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('class-pdfs','unreserved.pdf')$$, '42501', null, 'upload must have owner reservation');
insert into storage.objects(bucket_id,name,metadata) values ('class-pdfs',
 '11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.pdf','{"size":10,"mimetype":"application/pdf"}');
select lives_ok($$select finish_class_pdf('33333333-3333-4333-8333-333333333333')$$, 'finalize verifies object metadata');
select lives_ok($$select finish_class_pdf('33333333-3333-4333-8333-333333333333')$$, 'finalize retry is safe');
select ok((select uploaded_at is not null from class_notes), 'upload completion saved');
insert into class_notes(course_id,name,source,drive_file_id) values ('math3012','Drive.pdf','drive','file');
insert into class_notes(course_id,name,source,drive_file_id) values ('math3012','Drive.pdf','drive','file')
 on conflict(user_id,course_id,drive_file_id) do nothing;
select is((select count(*)::int from class_notes),2,'Drive retry does not duplicate');
update classes set notes = '# Week 1

- [ ] read chapter 2';
select is((select notes from classes), E'# Week 1\n\n- [ ] read chapter 2', 'owner writes class notes');
select throws_ok($$update classes set notes = repeat('x', 40001)$$, '23514', null, 'class notes are bounded');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
update classes set notes = 'not mine';
select is((select count(*)::int from classes where notes = 'not mine'),0,'class notes private');
select is((select count(*)::int from classes),0,'classes private');
select is((select count(*)::int from class_notes),0,'notes private');
select is((select count(*)::int from storage.objects where bucket_id='class-pdfs'),0,'PDF objects private');
select throws_ok($$select finish_class_pdf('33333333-3333-4333-8333-333333333333')$$, '42501', null, 'cannot finalize another owner note');
select throws_ok($$insert into class_notes(course_id,name,source,drive_file_id) values ('math3012','Foreign.pdf','drive','foreign')$$, '23503', null, 'note cannot reference another owner class');
select * from finish();
rollback;
