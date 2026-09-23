# Classes data model

Classes, their assignments, and their written notes belong to the authenticated
account. Supabase is the source of truth; database failures never fall back to
browser storage. A class page holds its assignments and one Notes document.

## Relationships

| Table | Identity | Contents |
| --- | --- | --- |
| `classes` | `(user_id, id)` | Name, written notes, creation time, update revision |
| `todos` (with `class_id`) | UUID `id` | Assignment text, optional date and time, type, completion, soft delete |
| `class_assignments` | UUID `id` | Read-only backup of pre-aggregation rows; browser writes revoked |

Since `20260914000100_assignment_todos.sql` an assignment is an ordinary todo
whose `class_id` references `classes(user_id, id)` (`on delete set null`), with
a class-only `assignment_type`. The Classes page keeps its inline table but
reads and writes through `createTodoAssignmentService`, an adapter over the todo
service, so assignments appear on Tasks and Home, gain optional times, and are
deleted through the shared soft-delete RPC with Undo. See
[Task aggregation roadmap](history/TASK_AGGREGATION_ROADMAP.md) and
[Workspace data model](WORKSPACE_DATA_MODEL.md#publictodos). A parent class must
exist in the same account. Owner RLS applies independently on every table.
Browser column grants prevent changing owners and class relationships.

Class IDs remain text to preserve existing URLs and assignment relationships,
including `math3012`. New IDs are UUID strings. Names are labels, not identities:
ordinary UI edits reject duplicates, but migration preserves distinct legacy
IDs even when their labels match. Classes recovered from existing assignments
may temporarily have a null name; new user creates and renames require a name.

Migrated assignments kept their IDs, original date-only due dates, and
completion; no due time was invented. No terms, grades, or sharing are
introduced.

## Written notes

`20260919030000_class_written_notes.sql` gives each class one markdown document
in `classes.notes`: never null, empty until something is written, and bounded at
40,000 characters like the Career notes fields. The browser writes it through a
column grant under the same owner policy as a rename, so an unnamed recovered
class must be named before it takes notes. The field is the whole
document and its only writer, so the last save wins. A failed save keeps the
text in the field with the reason beneath it.

## Search

Since `20260918020000_search_classes_and_stemming.sql`, `classes` carries a
generated `search_vector` over its name and ID with a GIN index, so a class and
its assignments answer a workspace search for the course code. Written notes are
not indexed. See [Search](WORKSPACE_DATA_MODEL.md#search) for the result
contract; no client selects the vector column.

## Deletion

`20260914000300_class_deletes.sql` adds an owner-scoped `delete` policy for
`classes`. Deleting a class detaches its tasks: their `class_id` and
`assignment_type` clear and the tasks survive. Its written notes go with it. The
`class_assignments` backup is not deletable from the browser.

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
assignments recover that class when necessary. Browser preferences left by
retired features, such as a remembered Drive folder, are left untouched and no
longer read.

## Retired PDF notes

Classes once saved PDFs, uploaded from the device or picked from Google Drive,
in `public.class_notes`. `20260922210000_remove_class_pdfs_and_drive.sql` copied
every row to `private.retired_class_notes` (`id`, `user_id`, and the whole row
as `row_data`) before dropping the table, its upload finalization, and the
Drive connection. The backup has RLS on and no API grants or policies, so
nothing reads it.

The uploaded bytes remain in the private `class-pdfs` bucket, because Supabase
refuses SQL deletes on Storage objects and buckets. With its policies dropped
the bucket is unreachable from the browser. `row_data->>'object_path'` names
each file; once the files are kept elsewhere, empty and remove the bucket
through the Storage API or dashboard.

## Concurrent edits and errors

Class renames compare the exact loaded `updated_at` value. Conflicts keep the
form and name intact and request reload. Lost-response retries first confirm
whether the intended name was already stored. Creates use stable IDs and
ignore-duplicate insertion followed by a read, not overwrite upserts.

Loading, empty, not found, and failed save are distinct UI states. Service
reads are paginated and account/class-scoped. Navigation or account changes
abort/ignore stale responses. Reentering Classes fetches current account data;
realtime subscriptions are not required for persistence.

## Verification and release

Embedded database tests cover backfill with existing assignments, the
assignment-to-todo copy and its idempotence, shared legacy IDs across accounts,
transactional import, stale names, foreign keys, and RLS. Supabase pgTAP adds
managed database coverage, including the notes bound, private notes, and the
unreadable backup. Service and UI tests cover stable retries, load failures,
and saving notes.

The QA workspace uses explicit fictional services. Classes, notes, and
assignments survive navigation but reset on QA reload. Browser checks there
exercise the production UI, not database persistence.

[Cloud development](CLOUD_DEVELOPMENT.md#live-releases) covers the release rules.
Because fixtures do not prove persistence, a change to imports or saving needs
the authenticated app: report any flow it leaves unverified rather than treating
fixtures as database evidence.
