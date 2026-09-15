-- Owner-scoped deletion for Classes. Until now classes, assignments, notes, and
-- their private PDF objects could only accumulate: no DELETE policy existed on
-- any of them, so an abandoned upload reservation kept its bytes forever.
-- Deletion stays owner-scoped and column-grant shaped like every other Classes
-- privilege; nothing here widens read or write access.

-- Assignments: an owner may remove their own rows. Foreign keys still require
-- the parent class to exist, so an assignment never outlives its class.
grant delete on public.class_assignments to authenticated;
create policy class_assignments_delete_own on public.class_assignments for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Notes: the row is still immutable after insert. Deleting it is the only
-- browser mutation added, and it never touches another account's rows.
grant delete on public.class_notes to authenticated;
create policy class_notes_delete on public.class_notes for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Classes: deleting a class removes its assignments and notes first. The
-- composite foreign keys have no ON DELETE action, so an attempt to delete a
-- class that still has children raises 23503 rather than silently orphaning it.
grant delete on public.classes to authenticated;
create policy classes_delete on public.classes for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Private PDF objects: an owner may delete the exact object reserved by one of
-- their own notes, matching the read/insert policies' path convention. Objects
-- are still immutable (no UPDATE policy) and unreserved paths remain unwritable.
create policy class_pdf_delete on storage.objects for delete to authenticated using (
  bucket_id = 'class-pdfs' and exists (
    select 1 from public.class_notes n where n.user_id = (select auth.uid()) and n.object_path = storage.objects.name
  )
);

-- Ordering note, and why there is no SECURITY DEFINER delete helper here:
-- removing a row from storage.objects in SQL unlinks the catalog entry without
-- freeing the stored bytes, so a definer function could not make "delete the
-- note and its object" atomic in any useful sense. The browser can do the real
-- work itself through the authenticated Storage API, which both removes the
-- bytes and the catalog row under the policy above. The app must therefore
-- delete the Storage object BEFORE the note row: the policy authorizes an
-- object only while its note still exists. If the note row is deleted first the
-- object becomes unreachable to its owner and is collected by the reaper below.

-- Abandoned upload reservations. A reservation is a note with source 'upload'
-- and no uploaded_at; it exists so an interrupted upload can be resumed with
-- "Finish saving". After 24 hours it is no longer a resumable attempt.
-- service_role only: this is an operator/scheduled task, never browser CRUD.
create function private.reap_abandoned_class_pdfs() returns setof text
language sql security definer set search_path = '' as $$
  with abandoned as (
    delete from public.class_notes n
    where n.source = 'upload'
      and n.uploaded_at is null
      and n.created_at < clock_timestamp() - interval '24 hours'
    returning n.object_path
  )
  select a.object_path from abandoned a
  join storage.objects o on o.bucket_id = 'class-pdfs' and o.name = a.object_path;
$$;
revoke all on function private.reap_abandoned_class_pdfs() from public, anon, authenticated;
grant execute on function private.reap_abandoned_class_pdfs() to service_role;
-- The returned paths are the reservations whose bytes did arrive but were never
-- finalized. Delete exactly those with the service-role Storage API, which frees
-- the bytes; reservations that returned no path never stored anything. To run it
-- manually: select private.reap_abandoned_class_pdfs();

-- content_sha256 verification. Supabase Storage records only eTag, size,
-- mimetype, cacheControl, lastModified, contentLength, and httpStatusCode in
-- storage.objects.metadata; the eTag is an MD5-derived value for single-part
-- uploads, so no SHA-256 is available to compare against today. The column is
-- not dropped, because it is not decorative: the app matches it against the
-- re-read file to refuse resuming a reservation with different bytes, and
-- dropping it would be a destructive hosted change that removes that check.
-- Instead finalization now verifies the hash whenever Storage does publish one,
-- so the guarantee upgrades itself without another migration. The signature is
-- unchanged; browser callers and generated types are unaffected.
create or replace function public.finish_class_pdf(p_note_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare note public.class_notes%rowtype;
declare object_hash text;
begin
  select * into note from public.class_notes where id = p_note_id and user_id = auth.uid() and source = 'upload' for update;
  if not found then raise exception using errcode = '42501', message = 'Note unavailable.'; end if;
  if note.uploaded_at is not null then return; end if;
  select o.metadata->>'sha256' into object_hash from storage.objects o
    where o.bucket_id = 'class-pdfs' and o.name = note.object_path
      and o.metadata->>'mimetype' = 'application/pdf' and (o.metadata->>'size')::bigint = note.byte_size;
  if not found then
    raise exception using errcode = '22023', message = 'PDF upload is incomplete. Choose the same PDF to finish saving.';
  end if;
  if object_hash is not null and object_hash is distinct from note.content_sha256 then
    raise exception using errcode = '22023', message = 'The stored PDF does not match this upload. Choose the same PDF to finish saving.';
  end if;
  update public.class_notes set uploaded_at = clock_timestamp() where id = note.id and user_id = auth.uid();
end $$;
revoke all on function public.finish_class_pdf(uuid) from public, anon;
grant execute on function public.finish_class_pdf(uuid) to authenticated;
