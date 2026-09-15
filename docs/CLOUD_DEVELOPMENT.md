# Cloud development

Use the root Node workspace: React/Vite, Vercel Functions, and Supabase.
Routine frontend development needs Node.js 22 (`.nvmrc`). GitHub Actions runs
database checks in a disposable Supabase instance on its own runner. Local Docker
is optional for full-stack debugging; the deployed app never depends on it.

## Daily development without Docker

```bash
npm ci
npm run dev:web
```

Open `http://localhost:5173/qa/workspace.html` to check fictional UI flows; see
[QA fixtures](QA_FIXTURES.md) for scenarios, parameters, and their limits.
Run `npm run verify` locally for types, lint and formatting, unit/contract tests,
build, and the browser secret scan. Open a pull request to run the complete CI
suite.

## Test suites

There are two Vitest configurations.

| Config | Command | Includes | Runs |
| --- | --- | --- | --- |
| `vitest.config.ts` | `npm test`, and inside `npm run verify` | `tests/contract/**` and `frontend/src/**/*.test.{ts,tsx}` | Every local run and the CI **App checks** job. Needs no Docker; DOM files opt in with `// @vitest-environment happy-dom`. |
| `vitest.local.config.ts` | `npx vitest run --config vitest.local.config.ts` | `tests/local/**` and `frontend/tests/local/**` | Manually, with local Supabase running. Files run serially with long timeouts. Not run in CI, not part of `verify`. |

pgTAP (`npm run db:test`) and the two script suites below are separate again and
belong to the **Database checks** job. Test placement rules are in
[conventions](CONVENTIONS.md).

## Environment variables

`.env.cloud.example` is the template for the cloud runtime; copy it to the
ignored `.env.local`. `.env.legacy.example` is only for recovering the
transitional Python runtime. Never commit a populated environment file.

Validation for the first group lives in `server/env/cloud.ts`; the browser
repeats the same two checks in `frontend/src/config/browserEnv.ts`. CI needs
none of these: its database job runs against a disposable instance and the
workflow holds no secrets.

| Variable | Local dev | Vercel | Browser-safe | Validation |
| --- | --- | --- | --- | --- |
| `VITE_ORBITOS_RUNTIME` | set by `npm run dev:web` | optional | yes | `cloud` or `legacy`; anything else throws (`frontend/src/config/runtime.ts`). Defaults to `cloud`. |
| `VITE_SUPABASE_URL` | required | required | yes | HTTPS origin, or a loopback HTTP origin. Must equal `SUPABASE_URL`. |
| `VITE_SUPABASE_ANON_KEY` | required | required | yes | Browser-safe Supabase publishable key. Must equal `SUPABASE_ANON_KEY` and differ from the service-role key. |
| `SUPABASE_URL` | required | required | no | Same origin rule; must match `VITE_SUPABASE_URL`. |
| `SUPABASE_ANON_KEY` | required | required | no | Same key rule; must match `VITE_SUPABASE_ANON_KEY`. |
| `SUPABASE_SERVICE_ROLE_KEY` | required for `/api` | required | **no, server only** | Non-empty, and distinct from the public key. |
| `APP_URL` | required for `/api` | required | no | HTTPS origin, or a loopback HTTP origin. The canonical origin for OAuth redirects. |
| `GOOGLE_CLIENT_ID` | Calendar/Drive only | required for Calendar/Drive | no | Non-empty. Validated as a group: leave all three blank to run without Google. |
| `GOOGLE_CLIENT_SECRET` | Calendar/Drive only | required for Calendar/Drive | **no, server only** | Non-empty. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Calendar/Drive only | required for Calendar/Drive | **no, server only** | Canonical padded standard Base64 of exactly 32 random bytes. Keep it in a secret store. |
| `GOOGLE_PICKER_API_KEY` | Drive Picker only | required for the Picker | server-held, released to the browser by `/api/drive/picker` | Not schema-validated. Restrict the key to the Picker API and the site referrers. |
| `GOOGLE_PICKER_APP_ID` | Drive Picker only | required for the Picker | same | Not schema-validated. The Google Cloud project number. |

`/api/health` reports whether the application group and the Google group are
configured. It is unauthenticated and deliberately does not name variables;
read those from the deployment logs.

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
deployment or hosted migration. Vercel's build runs `npm run build && npm run
check:bundle` only, because CI already gates on the full `verify`; this workflow
alone does not make Vercel wait for the database job.

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

```bash
npm ci
cp .env.cloud.example .env.local
npm run db:start
npm run db:status
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.cloud.example .env.local` for the
copy; the rest is identical.

Populate the ignored `.env.local` with local Supabase settings. Never commit
credentials. The first Vercel run may require account/project linking.
The local app normally uses `http://127.0.0.1:3000`; `/api/health` should identify
`orbitos-cloud` and `vercel-function`. `npm run dev:web` runs Vite alone for
fictional UI fixtures; see the root README.

## Lint, format, and unused code

| Command | What it does |
| --- | --- |
| `npm run lint` | `eslint .` then `prettier --check .`; part of `npm run verify`. |
| `npm run format` | Rewrites the tree with Prettier. |
| `npm run knip` | Reports unused files, exports, types, and dependencies. |

