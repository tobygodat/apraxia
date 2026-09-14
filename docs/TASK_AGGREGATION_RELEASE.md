# Task aggregation: coordinated release dependencies

Prepared on `claude/task-aggregation-roadmap-3df71e`. Phase 0 is retained in its
own commit. Phase 1 and Phase 2 must release together. No hosted migration or
Vercel deployment is part of preparation. Phase 3 is implemented on top of `59342b8` and prepared for release. Phase 4 remains deferred; retain the `class_assignments` backup.

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
6. In the authenticated app, check All/Projects/Classes/Unassigned filtering,
   project and class/type chips, and parent switching in Tasks, Home, Global Add,
   project dialogs, and search editing. Confirm switching to a project or no class
   clears assignment type and never leaves two parents. Create/rename a class and
   confirm choices refresh. Create and edit a class assignment, add/remove an
   optional time, complete/reopen it from Classes and Tasks, and soft-delete/Undo.
   Verify Classes, Tasks, Home, search and project behavior after navigation and
   reload. Check original overdue dates and Today ordering. Confirm the old table
   rejects browser writes and a second account cannot access another account's rows.

QA uses fictional data shared across Classes, Tasks and Home. Navigation checks
can establish frontend consistency; reload resets assignment/task fixtures. They
cannot establish authenticated database persistence, hosted row counts, Google
provider behavior, or live deployment correctness. Those remain release checks.


## Phase 3 local handoff

Affected routes: `/todos`, `/`, shared Global Add, project task dialogs, and
search task editing. Preview: `http://localhost:5173/qa/workspace.html`.

- Tasks has project and class/type chips and a source select beside week
  navigation. Filtering preserves column order and Today rank order. It applies
  to Inbox too, remains selected through week navigation, and resets to All on reload.
- Workspace snapshots include paginated, RLS-scoped class summaries. Shared
  task dialogs allow one parent; assignment type is shown only for a class.
  An unavailable existing parent is retained until explicitly changed.
- Today displays class context. Class moves use the same atomic details write,
  and response reconciliation checks the class and assignment type.
- Class create/rename invalidates navigation data and refreshes task choices.
- Fictional Tasks, Home, and Classes share todo rows and class names. Reload
  restores seed tasks; it is a UI check, not a persistence check.

No new migration, hosted database operation, deployment, or Phase 4 cleanup is
part of Phase 3. Require App checks and Database checks on the eventual release
head; the successful Phase 1–2 CI run does not certify these uncommitted changes.
Authenticated persistence and the coordinated backup/migration/UI rollout above
remain release dependencies.


### Phase 3 verification (2026-09-14)

- `VITEST_MAX_WORKERS=2 npm run verify` passed: typechecks, 1,991 tests,
  production build, and browser-bundle boundary check. Default concurrency hit
  timeouts in unchanged database smoke tests; limiting workers resolved them
  without changing timeouts or repository configuration. The build retains its
  existing large-chunk advisory.
- Automated Chromium checks passed for Tasks and Home in realistic and dense
  scenarios: source filters, week navigation, parent switching, class-only type,
  Home add/edit, Global Add, cross-page Classes consistency, and reload.
- Portrait and no-cover (`typical`) Tasks/Home reload checks passed. Visual
  review covered these Home variants, dense cards, and 1000×760 dialog fit;
  no new clipping in changed controls or page errors were found.
- Project-composer transfer to a class and class-rename choice/chip refresh
  passed. Existing focused tests cover scheduling precision, focus recovery,
  completion, deletion/Undo, and Today ordering.
- `git diff --check` passed. The design detector reported only advisories from
  existing styles. Migration files and generated database types are unchanged.
- Git: expected worktree and `claude/task-aggregation-roadmap-3df71e`, starting
  at `59342b8`; Phase 3 was uncommitted at the original handoff; see the release continuation below.


## Release continuation (2026-09-14)

The release continuation is authorized to commit, push, run CI, and perform the
coordinated hosted migration and UI deployment. The preparation-only restriction
above describes the earlier phases; it does not prohibit this release. Phase 4
remains excluded.

The continuation verified all 44 Phase 3 paths in the original source worktree,
reviewed the parent-switching, pagination, response reconciliation, cache
invalidation, migration, and retained QA evidence. No additional UI changes were
needed. The bounded local verify run passed all 1,991 tests, typechecks, build,
and browser bundle checks. Required CI must pass on the pushed release head.

Hosted work is currently blocked by missing account access: Vercel CLI reports
logged out, and Supabase CLI reports `LegacyPlatformAuthRequiredError`. Windows
browser control also cannot initialize from this WSL checkout (`sandboxCwd is
not a local file URI`). Authenticate the CLIs in WSL to resume hosted inspection
and backup; authenticated application verification additionally needs an app
session. No hosted migration, backup export, or deployment has been performed
by this continuation. Keep `main` unchanged until the coordinated release can
proceed. The legacy `class_assignments` table remains retained.


### Account access restored and deployment packaging fix

Both CLIs are authenticated. Hosted inspection found one legacy assignment and
19 todos with zero ID collisions. Migration history stops at
`20260913000200`: the existing class/notes and private PDF migrations
(`20260913000300`, `20260913000400`) must run before aggregation. A private
backup of all legacy assignments and todos, per-owner/class counts, migration
history, and bucket configuration is retained outside the repository.

The first staged production build failed because two Classes tests imported
QA fixtures excluded by `.vercelignore`. Those tests now live in
`frontend/src/qa/`, preserving local/CI coverage while respecting the deployment
source boundary. The live domain and database were untouched by that failure.
Require both CI checks on the updated release head before the coordinated
forward migration and domain promotion.
