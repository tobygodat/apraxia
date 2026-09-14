# Cloud development

Use the root Node workspace: React/Vite, Vercel Functions, and Supabase.
Routine frontend development needs Node.js 22 (`.nvmrc`). GitHub Actions runs
database checks in a disposable Supabase instance on its own runner. Local Docker
is optional for full-stack debugging; the deployed app never depends on it.

## Daily development without Docker

```powershell
npm ci
npm run dev:web
```

Open `http://localhost:5173/qa/workspace.html` to check fictional UI flows.
Run `npm run verify` locally for types, unit/contract tests, build, and the browser
secret scan. Open a pull request to run the complete CI suite.

## GitHub Actions

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual
dispatch from the repository's **Actions → CI → Run workflow** page (once the
workflow exists on the default branch).

- **App checks** runs `npm ci` and `npm run verify` on Node.js 22.
- **Database checks** starts Supabase on GitHub's Linux runner, applies and lints
  migrations, runs pgTAP, rewinds/reapplies disposable migrations, checks OAuth
  concurrency and the authenticated Data API, then generates database types and
  typechecks the app against them. It stops the temporary instance afterward.

The workflow needs no repository secrets, production credentials, or separate
hosted Supabase project. The CLI version comes from the lockfile. CI performs no
deployment or hosted migration. Vercel retains its existing build verification;
this workflow alone does not make Vercel wait for the database job.

After publishing the workflow, open its first run under **Actions** and confirm
both jobs are green. In the repository's branch protection/ruleset settings,
require pull requests and the status checks **App checks** and **Database checks**
for `main` if those controls are available for this repository. This prevents
merging failed checks; direct pushes must also be restricted to enforce the gate.

When a migration changes the schema, download **database-types** from the
successful run's **Artifacts** section, extract `database.ts`, and replace
`frontend/src/types/database.ts` with it. Review and commit that file, then let CI
run again. Artifacts are retained for seven days. CI checks against fresh types
but does not commit them or enforce a byte-for-byte match with the saved file.

