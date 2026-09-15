begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
grant usage on schema extensions to authenticated;
grant execute on all functions in schema extensions to authenticated;
select plan(15);
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','class-delete-a@example.test'),
 ('22222222-2222-4222-8222-222222222222','class-delete-b@example.test');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into classes(id,name) values ('math3012','MATH3012');
insert into todos(id,class_id,text,assignment_type) values
 ('44444444-4444-4444-8444-444444444444','math3012','Problem set','Homework');
insert into class_notes(id,course_id,name,source,byte_size,content_sha256) values
 ('33333333-3333-4333-8333-333333333333','math3012','Lecture.pdf','upload',10,repeat('a',64)),
 ('55555555-5555-4555-8555-555555555555','math3012','Seminar.pdf','upload',10,repeat('b',64)),
 ('66666666-6666-4666-8666-666666666666','math3012','Workshop.pdf','upload',10,repeat('c',64));
-- Hosted Storage forbids SQL deletes on storage.objects for every role (a
-- trigger insists on the Storage API), so this file only inserts objects and
-- asserts the delete policy through the catalog below.
insert into storage.objects(bucket_id,name,metadata) values
 ('class-pdfs','11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.pdf',
  '{"size":10,"mimetype":"application/pdf"}'),
 ('class-pdfs','11111111-1111-4111-8111-111111111111/55555555-5555-4555-8555-555555555555.pdf',
  '{"size":10,"mimetype":"application/pdf","sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}'),
 ('class-pdfs','11111111-1111-4111-8111-111111111111/66666666-6666-4666-8666-666666666666.pdf',
  '{"size":10,"mimetype":"application/pdf","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}');
select lives_ok($$select finish_class_pdf('33333333-3333-4333-8333-333333333333')$$, 'finalization succeeds when Storage records no hash');
select throws_ok($$select finish_class_pdf('55555555-5555-4555-8555-555555555555')$$, '22023', null, 'a Storage hash that differs rejects finalization');
select ok((select uploaded_at is null from class_notes where id='55555555-5555-4555-8555-555555555555'), 'a rejected hash leaves the reservation unfinished');
select lives_ok($$select finish_class_pdf('66666666-6666-4666-8666-666666666666')$$, 'a matching Storage hash finalizes the upload');
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
delete from class_notes;
delete from classes;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
select is((select count(*)::int from class_notes), 3, 'another account cannot delete notes');
select is((select count(*)::int from classes), 1, 'another account cannot delete classes');
select throws_ok($$delete from classes$$, '23503', null, 'a class with saved notes cannot be deleted');
delete from class_notes;
select is((select count(*)::int from class_notes), 0, 'owner can delete their notes');
select lives_ok($$delete from classes$$, 'owner can delete a class once its notes are gone');
select is((select count(*)::int from classes), 0, 'class deletion persists');
select ok((select class_id is null and assignment_type = '' and deleted_at is null from todos
  where id = '44444444-4444-4444-8444-444444444444'), 'class deletion detaches its tasks instead of deleting them');
reset role;
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'class_pdf_delete'
      and cmd = 'DELETE' and roles = '{authenticated}'::name[]),
  1, 'the private PDF delete policy targets only authenticated owners');
select ok(
  (select qual like '%class-pdfs%' and qual like '%class_notes%' and qual like '%auth.uid()%'
     and qual like '%object_path%' and with_check is null
   from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'class_pdf_delete'),
  'the delete policy authorizes only an object reserved by one of the owner’s own notes');
select is((select count(*)::int from private.reap_abandoned_class_pdfs()), 0, 'the reaper spares reservations newer than a day');
select ok(not has_function_privilege('authenticated', 'private.reap_abandoned_class_pdfs()'::regprocedure, 'EXECUTE')
  and not has_function_privilege('anon', 'private.reap_abandoned_class_pdfs()'::regprocedure, 'EXECUTE')
  and has_function_privilege('service_role', 'private.reap_abandoned_class_pdfs()'::regprocedure, 'EXECUTE'),
  'only the service role can reap abandoned uploads');
select * from finish();
rollback;
