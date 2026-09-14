# Task aggregation: coordinated Phase 1–2 release

Prepared on `claude/task-aggregation-roadmap-3df71e`. Phase 0 is retained in its
own commit. Phase 1 and Phase 2 must release together. No hosted migration or
Vercel deployment is part of preparation. Phases 3 and 4 remain deferred.

Migration: `20260914000100_assignment_todos.sql`.

The migration adds the owner-scoped class relationship, assignment type checks,
one-parent check, index and column grants. It copies original assignment IDs,
dates and completion into todos without inventing due times. Completion times
for historical completed assignments are migration-time estimates. The old table
remains readable under RLS, with browser writes revoked. Its old class FK is
removed so deleting a class can retain both its historical backup and detached
todos. Detaching a todo clears its class-only assignment type, never its owner.
The copy locks the legacy table until browser writes have been revoked.

Today includes class ID, name and assignment type in its existing complete-row
snapshot hash. The inline Classes adapter uses todo CRUD/completion and exact
soft-delete Undo tokens. Assignment changes invalidate navigation caches.

## Release steps (not performed during preparation)

1. Require successful **App checks** and **Database checks** on the release head.
   Save the generated `database-types` artifact into the checked-in types and
   rerun CI after that commit. No hosted database is used by these jobs.
2. Arrange the migration and dependent UI rollout in one maintenance window;
   the old Classes UI cannot save after write revocation. Pause assignment edits
   and inspect hosted migration history and the current legacy rows.
3. Export `class_assignments` with IDs, owner/class relationships, dates, types,
   and completion to a private backup. Record row counts per owner/class. Inspect
   todo-ID collisions before applying: no unrelated todo may share a legacy ID.
4. Apply only the new forward migration to the existing personal Supabase app.
   Verify every legacy row has a matching todo with the same owner, class, text,
   original due date, type and completion. Confirm due times are null and completed
   rows have completion timestamps. Confirm the backup rows are unchanged.
5. Deploy the matching UI to the existing personal Vercel app. Do not deploy the
   migration and adapter as separate releases. Keep the backup table; rollback
   requires a deliberate forward fix, not a hosted rewind or automatic old-UI deploy.
6. In the authenticated app, create and edit a class assignment, add/remove an
   optional time, complete/reopen it from Classes and Tasks, and soft-delete/Undo.
   Verify Classes, Tasks, Home, search and project behavior after navigation and
   reload. Check original overdue dates and Today ordering. Confirm the old table
   rejects browser writes and a second account cannot access another account's rows.

QA uses fictional data shared across Classes, Tasks and Home. Navigation checks
can establish frontend consistency; reload resets assignment/task fixtures. They
cannot establish authenticated database persistence, hosted row counts, Google
provider behavior, or live deployment correctness. Those remain release checks.
