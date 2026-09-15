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

## Fast local feedback

Install dependencies once with `npm ci`; repeat when the lockfile changes.
Reuse the task's worktree, dev server, browser session, and test watcher. Confirm
an existing server belongs to this checkout; use a free port for independent work.
For a small change, inspect the relevant code, implement, verify, and finish.
Use a plan when uncertainty or scope warrants it, and read supporting docs only
when relevant. The change-to-check table in [AGENTS.md](../AGENTS.md#verification)
defines the local iteration scope.

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

For code changes, run `verify:quick` once before pushing, or let the optional
pre-push hook run it. Do not manually run it immediately before a hooked push.
A successful `verify` includes those checks; it also builds and scans the bundle.
When full app checks are needed and the hook is enabled, run `npm run build`
and `npm run check:bundle`, then let the push supply `verify:quick`; together
these perform the full app checks without repeating the quick suite.
Documentation-only work needs consistency and diff checks locally; the optional
hook remains a full check on every push if enabled.

Require successful **App checks** and **Database checks** for the commit being
released. CI's full `verify` is sufficient app verification for that commit;
do not also run the identical full suite locally solely for release. Changes
to source, dependencies, environment, or build configuration invalidate relevant
earlier results. Test environment-specific concerns with the intended configuration,
and check the deployed flow after release. A passing local check does not replace
the required CI statuses or authenticated checks for data/provider changes.

Enable the optional pre-push gate once per clone, provided you do not
already have a custom hooks path:

```powershell
git config --local core.hooksPath .githooks
```

For a linked worktree with `extensions.worktreeConfig` already enabled, use
`git config --worktree core.hooksPath .githooks` to enable it only there.

The hook runs `verify:quick` and rejects the push on failure. Both `verify:quick`
and `verify` limit Vitest to four workers to reduce contention and timing failures
on machines with many logical CPUs. A focused `test:watch` remains the edit loop.
It does not install
dependencies or start Docker. Preserve/integrate existing custom hooks instead
of replacing them. Local hooks provide early feedback; CI remains the release
gate. They can be bypassed and do not prove the final deployed app works.

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

After a failure, rerun the failing subcommand while fixing it, then complete any
remaining required checks. Once they pass, broaden or repeat only for changed
inputs, failures, or unresolved concerns. Do not repeat `npm ci`, start/stop
Docker, or push just to discover whether a local fix worked. If a check cannot
run locally, report the missing prerequisite or CI-only difference explicitly.

## Using Codex and GPT-6 Astra

Official guidance reviewed on 2026-09-15. The validation table and CI allowlist
are orbitOS policy choices applying that guidance; OpenAI does not prescribe
these particular commands or file filters.

- Give Codex the goal, relevant files/errors, constraints, and an observable
  completion condition. For example: "Fix the calendar label in the existing
  component. Done when it fits at both affected widths and the relevant checks
  pass." Use Plan mode for difficult or ambiguous work, and review the final diff.
- Match reasoning effort to the task and compare results: Low for narrow changes,
  Medium/High for harder work or debugging, and Extra High for demanding extended
  tasks. More reasoning is not a universal speed improvement. These are task
  choices, not an instruction to change everyone's saved model settings.

Source: [OpenAI's Codex best practices](https://learn.chatgpt.com/guides/best-practices).

- Periodically audit overlapping skills and stale instructions. Keep skill
  descriptions specific, and load supporting material only when its workflow
  applies. The available catalog currently exposes both `impeccable` and
  `impeccable:impeccable`; inspect whether both are needed before changing global
  installations. This repository change does not manage installed plugins.
- Keep repository instructions focused on consequential constraints and where to
  find relevant context. Define completion so Astra continues through verification
  and fixes rather than stopping at the first implementation. Keep routine local
  fixture checks authorized without repeated permission requests.

Source: [OpenAI Developers: Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).

- Astra responds strongly to instruction boundaries. Preserve explicit user scope,
  explain the exact skill instruction if it blocks work, and calibrate tests to
  the change. Set delegation expectations explicitly when requesting parallel
  agent work; this workflow does not require subagents for routine edits.

Source: [Official Astra prompting guidance](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices).

## Windows Git path support

Codex checkpoint refs can exceed Windows' traditional path limit even when the
worktree path is short: their files live under the shared repository's `.git`.
For this checkout, 269-character paths appeared as broken refs while their tree
objects were intact. `git -c core.longpaths=true fsck --full --no-reflogs
--no-dangling` and fetch both succeeded with long-path support enabled.

Enable it once per Windows clone with `git config --local core.longpaths true`;
linked worktrees inherit this repository setting. If this error recurs, inspect
the ref and object and test long-path support before deleting checkpoint refs.
Verify the repair with normal `git fetch origin` and `git fsck --full
--no-reflogs --no-dangling`. This does not require changing GitHub settings.

## GitHub Actions

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual
dispatch from the repository's **Actions → CI → Run workflow** page (once the
workflow exists on the default branch).

- **App checks** runs `npm ci` and `npm run verify` on Node.js 22.
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

After publishing the workflow, open its first run under **Actions** and confirm
both jobs are green. In the repository's branch protection/ruleset settings,
require pull requests and the status checks **App checks** and **Database checks**
for `main` if those controls are available for this repository. This prevents
merging failed checks; direct pushes must also be restricted to enforce the gate.

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
`orbitos-cloud` and `vercel-function`. `npm run dev:web` runs Vite alone for
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

Inspect the affected flow in `realistic`. Add scenarios according to what changed:

| Changed behavior | Additional checks |
| --- | --- |
| Calendar geometry, overlap, density, or truncation | `dense`; relevant long/adjacent/overlapping events and visible times. |
| Cover or surrounding layout | `portrait` and no-cover `typical`; expand/collapse where affected. |
| Responsive/shared layout | Actual desktop and a smaller viewport; the relevant scenario matrix once when the change is complete. |
| Persistence, initialization, or navigation | Navigate away/back and reload; use the real app for account persistence. |
| Upload preparation or crop controls | Run an image through the actual upload/crop flow. |

Do not repeat unaffected scenarios for every copy or isolated styling revision.

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

Owner delete policies for classes, notes, and the private PDF objects arrive in
`20260914000300_class_deletes.sql`; apply it after the aggregation migration and
before releasing any delete affordance. Assignments are todos, so they are
removed through the soft-delete RPC with Undo; the legacy `class_assignments`
backup gains no delete grant.


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

This release adds two forward migrations after the already-applied
`20260914000100_assignment_todos.sql`. Apply them, in order, before the code
that depends on them:

1. `20260914000300_class_deletes.sql` — owner-scoped delete policies for classes,
   notes, and their private PDF objects, plus Storage hash verification and the
   abandoned-upload reaper.
2. `20260914000400_google_access_token_cache.sql` — encrypted access-token cache
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