Configuration lives in `eslint.config.js`, `.prettierrc`/`.prettierignore`, and
`knip.json`. `knip` is not in `verify` because a new export is often added a
commit before its caller; run it before opening a pull request.

## Optional local database checks

CI runs these checks automatically. Use the database commands below locally only
when reproducing a backend issue with disposable local Supabase running.

```bash
npm run verify
npm run db:verify
npm run db:rewind:verify
npm run db:test:oauth-concurrency
npm run db:test:todos-http
```

Run checks relevant to the change. `verify` covers server/frontend types, ESLint
and Prettier, contract tests, the production build, and a browser secret scan. Embedded
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
`npm run db:types`. Hosted changes are forward-only
([ADR 0003](adr/0003-forward-only-hosted-migrations.md)); the tables and
ownership rules are described in
[workspace data model](WORKSPACE_DATA_MODEL.md).

Preserve the exact soft-delete timestamp string for Undo: JavaScript `Date`
conversion loses required precision. See
[Today data protocol](TODAY_DATA_PROTOCOL.md) for pagination and atomic
ordering.

## Pre-deployment UI checks

Start at `/qa/workspace.html` with the default `realistic` scenario. Scenarios,
the `route`, `scenario`, and `drive` parameters, what persists across reload,
and which fixture service stands in for which real service are documented in
[QA fixtures](QA_FIXTURES.md).

For calendar and appearance changes, inspect the `realistic`, `dense`,
`portrait`, and no-cover (`typical`) cases at the actual desktop window size and
at a smaller desktop window. Check colors, adjacent and overlapping events,
visible times and truncation, event details, cover expand/collapse and crop,
navigation away and back, and reload. Use Customize page to run a chosen local
image through the real upload preparation and crop UI.

Fixture checks are insufficient evidence for data-dependent or
provider-dependent changes. Before deploying those, also check the normal
authenticated app with the intended account's data and cover using the local
full stack. `npm run dev` starts local Supabase; when intentionally testing the
existing hosted account, run `npx vercel dev` with the matching ignored
browser/server configuration and local `APP_URL` and allowed auth redirects (see
Calendar setup). That mode reads and writes the configured account's actual
data. Vite alone does not serve Calendar API routes. Do not infer provider
success from fixtures or a frontend build. Record which authenticated flows were
exercised; if unavailable, state that they remain unverified before release.
Recurring-series writes intentionally report unsupported in QA rather than
pretending to verify Google's behavior.

## Live releases

Class assignments require `20260913000200_class_assignments.sql` before releasing
the UI. It adds account-owned rows under RLS without modifying existing data.
Assignments save independently of Tasks; names, date-only due dates, types,
completion, and Undo persist. Classes and notes additionally require
`20260913000300_classes_and_notes.sql` and
`20260913000400_class_pdf_storage.sql`. The first preserves existing assignments
and recovers parent classes before enforcing account/class foreign keys. The
second creates private PDF storage. Device uploads are permanent, with a 50 MiB
limit and recoverable pending records; Drive notes store file references.
Browser class data is imported without overwriting established cloud names and
is retained unchanged as a recovery copy. See [Classes data model](CLASSES_DATA_MODEL.md).

Owner delete policies for classes, notes, assignments, and the private PDF
objects arrive in `20260914000100_class_deletes.sql`; apply it before releasing
any delete affordance (in progress).


Home page names and optional covers use the account-owned `home_appearance`
table. Apply `20260907000100_home_appearance.sql` and
`20260908000100_home_cover_position.sql` before releasing that UI.
Uploads are resized in the browser; only a bounded image (at most 350 KB encoded)
is saved with the title and crop coordinates under RLS. Expanding the cover
reveals the complete resized image. No public image bucket is used.

| Environment | Database | Configuration |
|---|---|---|
| Development | Local Supabase | Ignored `.env.local` |
| Vercel Production | `oidvvenjamgcezdptfjr` | Vercel Production variables |

The live app is `https://orbitos-virid.vercel.app`, linked to `tobygodat/tobiOS`.
There is no required Preview environment. A main push may deploy immediately;
apply required forward migrations before publishing dependent code. Inspect
current hosted data and migration history, and preserve a backup/export when
data exists. Never infer an empty database from a historical smoke test.

This release adds two forward migrations. Apply them, in order, before the code
that depends on them:

1. `20260914000100_class_deletes.sql` — owner-scoped delete policies for classes,
   assignments, notes, and their private PDF objects.
2. `20260914000200_google_access_token_cache.sql` — encrypted access-token cache
   columns, the `service_role` column grant on `public.profiles`, and the
   eight-argument `save_calendar_credentials` / `save_drive_credentials`
   overloads. See [Calendar](CALENDAR.md) and [Drive](DRIVE.md).

Both change the schema, so `frontend/src/types/database.ts` must be regenerated:
`npm run db:types` needs a local Supabase instance, which this checkout does not
run, so take the types from CI's **database-types** artifact as described above.

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
`npm run dev:legacy-web` and its own `.env.legacy.example` template. Its
commands are unverified since 2026-09 and are not covered by CI. Cloud is the frontend default; the legacy command
explicitly enables its FastAPI proxy. Do not remove legacy source, data, or
recovery files without an explicit request. Backup location is in the root README.
