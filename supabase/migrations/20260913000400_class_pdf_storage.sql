-- Private immutable PDF objects. Reserve a note first so interrupted uploads
-- always have an account-owned recovery record, rather than orphaned bytes.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('class-pdfs', 'class-pdfs', false, 52428800, array['application/pdf'])
  -- Local migration rewind preserves Storage buckets. Reapply the private
  -- configuration without deleting any existing objects.
  on conflict (id) do update set public = false,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy class_pdf_read on storage.objects for select to authenticated using (
  bucket_id = 'class-pdfs' and exists (
    select 1 from public.class_notes n where n.user_id = (select auth.uid()) and n.object_path = storage.objects.name
  )
);
create policy class_pdf_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'class-pdfs' and exists (
    select 1 from public.class_notes n where n.user_id = (select auth.uid()) and n.object_path = storage.objects.name and n.uploaded_at is null
  )
);
-- No overwrite/delete policies: retries cannot mutate an existing PDF.
-- The definer can inspect Storage metadata; ownership and exact object path are
-- derived inside this function. The caller cannot set uploaded_at directly.
create function public.finish_class_pdf(p_note_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare note public.class_notes%rowtype;
begin
  select * into note from public.class_notes where id = p_note_id and user_id = auth.uid() and source = 'upload' for update;
  if not found then raise exception using errcode = '42501', message = 'Note unavailable.'; end if;
  if note.uploaded_at is not null then return; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'class-pdfs' and o.name = note.object_path
    and o.metadata->>'mimetype' = 'application/pdf' and (o.metadata->>'size')::bigint = note.byte_size) then
    raise exception using errcode = '22023', message = 'PDF upload is incomplete. Choose the same PDF to finish saving.';
  end if;
  update public.class_notes set uploaded_at = clock_timestamp() where id = note.id and user_id = auth.uid();
end $$;
revoke all on function public.finish_class_pdf(uuid) from public, anon;
grant execute on function public.finish_class_pdf(uuid) to authenticated;
