# Cloud rebuild execution bookmark

Updated 2026-09-04. SPEC.md defines behavior; IMPLEMENTATION_PLAN.md defines
scope. One personal live Vercel/Supabase environment, plus local development.

## Implemented

- Shared authenticated shell; Home at /, Todos, Projects/detail, Ideas, Media,
  Settings, global Add, and keyboard search. Session checkpoint pages removed.
- Todos retain Inbox, overdue dates, current/navigated weeks, completion, edit,
  rescheduling, delete/Undo, complete Today pagination and atomic manual ordering.
- Home loads Today independently from its read-only Calendar grid. Monday–Sunday,
  all-day spans, deterministic overlap lanes, hourly scrolling, week navigation,
  timezone, current-day/time emphasis, and Google event links are implemented.
- Calendar connect/callback/complete/disconnect/status/discovery/events endpoints:
  verified sessions, one-use state and PKCE, encrypted private refresh tokens,
  bounded refresh/revocation recovery, and saved visibility. Omitted replacement
  refresh tokens are retained only after validation. Callback material stays in
  memory and is stripped from the handoff URL before session restoration.
- Compact Projects, Ideas and Media lists with 50-record pages; shared editors
  preserve failed drafts. Project removal preserves child records and their IDs.
  Titleless Ideas keep a null title. Media preserves existing stored ratings.
- Global capture keeps the route. Search uses the existing RPC with 200ms
  debounce, 40-result pages, exact record opening and retained queries.
- Node ESM import repair, basic security headers and self-hosted fonts.
  Legacy Python source/data remain intact.

## Verification

- npm run verify: 62 files / 1,635 tests, both type checks, production build,
  and eight-file browser secret-boundary scan passed after the modern-key fix
  and Settings polish. The project CSS alignment was visually confirmed.
- Six local migrations applied; local reset/lint passed. All 176 pgTAP assertions
  in nine files passed. Generated types match the local schema.
- Local OAuth concurrency checks previously passed concurrent consume, expiry
  while waiting, and rollback/retry with separate PostgreSQL sessions.
- Local Auth/PostgREST Todo checks passed CRUD, isolation, exact Undo, persisted
  ordering, and 1,005 Today rows without increasing the server cap. Authenticated
  UI checks passed Add, reload, completion, Undo and sign-out.
  An initial empty-workspace HTTP failure did not reproduce on two reruns;
  its cause is unconfirmed. No speculative production retry was added.
- Real local CalendarStore read with a modern secret key returns a null
  connection. Local HTTP suite: three files / four tests passed.
- Browser checks include ordinary Home, disconnected Calendar with usable Today,
  error states, long project content, collection editors, keyboard search, and
  editor overflow at 760×421. Actual 200% browser zoom remains unverified;
  reduced viewport testing is not a substitute. See LOCAL_UI_QA.md.
- Build warning: cloud chunk approximately 578KB raw / 158KB gzip; no failed
  check. Optimize if actual usage warrants it.

## Live release and data

Target: https://orbitos-virid.vercel.app; Supabase oidvvenjamgcezdptfjr.

- The previous production commit was aa7d620; the apparent checkpoint was a stale
  page. Reload showed Todos, but hosted app schemas and history were absent.
  One existing Auth user was preserved.
- Migrations 001–005 applied forward in a transaction after checking the empty
  hosted app schema. Migration 006 applied separately after local checks.
  No hosted reset/rewind used. History is recorded in
  supabase_migrations.schema_migrations.
- Commit 0320d71 deployed successfully. /api/health returns 200, application
  configured, no-store/no-referrer. Its old 500 was an extensionless Node import
  failure confirmed in Vercel logs.
- Follow-up c2d8fd0 also deployed successfully, with modern-key transport and
  Settings polish. The hosted schema has six migration entries; cleanup query
  confirmed zero non-deleted Todos, Projects, Ideas and Media after smoke tests.
- Real application sign-out and fresh owner Google sign-in passed. Home loaded
  and the Auth callback query was removed. Calendar consent is separate.
- Live Todos passed capture, edit, completion, reload, delete, Undo, and repeat
  deletion. The disposable release Todo is soft-deleted.
- Live Projects/titleless Ideas passed contextual capture, association, direct
  project-route refresh, search retrieval and Idea editing. Project deletion
  preserved the Idea; Undo restored its project badge after reload.
- Live Media passed capture, Finished status, reload and delete/Undo. Today
  passed capture, reload, completion during Calendar failure, and unchanged
  eligibility after Calendar week navigation. All five disposable release
  records (two Todos, project, Idea and Media) are now soft-deleted.

## Remaining release checks

- Vercel lacks GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
  GOOGLE_TOKEN_ENCRYPTION_KEY (names inspected, values not revealed). Configure
  them in Production, enable Google Calendar API and add exact redirect
  https://orbitos-virid.vercel.app/api/calendar/callback.
  Owner credential entry and separate read-only consent are still required.
- Calendar status remains blocked by the deployed server credential. On c2d8fd0,
  sanitized Vercel diagnostics show read_calendar_credentials upstream HTTP 401.
  Modern apikey-only and legacy JWT transports are tested; the local modern-key
  HTTP read passes. The hosted database function returns null correctly in SQL.
  Repair SUPABASE_SERVICE_ROLE_KEY in Vercel Production with the active secret
  key for this Supabase project, then redeploy and retest. Browser keys and
  Google application sign-in already work; do not repeat that setup.
- After configuration verify a real week, hidden-calendar persistence, revoked
  access/reconnect and disconnect. These are not verified by fixtures.
- Complete actual 200% desktop zoom inspection when browser zoom control is
  available. No mobile redesign, public launch process or Preview setup needed.

## Backups and deferred work

Legacy SQLite backup, ignored by Git:
.local/backups/orbitos-legacy-20260904T212441Z.db.
Created through SQLite's backup API; integrity_check returned ok.
Original orbitos.db and legacy source remain intact. This is a local copy,
not a verified off-device backup. Hosted backup retention is unverified;
no hosted app-data backup was needed before the initially empty schema install.

Export/account deletion UI, legacy import, mobile, recurrence, AI, reminders,
analytics, rich text, metadata services and new infrastructure remain deferred.