This uses [GitHub's Node workflow](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)
and [Supabase's CI testing workflow](https://supabase.com/docs/guides/deployment/ci/testing).

## Optional full-stack local setup

Install a Docker-compatible runtime (Docker Desktop with WSL 2 on Windows).
Vercel/Supabase account access is needed when linking hosted projects.

```powershell
npm ci
Copy-Item .env.cloud.example .env.local
npm run db:start
npm run db:status
npm run dev
```

Populate the ignored `.env.local` with local Supabase settings. Never commit
credentials. The first Vercel run may require account/project linking.
The local app normally uses `http://127.0.0.1:3000`; `/api/health` should identify
`orbitos-cloud` and `vercel-function`. `npm run dev:web` runs Vite alone for
fictional UI fixtures; see the root README.

## Optional local database checks

CI runs these checks automatically. Use the database commands below locally only
when reproducing a backend issue with disposable local Supabase running.

```powershell
npm run verify
npm run db:verify
npm run db:rewind:verify
npm run db:test:oauth-concurrency
npm run db:test:todos-http
```

Run checks relevant to the change. `verify` covers server/frontend types,
contract tests, the production build, and a browser secret scan. Embedded
PostgreSQL tests cover migrations and behavior but do not replace local
Supabase/RLS and HTTP checks.

`db:verify` resets the local database, lints it, and runs pgTAP. Rewind/reapply
retains the initial migration; full reset separately verifies recreation.
These commands are disposable-local only, never for hosted data.

The OAuth concurrency suite uses independent sessions in the checked local
`supabase_db_orbitos` container to prove one consume winner, expiry during a
lock wait, and rollback/retry. It verifies container identity and removes only
its generated fixtures. Do not adapt it to a hosted database.

The Todo HTTP suite accepts only the fixed local API/database ports, creates
fictional Auth users, and checks CRUD, ordering, UI persistence, and isolation
through PostgREST before cleaning up its exact fixtures. It retains the normal
1,000-row API limit and verifies complete Today access beyond that limit.
Its test-only password sessions do not verify Google OAuth.

Schema changes belong in `supabase/migrations/`; regenerate types with
`npm run db:types`. Preserve the exact soft-delete timestamp string for Undo:
JavaScript Date conversion loses required precision. See
[Today data protocol](TODAY_DATA_PROTOCOL.md) for pagination and atomic ordering.

## Pre-deployment UI checks

Use `/qa/workspace.html` with the default `realistic` scenario first. Its calendar
uses the production event normalizer and the same page, cache, preload, and
invalidation as the authenticated app. It includes event-specific colors on the
same calendar, three-way overlaps, adjacent 15-minute events, 5–120-minute events,
long/untitled events, multiple all-day lanes, midnight crossings, and hidden and
read-only calendars. `dense` adds a crowded week; `portrait` changes the cover's
aspect ratio; `slow` delays each service call by 1.5 seconds. Other scenarios use
a 180 ms delay. `typical` has no cover; `empty` has no tasks or events.

For calendar/appearance changes, inspect the realistic, dense, portrait, and
no-cover cases at the actual desktop window size and a smaller desktop window.
Check colors, adjacent/overlapping events, visible times and truncation, event
details, cover expand/collapse and crop, navigation away/back, and reload. Use
Customize page to test a chosen local image through the real upload preparation
and crop UI. Calendar changes and appearance persist in isolated session storage
per scenario/day/tab; Reset calendar and cover restores the seed. Tasks and
collections remain in-memory. Classes, notes, and assignments use fictional
services that retain changes across navigation and reset on reload. None of this proves cloud persistence.

Fixture checks are insufficient evidence for data/provider-dependent changes.
Before deploying those changes, also check the normal authenticated app with
the intended account's data and cover using the local full stack. `npm run dev`
starts local Supabase; when intentionally testing the existing hosted account,
run `npx vercel dev` with the matching ignored browser/server configuration and
local `APP_URL`/allowed auth redirects (see Calendar setup). That mode reads and
writes the configured account's actual data. Vite alone does not serve Calendar
API routes. Do not infer provider success from fixtures or a frontend build.
Record which authenticated flows were exercised; if unavailable, state that
they remain unverified before release. Recurring-series writes intentionally
report unsupported in QA rather than pretending to verify Google's behavior.

## Live releases

Class assignments require `20260913000200_class_assignments.sql` before releasing
the UI. It adds account-owned rows under RLS without modifying existing data.
Task aggregation additionally requires
`20260914000100_assignment_todos.sql` coordinated with the matching UI. Assignments
then share `todos` with Tasks and Home; the legacy table remains a read-only backup.
Do not deploy the new Classes adapter before that migration. Follow
[TASK_AGGREGATION_RELEASE.md](TASK_AGGREGATION_RELEASE.md) for backup, validation,
and release sequencing. Classes and notes additionally require
`20260913000300_classes_and_notes.sql` and
`20260913000400_class_pdf_storage.sql`. The first preserves existing assignments
and recovers parent classes before enforcing account/class foreign keys. The
second creates private PDF storage. Device uploads are permanent, with a 50 MiB
limit and recoverable pending records; Drive notes store file references.
Browser class data is imported without overwriting established cloud names and
is retained unchanged as a recovery copy. See [Classes data model](CLASSES_DATA_MODEL.md).
The QA fixture uses fictional services; changes survive navigation but reset on
reload and cannot prove database or file persistence.


Home page names and optional covers use the account-owned `home_appearance`
table. Apply `20260907000100_home_appearance.sql` and
`20260908000100_home_cover_position.sql` before releasing that UI.
Uploads are resized in the browser; only a bounded image (at most 350 KB encoded)
is saved with the title and crop coordinates under RLS. Expanding the cover
reveals the complete resized image. No public image bucket is used. The workspace
fixture keeps these preferences in isolated tab storage, so reload checks cover
the UI but cannot prove Supabase persistence.

| Environment | Database | Configuration |
|---|---|---|
| Development | Local Supabase | Ignored `.env.local` |
| Vercel Production | `oidvvenjamgcezdptfjr` | Vercel Production variables |

The live app is `https://orbitos-virid.vercel.app`, linked to `tobygodat/tobiOS`.
There is no required Preview environment. A main push may deploy immediately;
apply required forward migrations before publishing dependent code. Inspect
current hosted data and migration history, and preserve a backup/export when
data exists. Never infer an empty database from a historical smoke test.

Frontend Supabase configuration is embedded at build time. Only browser-safe
`VITE_` values belong in the browser; privileged Supabase and Google credentials
stay server-only. Redeploy after environment changes. Optional Preview builds
should not receive live credentials by default. Verify changed flows on the
live app after a release, including reload persistence and recovery from errors.
See [Calendar](CALENDAR.md) for OAuth setup and credential troubleshooting.

## Authentication and legacy recovery

Cloud startup restores the Supabase session before mounting protected routes.
Google app sign-in uses PKCE and identity-only scopes; Calendar consent is
separate. Auth storage strips Google provider-token fields while preserving
Supabase's own session tokens. Sign-out uses local scope and clears app caches
and drafts; a failed sign-out keeps the workspace available.

The preserved legacy runtime uses `uv run python -m orbitos.main` with
`npm run dev:legacy-web`. Cloud is the frontend default; the legacy command
explicitly enables its FastAPI proxy. Do not remove legacy source, data, or
recovery files without an explicit request. Backup location is in the root README.
