# orbitOS — Personal-use implementation plan

Updated 2026-09-04 to reflect the owner's personal-use scope.
Product behavior: [SPEC.md](SPEC.md). Verified progress:
[implementation status](docs/IMPLEMENTATION_STATUS.md). Account setup:
[USER_ACTIONS.md](USER_ACTIONS.md).

## Delivery approach

Use local Supabase for development and one live Vercel/Supabase app for personal
use. Vercel calls the live environment **Production**; that label does not imply
a commercial launch standard. A separate Preview database, Preview OAuth clients,
and a staging release process are not required.

Release useful features as they work. The full spec describes the destination,
not a prerequisite for using Todos. Keep existing tests and security boundaries;
do not add multi-user product features, formal certification, monitoring services,
large-scale performance programs, or incident runbooks merely to declare a release ready.

Keep Google sign-in, RLS, private encrypted Calendar credentials, date correctness,
and recoverable writes. Local two-user tests check ownership protection; they do
not imply a multi-user product or require extra accounts in the live database.

## Execution update — 2026-09-04

The feature sequence below is implemented and deployed through `c2d8fd0`.
Live application sign-in, Todo/Today use, collections and search passed smoke
checks. The remaining work is the specific Calendar credential/configuration
handoff and its real-provider checks, plus actual 200% zoom QA. See
`docs/IMPLEMENTATION_STATUS.md` for evidence and `USER_ACTIONS.md` for the exact
owner steps. The milestone checklist below records the original delivery order.

## Todo release milestone (verified)

1. Inspect the deployed commit, current Vercel error logs, and hosted migration
   history. The live shell already recognizes an existing session; fresh Google
   sign-in and persisted Todo use still need verification. Do not assume the
   hosted database is empty from an older note.
2. Diagnose `/api/health`'s function error alongside the release work. Todo CRUD
   goes directly to Supabase; a health response checks function configuration,
   not database correctness or completion of the Todo flow.
3. Prepare the Todo release locally and run `npm run verify` plus relevant local
   database/HTTP checks. Until Calendar/Home is implemented, send `/` to `/todos`
   and show only usable destinations in navigation. Restore Home as the default
   when its Calendar/Today view works. Home is now the default entry.
4. Before schema changes, inspect live data and preserve a backup/export if there
   is data to protect. Apply only missing, locally verified forward migrations.
   Never run reset, rewind, or bulk test fixtures on the live database.
5. Publish the intended release to the existing Vercel app using its Production
   environment variables. Inspect the diff and deployment trigger before pushing
   the release branch: a push to `main` may deploy immediately. Apply required
   migrations first. No Preview deployment is a prerequisite.
6. In the live browser, check fresh Google sign-in, Add, edit, completion,
   delete/Undo, reload persistence, sign-out, and a direct `/todos` refresh.
   Confirm private records stay inaccessible when signed out. Fix failures in
   this flow before relying on it for personal tasks.

**Done when:** the owner can manage and recover saved Todos through the existing
Vercel URL. Calendar and other unfinished collections do not block this milestone.

## Remaining feature sequence

Phase numbers are retained for links in the existing technical notes.

### Phases 0–2 — Foundation, authentication, and Todos

The local foundation, schema/RLS tests, generated types, Todo adapter, and
authenticated `/todos` route are implemented. Finish the live Todo release above.
The reusable Today panel and persisted ordering are prepared for Home.

### Phase 3 — Read-only Google Calendar

- Connect the existing security/read cores to Vercel endpoints and private
  credential storage: connect, callback, token exchange/refresh, disconnect,
  reconnect, calendar discovery, preferences, and week events.
- Keep app sign-in and Calendar consent separate. Use exact callbacks for the
  live origin; add a separate local OAuth setup only if local live-Google testing
  becomes useful. No Preview OAuth setup is needed.
- Retain one-time session-bound state, read-only scopes, encrypted tokens, and
  sanitized errors. Handle refresh expiry/revocation with a usable reconnect flow.
- Check a real week fetch and visibility persistence using the owner's account.
  Review any provider consent/token-lifetime limitations for personal use rather
  than automatically requiring a public OAuth launch.

**Done when:** Calendar connects, refreshes or clearly requests reconnection,
and returns the selected week's visible calendars without exposing credentials.

### Phase 4 — Desktop Home

- Compose the Monday–Sunday Calendar on the left and Today on the right per
  `SPEC.md`. Keep their loading and failures independent.
- Use the prepared Today panel for overdue tasks, editing, completion, Undo,
  rescheduling, and saved drag/keyboard order.
- Check an ordinary week, overlapping/all-day events, a timezone boundary, long
  titles, keyboard use, and zoom. Preserve complete lists; investigate larger
  data performance when observed delays or errors justify it.

**Done when:** Home is useful for daily planning and Today works during Calendar
failure. Make Home the default entry again.

### Phase 5 — Ideas, Media, Projects, Add, and search

Implement and expose each collection as it becomes usable. Follow the field and
relationship definitions in `SPEC.md`: titleless Ideas, combined Book/Movie Media,
project status/detail with related Todos and Ideas, and soft delete/Undo.
Expand global Add and user-scoped search across the completed collections;
Calendar event creation opens Google's composer.

**Done when:** all four collections support manual entry, editing, retrieval,
and recovery, with no dead navigation destinations.

### Phase 6 — Ongoing upkeep

Check changes locally and smoke-test them on the live app. Keep forms recoverable,
pagination complete, keyboard controls usable, and logs free of personal contents
and credentials. Add basic security headers/CSP as a small follow-up, not a separate
launch project. Keep a short note on where data backups/exports live and how to
restore them; elaborate monitoring and disaster-recovery rehearsals are deferred.

Keep the previous working deployment available where possible. A code rollback
does not roll back stored data: use compatible migrations and forward fixes,
or restore the relevant backup if needed. There is no SQLite/cloud reverse sync.

### Phase 7 — Optional legacy import and retirement

Only if the owner wants old data: back up SQLite/Obsidian, agree the mapping,
rehearse locally, and import idempotently using `legacy_id`. Map Todos, Books/Movies
to Media, and Projects; review writing records before mapping them to Ideas.
Archive People rather than inventing a collection; do not import scanner state,
Telegram drafts, or proposals by default. Check counts, dates, and relationships.
Keep the legacy source and backups until import and cleanup are explicitly requested.

## Checks proportional to the change

- Cloud code: `npm run verify` and focused behavior tests.
- Schema/ownership: local migration, RLS, and affected RPC checks; regenerate types.
- Todo data integration: `npm run db:test:todos-http`; OAuth state locking:
  `npm run db:test:oauth-concurrency` when that behavior changes.
- Live release: a brief browser check of the changed flow. Automated browser
  coverage can grow when it prevents recurring regressions; a comprehensive
  end-to-end matrix is not a prerequisite for personal use.
- Documentation: check links, terminology, and consistency only.

## Deployment targets and deferred work

- Live Supabase: `tobydev / orbitos`, `oidvvenjamgcezdptfjr`, `us-east-1`.
- Live Vercel: `Toby Godat's projects / orbitos`, `https://orbitos-virid.vercel.app`.
- Keep the existing domain and provider defaults unless a concrete issue calls
  for a change. Custom domains and region tuning are not blockers.
- No separate Preview infrastructure, formal launch checklist, monitoring service,
  or large-data benchmark gate. Mobile, advanced recurrence, data export/account
  deletion UI, and legacy import remain later work.
