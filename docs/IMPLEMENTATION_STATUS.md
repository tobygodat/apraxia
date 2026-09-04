# Cloud rebuild execution bookmark

Updated 2026-09-04. Follow `IMPLEMENTATION_PLAN.md` for sequencing and acceptance;
this file records progress without marking blocked phases complete.

Latest root `npm run verify`: 49 test files / 1572 tests passed, both typechecks,
production build, and seven-file browser secret-boundary scan clean. Browser QA
evidence and its limits are in `LOCAL_UI_QA.md`.

## Local persistence milestone — 2026-09-04

- Local Supabase starts successfully. All five migrations apply; reset and lint
  passed, as did all 166 pgTAP assertions after correcting a nested modifying
  CTE in the isolation test. The local rewind/reapply command now retains the
  initial migration, as the CLI requires, and passed the same suite afterward.
- Canonical `frontend/src/types/database.ts` was generated from the local stack.
- OAuth concurrent consumption, expiry while waiting, and rollback/retry all
  passed on independent PostgreSQL sessions; exact fixture cleanup was verified.
  Fixed a missing closing brace in the runner's Docker metadata projection.
- The typed Supabase TodoService is mounted at authenticated `/todos`, with
  bounded workspace pages, exact Undo tokens, Today snapshot collection, and
  one-write reorder receipts. Home and other unfinished routes retain a checkpoint
  with a link to Todos; the reusable Today panel is not yet mounted on Home.
- `npm run db:test:todos-http` passed three tests across two files using real
  local Auth and PostgREST with fictional users and verified cleanup. Covers CRUD,
  ownership/relationship denial, Undo, completion, rescheduling, 1,005 eligible
  Today rows with the 1,000-row cap unchanged, and saved order on a fresh read.
  The authenticated UI test exercises Add, remount/reload, completion, delete/Undo,
  and sign-out in happy-dom against the same real API. It does not verify a real
  browser, Google sign-in, or a deployed Vercel environment.

## Prepared and locally checked

- Phase 0: root workspace, Vercel/React boundary, environment checks, production
  bundle isolation, and development-only UI previews.
- Phase 1: migrations, RLS/ownership/private schemas, atomic domain functions,
  browser auth lifecycle, shared contracts, and embedded PostgreSQL tests.
  Google sign-in now uses the SDK's identity-only PKCE flow, a fixed same-origin
  return, validated Supabase authorization URL, and sanitized pending/retry/
  timeout/cancellation handling. A development-only failure fixture was checked
  visually and by keyboard. The owner reports Google credentials configured
  and the shared secret replaced/disabled; provider/secret enabled-state labels
  were checked without revealing values. Approved app-origin/return settings
  and Google callback are saved, but real login still awaits remaining
  environment setup, deployment, and session-storage verification.
  A forward migration now rejects dates outside years 0001–9999 and times at
  or beyond 24:00, preserving valid microseconds. Invalid pre-existing rows
  block migration; they are never silently rewritten.
  Today now has bounded, snapshot-checked 200-row pages and one atomic reorder
  receipt, without the former 1,000-task cap. SQL/client integration checks
  cover complete 1,001/2,500-task lists and changes between pages; client-only
  rank/controller regressions also cover 5,000 tasks. Thirty-three additional
  pgTAP assertions have now passed on the real local database. See
  `TODAY_DATA_PROTOCOL.md` for the contract and real-stack gates.
- Phase 2: provider-injected Todos workspace and reusable Today panel. Both
  support manual CRUD, date/time/project edits, completion, and delete/Undo.
  Today additionally handles persisted full-list order, keyboard/drag reorder,
  local midnight, optimistic rollback, and read-only retry after a confirmed
  restore. The reschedule form changes only scheduling fields.
