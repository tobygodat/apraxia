# Classes data model

Classes, assignments, and saved note associations belong to the authenticated
account. Supabase is the source of truth; database failures never fall back to
browser storage. The single Class name field and continuous PDF reader remain.

## Relationships

| Table | Identity | Contents |
| --- | --- | --- |
| `classes` | `(user_id, id)` | Name, creation time, update revision |
| `class_assignments` | UUID `id` | Class, title, SQL date, type, completion |
| `class_notes` | UUID `id` | Class, filename, source, upload state |

Assignments and notes reference `classes(user_id, id)` through composite foreign
keys. A parent must exist in the same account. Owner RLS applies independently
on all three tables. Browser column grants prevent changing owners, class
relationships, and server-managed upload completion.

Class IDs remain text to preserve existing URLs and assignment relationships,
including `math3012`. New IDs are UUID strings. Names are labels, not identities:
ordinary UI edits reject duplicates, but migration preserves distinct legacy
IDs even when their labels match. Classes recovered from existing assignments
may temporarily have a null name; new user creates and renames require a name.

Assignments retain their existing IDs, date-only due dates, completion, and
Undo behavior. They remain independent of Tasks. No terms, grades, sharing,
rich-text editing, or new delete flows are introduced.

## Browser-data migration

`20260913000300_classes_and_notes.sql` backfills one unnamed class per existing
assignment `(user_id, course_id)` before adding the foreign key. It does not
change assignment contents or IDs. The database cannot reconstruct class names
that existed only in a browser.

The app reads only the current user's `orbitos:classes:v1:${userId}` payload.
Legacy `{code,name}` records use code as their single display name. A bounded,
transactional, RLS-protected import inserts missing IDs or fills unnamed recovery
rows. Repeating it never overwrites an established database name, including a
newer rename from another browser. Malformed data is preserved with an error;
cloud classes remain available. The original browser payload is left untouched
as a recovery copy and is never written by the new app.

An absent browser key does not seed MATH3012 for new accounts. Existing
assignments recover that class when necessary. The retired Drive-folder
preference is not a saved PDF; it is left untouched and no longer consulted.
Previously opened temporary PDF files cannot be recovered after their page closes.

## Notes and file contents

Each class can have several saved PDFs. The saved-file list selects a document
in the existing reader; canvas state and temporary selection are not database
records. `class_notes` is immutable from browser CRUD after insertion; server
finalization alone can set `uploaded_at`.

### Drive notes

A Drive note records `drive_file_id` and its display filename when attached.
Uniqueness on `(user_id, course_id, drive_file_id)` makes repeated attachment
safe. The same file can belong to more than one class without duplicating bytes.

Add from Drive verifies the selected PDF through the existing authenticated
server download before saving its association. Reopening fetches the current
contents and filename from that file ID. The saved list retains its original
label; the reader displays the current source filename. No access URL or provider
token is stored in note data. Google access is checked on each download.

Disconnecting Drive preserves note records. Missing files and revoked access
produce an error rather than removing the record. If Goodnotes creates a new
file ID instead of updating the existing one, add that new PDF explicitly.
This is current-file retrieval, not background or bidirectional sync.

### Permanent device uploads

`20260913000400_class_pdf_storage.sql` creates the private `class-pdfs` bucket.
The limit is 50 MiB per PDF. The database stores metadata, not PDF bytes or base64.
A CHECK enforces exactly one source: a Drive ID, or upload size plus SHA-256.
Upload object paths are generated from account UUID and note UUID.

The upload protocol is:

1. Validate filename, size, and PDF signature; calculate SHA-256 and allocate a
   stable note UUID. Keep the file and draft ID while an attempt is pending.
2. Reserve the account-owned note row with immutable size/hash metadata. The row
   is explicitly incomplete and cannot yet be opened as a saved PDF.
3. Upload to its exact reserved path without overwrite permission. Storage RLS
   permits reads only to the note owner and inserts only for pending notes.
4. Call `finish_class_pdf`. It derives ownership from `auth.uid()`, locks the
   note, and verifies the matching Storage object's MIME metadata and size before
   recording completion. The function is idempotent and not callable by anon.
5. Confirm the saved row before marking the upload complete in the UI.

If a response is lost or the page closes, the pending row remains visible.
Finish saving can confirm an object that already arrived. Choose PDF again can
resume with the same note ID, but only if the selected bytes match the reserved
hash and size. No cleanup races can delete a successfully saved file: browser
code cannot overwrite or delete objects, and every attempted upload has a note
record. Incomplete rows may remain until the user resumes them.

The current Storage SDK upload method does not accept an AbortSignal. The app
stops waiting after navigation or a 120-second timeout; an in-flight immutable
upload may complete later and be recovered through Finish saving. Downloads
are authenticated and abortable. A future resumable-upload transport can reuse
this reservation protocol without changing note identity.

## Concurrent edits and errors

Class renames compare the exact loaded `updated_at` value. Conflicts keep the
form and name intact and request reload. Lost-response retries first confirm
whether the intended name was already stored. Creates use stable IDs and
ignore-duplicate insertion followed by a read, not overwrite upserts.

Loading, empty, not found, failed save, and incomplete upload are distinct UI
states. Service reads are paginated and account/class-scoped. Navigation or
account changes abort/ignore stale responses. Reentering Classes fetches current
account data; realtime subscriptions are not required for persistence.

## Verification and release

Embedded database tests cover backfill with existing assignments, shared legacy
IDs across accounts, transactional import, stale names, foreign keys, RLS,
private object access, immutable objects, and upload finalization. Service and UI
tests cover stable retries, wrong-file rejection, load failures, and reopening.
Supabase pgTAP adds managed database coverage; embedded Storage metadata tests
do not prove the Storage HTTP service uploaded any real bytes.

The QA workspace uses explicit fictional services. Classes, notes, and
assignments survive navigation but reset on QA reload. Browser checks there
exercise the production UI and reader, not real Google or database persistence.

Before release, follow [Cloud development](CLOUD_DEVELOPMENT.md): inspect hosted
data/migration history, preserve a backup, require App checks and Database checks,
obtain generated database types, apply forward migrations, and verify the normal
authenticated app. Test a browser import, fresh-browser access, a real device PDF
upload/reopen, interrupted upload recovery, and a real Drive PDF. Report any
unverified flows rather than treating fixtures as provider evidence.
