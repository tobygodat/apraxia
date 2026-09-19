# Cloud development

Use the root Node workspace: React/Vite, Vercel Functions, and Supabase.
Routine frontend development needs Node.js 22 (`.nvmrc`). GitHub Actions runs
database checks in a disposable Supabase instance on its own runner. Local Docker
is optional for full-stack debugging; the deployed app never depends on it.

## Daily development without Docker

```bash
npm ci # New worktree or changed lockfile only.
npm run dev:web
```

Open `http://localhost:5173/qa/workspace.html` to check fictional UI flows; see
[QA fixtures](QA_FIXTURES.md) for scenarios, parameters, and their limits.
Keep the dev server and focused test watcher running through revisions. Follow
the [local feedback loop](#fast-local-feedback); CI runs full app verification.

## Test suites

There are two Vitest configurations.

| Config | Command | Includes | Runs |
| --- | --- | --- | --- |
| `vitest.config.ts` | `npm test`, and inside `npm run verify` | `tests/contract/**` and `frontend/src/**/*.test.{ts,tsx}` | Every local run; in CI, split across the **Contract tests** and **Frontend tests** jobs. Needs no Docker; DOM files opt in with `// @vitest-environment happy-dom`. |
| `vitest.local.config.ts` | `npm run db:test:todos-http`, or `npx vitest run --config vitest.local.config.ts` | `tests/local/**` and `frontend/tests/local/**` | Needs local Supabase running; files run serially with long timeouts. Not part of `npm test` or `verify`, but `verify:db` runs it, so the **Database checks** job does too. |

pgTAP (`npm run db:test`) and the script suites below also belong to the
**Database checks** job. Test placement rules are in
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
| `VITE_APRAXIA_RUNTIME` | set by `npm run dev:web` | optional | yes | `cloud` or `legacy`; anything else throws (`frontend/src/config/runtime.ts`). Defaults to `cloud`. |
| `VITE_SUPABASE_URL` | required | required | yes | HTTPS origin, or a loopback HTTP origin. Must equal `SUPABASE_URL`. |
| `VITE_SUPABASE_ANON_KEY` | required | required | yes | Browser-safe Supabase publishable key. Must equal `SUPABASE_ANON_KEY` and differ from the service-role key. |
| `SUPABASE_URL` | required | required | no | Same origin rule; must match `VITE_SUPABASE_URL`. |
| `SUPABASE_ANON_KEY` | required | required | no | Same key rule; must match `VITE_SUPABASE_ANON_KEY`. |
| `SUPABASE_SERVICE_ROLE_KEY` | required for `/api` | required | **no, server only** | Non-empty, and distinct from the public key. |
| `APP_URL` | required for `/api` | required | no | HTTPS origin, or a loopback HTTP origin. The canonical origin for OAuth redirects. |
| `GOOGLE_CLIENT_ID` | Calendar/Drive only | required for Calendar/Drive | no | Non-empty. Validated as a group: leave all three blank to run without Google. |
| `GOOGLE_CLIENT_SECRET` | Calendar/Drive only | required for Calendar/Drive | **no, server only** | Non-empty. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Calendar/Drive only | required for Calendar/Drive | **no, server only** | Canonical padded standard Base64 of exactly 32 random bytes. Keep it in a secret store. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION` | Calendar/Drive only | optional (defaults to 1) | **no, server only** | The version stamped into new envelopes. Raise it by one per key rotation. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS` | Calendar/Drive only | optional | **no, server only** | The key one version below the current one, set only while a rotation is in progress. See the rotation procedure in [calendar](CALENDAR.md#rotating-the-token-encryption-key). |
| `GOOGLE_PICKER_API_KEY` | Drive Picker only | required for the Picker | server-held, released to the browser by `/api/drive/picker` | Not schema-validated. Restrict the key to the Picker API and the site referrers. |
| `GOOGLE_PICKER_APP_ID` | Drive Picker only | required for the Picker | same | Not schema-validated. The Google Cloud project number. |

`/api/health` reports whether the application group and the Google group are
configured. It is unauthenticated and deliberately does not name variables;
read those from the deployment logs.

## Fast local feedback

Install dependencies once with `npm ci`; repeat when the lockfile changes.
Confirm an existing dev server belongs to this checkout, and use a free port for
independent work. The change-to-check table in
[AGENTS.md](../AGENTS.md#verification) defines the local iteration scope.

Choose the command for the current phase; these examples are alternatives, not
a sequence.

```powershell
# Keep the relevant tests running while editing (omit the path for all tests).
npm run test:watch -- frontend/src/path/to/example.test.ts
# One-shot tests that import a changed source file, directly or indirectly.
npm run test:related -- frontend/src/path/to/source.ts
# Typecheck only the affected side while editing.
npm run typecheck --workspace=frontend
npm run typecheck:server
# Format only explicit changed files; replace these example paths.
npm run format -- frontend/src/path/to/source.ts
# One pre-push check: types, lint, formatting, and all unit/contract tests.
npm run verify:quick
# Full app verification for dependencies/build/CI changes, or to reproduce CI.
npm run verify
```

Replace example paths with real files. Related tests use Vitest's import graph;
they do not replace full checks for configuration, migrations, dynamic imports,
or broad refactors. A specific failure can also be rerun with
`npm test -- path/to/failing.test.ts` or `npm run typecheck`.

### One local check, then CI

[AGENTS.md](../AGENTS.md#verification) sets the rule: one `verify:quick` before
pushing code, by hand or through the hook, never both. What follows is what that
leaves to CI.

`verify` is `verify:quick` plus the build and the bundle scan. When a change
needs full app checks and the pre-push hook is enabled, run `npm run build` and
`npm run check:bundle` yourself and let the push supply `verify:quick`, instead
of running the shared part twice. Documentation-only work needs a consistency
check and `git diff --check`.

A local pass is early feedback, not the gate. Any edit to source, dependencies,
environment, or build configuration invalidates it, and it says nothing about the
authenticated checks a data or provider change needs. **App checks** and
**Database checks** on the released commit are what count, and CI's full `verify`
is sufficient app verification for it, so do not repeat that identical suite
locally just for a release.

Enable the optional pre-push gate once per clone, provided you do not
already have a custom hooks path:

```powershell
git config --local core.hooksPath .githooks
```

For a linked worktree with `extensions.worktreeConfig` already enabled, use
`git config --worktree core.hooksPath .githooks` to enable it only there.

The hook runs `verify:quick` and rejects the push on failure. It installs no
dependencies and starts no Docker. Both `verify:quick` and `verify` limit Vitest
to four workers, because more workers contend on machines with many logical CPUs
and produce timing failures. A focused `test:watch` remains the edit loop.

Integrate an existing custom hook rather than replacing it. The hook can be
bypassed and it never exercises the deployed app, so CI remains the release gate.

For changes affecting database/auth/data contracts (including refactors of them),
or to reproduce a database CI failure, use disposable local Supabase and run:

```powershell
npm run verify:db
```

This is the same complete database command used in GitHub Actions: start/reuse
Supabase, reset and test, rewind/reapply, OAuth concurrency, authenticated Data
API, generate types, and typecheck. It resets **disposable local data**, never
hosted data. It rewrites `frontend/src/types/database.ts`; review the result and
commit it when the schema changed. Keep Supabase running between attempts;
`npm run db:stop` stops it when finished. All worktrees share this project's
local container/ports: run database checks from only one checkout at a time.

After a failure, rerun the failing subcommand while you fix it, then finish the
remaining required checks. Reinstalling with `npm ci`, restarting Docker, and
pushing to find out whether a fix worked all cost more than reading the error.
If a check cannot run here at all — a container without Docker runs none of
`verify:db`, `db:test`, or `db:types` — name the missing prerequisite or the
CI-only difference instead of substituting a check that proves something else.

## Windows Git path support

Agent checkpoint refs can exceed Windows' traditional path limit even when the
worktree path is short, because their files live under the shared repository's
`.git`; broken refs with intact tree objects are the symptom. Enable long paths
once per Windows clone with `git config --local core.longpaths true`, which linked
worktrees inherit, and verify the repair with `git fetch origin` and `git fsck
--full --no-reflogs --no-dangling` before deleting any ref.

## GitHub Actions

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual
dispatch from the repository's **Actions → CI → Run workflow** page.

- **App checks** is a status that aggregates three parallel jobs on Node.js 22,
  so the slowest one no longer waits behind the others: **Lint and types**
  (`npm run verify:static`, i.e. typecheck, lint, build, and the bundle check),
  **Contract tests** (`tests/contract/**`, the PGlite suites), and **Frontend
  tests** (`frontend/src/**`). Together they cover exactly what `npm run verify`
  covers locally. **App checks** fails if any of the three fails, so it stays
  the only app status branch protection needs to require.
- **Database checks** runs `npm run verify:db` on GitHub's Linux runner, applies and lints
  migrations, runs pgTAP, rewinds/reapplies disposable migrations, checks OAuth
  concurrency and the authenticated Data API, then generates database types and
  typechecks the app against them. It stops the temporary instance afterward.

The **Database checks** job always reports a status. Its scope step skips database
execution only when every changed path is root `AGENTS.md`, `README.md`,
`PRODUCT.md`, or `DESIGN.md`, a Markdown file under `docs/`, or CSS under
`frontend/src/`. It records the decision in the run summary. Everything else,
including mixed changes, dependencies, CI/configuration, data/auth code, and
unknown paths, runs the full suite. Manual dispatch always runs the suite.

`scripts/ci-database-scope.mjs` compares the PR merge base to the checked-out
commit, or the complete before/after range for a push. Both paths of a rename
count. Missing history, invalid event data, and empty diffs fall back to the full
suite. Checkout fetches full history for this comparison. A docs/style skip
does not install dependencies, start Supabase, or generate database types.

The workflow needs no repository secrets, production credentials, or separate
hosted Supabase project. The CLI version comes from the lockfile. CI performs no
deployment or hosted migration. Vercel's build runs `npm run build && npm run
check:bundle` only, because CI already gates on the full `verify`; this workflow
alone does not make Vercel wait for the database job.

When a migration changes the schema, `npm run verify:db` generates the updated
`frontend/src/types/database.ts` locally. Review and commit it with the change.
If local generation is unavailable, download **database-types** from the
successful run's **Artifacts** section and use its `database.ts` instead.
Artifacts are retained for seven days. CI checks against fresh types
but does not commit them or enforce a byte-for-byte match with the saved file.

This uses [GitHub's Node workflow](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)
and [Supabase's CI testing workflow](https://supabase.com/docs/guides/deployment/ci/testing).

## Optional full-stack local setup

Install a Docker-compatible runtime. This Windows machine uses Docker Desktop's
Docker VMM backend with the startup workaround below.
Vercel/Supabase account access is needed when linking hosted projects.

Use Docker only for work requiring containers. Check `docker info` and reuse a
running engine. On this Windows machine, follow the helper procedure below.
On other machines, run `docker desktop start` once and wait for
`docker info` to succeed; a startup timeout alone does not mean startup failed.
Inspect logs before retrying. Do not force-kill Docker, shut down WSL, restart
Docker as routine cleanup, or automatically reset/delete its data.

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
`apraxia-cloud` and `vercel-function`. `npm run dev:web` runs Vite alone for
fictional UI fixtures; see the root README.

### Agent-managed Docker startup on this Windows machine

Agents are responsible for starting Docker and handling stale sockets. Do not
delegate these steps to the user. Docker remains optional for frontend work.

Before `npm run db:start`, `npm run dev`, or local database checks:

1. Check whether the Docker engine responds to `docker info`. Reuse a healthy
   running engine; do not restart it or rename active sockets unnecessarily.
2. If Docker needs to start, verify that `com.docker.backend` and
   `com.docker.sailor` have exited. If a restart is needed, stop Docker with
   `docker desktop stop`; use `docker desktop stop --force` only if shutdown is
   stuck, and verify process exit before proceeding. Account for any unrelated
   running containers before stopping the engine.
3. Run the existing helper, which preserves known stale socket files by renaming
   them before launching Docker:

   ```powershell
   & "$env:USERPROFILE\docker-migration\Start-DockerVmm.ps1"
   ```

4. Verify `docker info`, then run the required project command. After starting
   Supabase, check container health and database readiness.

Use the helper for each start after shutdown, including agent-initiated restarts,
rather than calling `docker desktop start` directly or launching the GUI. If the
helper is missing or rejects the runtime layout, inspect the local recovery notes
at `$env:USERPROFILE\docker-migration\VMM-DIAGNOSIS.md` and report the specific
blocker; do not bypass its checks or ask the user to perform routine cleanup.

The active runtime is under `$env:USERPROFILE\docker-runtime`, reached through
directory junctions at Docker's original paths. Preserve those junctions, VHDX
files, volumes, exports, and backup directories. Stale-socket handling is not
permission to prune Docker data, reset Docker, or delete the runtime directory.
This workaround is specific to this machine; it is not a CI or other-host setup
requirement.

## Lint, format, and unused code

| Command | What it does |
| --- | --- |
| `npm run lint` | `eslint .` then `prettier --check .`; part of `npm run verify`. |
| `npm run format -- <file> [<file> ...]` | Formats only the supplied files with Prettier. |
| `npm run knip` | Reports unused files, exports, types, and dependencies. |

Configuration lives in `eslint.config.js`, `.prettierrc`/`.prettierignore`, and
`knip.json`. `knip` is not in `verify` because a new export is often added a
commit before its caller; run it for export/dependency cleanup or an unused-code
concern, rather than every unrelated pull request.

## Focused local database checks

CI runs these checks automatically through `npm run verify:db`. Use the individual
commands below to iterate on a failure with disposable local Supabase running.

```bash
npm run db:verify
npm run db:rewind:verify
npm run db:test:oauth-concurrency
npm run db:test:todos-http
```

Run checks relevant to the change. Embedded PostgreSQL tests cover migrations
and behavior but do not replace local Supabase/RLS and HTTP checks.

`db:verify` resets the local database, lints it, and runs pgTAP. Rewind/reapply
retains the initial migration; full reset separately verifies recreation.
These commands are disposable-local only, never for hosted data.

The OAuth concurrency suite uses independent sessions in the checked local
`supabase_db_apraxia` container to prove one consume winner, expiry during a
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

Start at `/qa/workspace.html?scenario=personal`, then repeat the affected flow in
`dense`. `personal` shows how the change looks on the account it is for; `dense`
tries to break it. Without a snapshot (`npm run qa:snapshot`), `personal` falls
back to the fictional `realistic` seed, which is also the default. Scenarios,
the `route`, `scenario`, and `drive` parameters, what persists across reload,
and which fixture service stands in for which real service are documented in
[QA fixtures](QA_FIXTURES.md).

Beyond `personal` and `dense`, add scenarios according to what changed:

| Changed behavior | Additional checks |
| --- | --- |
| Calendar geometry, overlap, density, or truncation | Relevant long/adjacent/overlapping events and visible times in `dense`. |
| Responsive/shared layout | Actual desktop and a smaller viewport; the relevant scenario matrix once when the change is complete. |
| Persistence, initialization, or navigation | Navigate away/back and reload; use the real app for account persistence. |
| Upload preparation or crop controls | Run an image through the actual upload/crop flow. |

Do not repeat unaffected scenarios for every copy or isolated styling revision.

Fixture checks are insufficient evidence for data-dependent or
provider-dependent changes. Before deploying those, also check the normal
authenticated app with the intended account's data using the local
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

Hosted schema changes are forward-only
([ADR 0003](adr/0003-forward-only-hosted-migrations.md)), and a migration goes in
before the code that depends on it, never the other way round. [Classes data
model](CLASSES_DATA_MODEL.md) and [workspace data model](WORKSPACE_DATA_MODEL.md)
describe what each migration guarantees, and
[TASK_AGGREGATION_RELEASE.md](history/TASK_AGGREGATION_RELEASE.md) records how the
one coordinated migration-and-UI release was sequenced.

| Environment | Database | Configuration |
|---|---|---|
| Development | Local Supabase | Ignored `.env.local` |
| Vercel Production | `oidvvenjamgcezdptfjr` | Vercel Production variables |

The live app is `https://apraxia.dev`, linked to `tobygodat/apraxia`.
Server variables were renamed from `ORBITOS_*` to `APRAXIA_*` with the app
rename (`APRAXIA_AGENT_USER_ID`, `APRAXIA_AGENT_SCOPES`, `VITE_APRAXIA_RUNTIME`,
`APRAXIA_CLOUD_DEV`). The agent token stays stored as `ORBITOS_AGENT_TOKEN` in
Vercel Production because sensitive variables cannot be renamed; the server
accepts `APRAXIA_AGENT_TOKEN` or that name. `APP_URL` must be
`https://apraxia.dev`, and Google OAuth redirect URIs plus the Supabase Site URL
must match it, or Calendar and Drive connections fail.

There is no required Preview environment, and a main push may deploy immediately.
Before applying a migration, inspect current hosted data and migration history and
preserve a backup or export when data exists; never infer an empty database from a
historical smoke test. A schema change also means regenerating
`frontend/src/types/database.ts`, with `npm run db:types` against local Supabase or
from CI's **database-types** artifact as described above.

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

## Personal agent API

Its server-only variables are `APRAXIA_AGENT_TOKEN`, `APRAXIA_AGENT_USER_ID`, and
`APRAXIA_AGENT_SCOPES`, with placeholders in `.env.cloud.example`. Token changes
require a redeployment, and the token never belongs in a browser variable.
[Agent API](AGENT_API.md) has the endpoints, permissions, and retry rules.