- Phase 3: server-only Calendar week windows, Google-event normalization, and
  bounded per-calendar page collection. The read core preserves all-day dates,
  timed offsets, date-line coverage, and successful calendars during partial
  failure. Its 294 focused tests include DST/midnight transitions, opposite
  date-line calendars, malformed provider input, pagination, and cancellation.
  A server-only Google read transport now adds bounded calendar discovery and
  event requests, response projection/limits, cancellation, and sanitized
  failures, covered by 69 additional fake-fetch tests.
  It has no live credentials, Calendar HTTP endpoint, persistence, or UI
  connection yet; see `CALENDAR_READ_CORE.md` for limits and integration gates.
  The security core now verifies Supabase sessions with bounded server reads,
  encrypts refresh tokens with owner/connection-bound authenticated encryption,
  and validates exact OAuth origins, callback/state shapes, and read-only
  scopes. Migration 005 adds service-only atomic OAuth state creation and
  consumption, with database-time expiry and exact owner/redirect matching.
  Its 56 embedded tests exercise the policy-to-SQL flow; 25 new pgTAP assertions passed
  on local Supabase. `CALENDAR_SECURITY_CORE.md` records the transaction adapter,
  browser callback/session handoff, and real
  OAuth verification still required.
  A guarded local-only runner now prepares all three true multi-session
  consume/expiry/rollback checks, with 27 guard tests. All three actual PostgreSQL
  scenarios passed on 2026-09-04.

## Next implementation work

- Verify the persisted Todo route in a real browser and hosted Preview, including
  real Google sign-in and account switching. Measure per-page complete-snapshot
  fingerprint cost on representative larger data before launch.
- Continue the typed Calendar state adapter and secure callback/session
  handoff, Google token exchange/refresh, read-transport integration, and visibility
  persistence, then independent Calendar/Today Home
  composition in plan order. The Today preview is not a completed Home page.

## Gates still open

- Google provider URL/callback and real sign-in verification. The owner reports
  provider credentials saved, the secret replaced, and the old secret disabled
  on 2026-09-03. Google's old-secret Disabled/new-secret Enabled labels and
  Supabase's Google Enabled status were observed without revealing secret values.
  Its button and local logic are implemented, but no real login has passed yet.
  Vercel assigns `https://orbitos-virid.vercel.app` as the Production domain,
  currently marked No Deployment. With explicit owner approval, the agent saved
  that origin in Supabase Site URL, Google JavaScript origins, and Vercel's
  Production-only `APP_URL`, plus the exact trailing-slash Supabase return URL.
  All were read back. The owner then separately approved adding the previously
  missing Google callback. The exact permanent-project Supabase Auth callback
  was saved and read back after reopening the Google client; the app origin
  and all other client fields were unchanged. This is configuration verification,
  not evidence that an end-to-end login or code exchange has passed.
  The five Supabase environment variables are present in Vercel Production
  only. On 2026-09-04, the three key settings were migrated to the existing
  modern publishable/secret keys and read back after reload. Supabase confirmed
  that the legacy JWT-based `anon` and `service_role` API keys were disabled.
  This completes UA-004 and the security repair tracked as UA-011. No deployment
  was triggered. Legacy application variables remain untouched and are tracked
  separately as UA-010.
- Vercel/Supabase Preview linkage, environment setup, Google OAuth, and eventual
  real-browser authenticated acceptance checks.

The owner supplied `tobydev / orbitos` on Supabase and `Toby Godat's projects /
orbitos` on Vercel. Read-only dashboard checks found Supabase Healthy in
`us-east-1`, with no tracked migrations, and Vercel linked to the intended repo
but with a failed initial deployment from older code and no serving Production
deployment. The owner subsequently confirmed Supabase is empty and intended
for the actual permanent project, so `oidvvenjamgcezdptfjr` is the Production
target, not disposable Preview infrastructure. Emptiness is owner-reported;
RLS/Auth/schema setup has not been verified. Development remains local and the
isolated hosted Preview target is still unselected. Cloud replacement files
remain local and unpublished. Finish real provider verification and obtain
publication and hosted-change approval before deployment or forward migrations.
The approved Production-only environment and URL settings above were changed;
modern keys replaced the disabled legacy keys. No database data, migration,
deployment, or OAuth scope was changed, and no reset/rewind test may target
this project.

See `USER_ACTIONS.md` for owner bookmarks. Embedded PostgreSQL, mocks, and local
fictional previews do not replace these gates. Legacy data and application
remain untouched; no cloud deployment or personal-data migration has run.
