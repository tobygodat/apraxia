# AGENTS.md

The working agreement for coding agents in this repository. `CLAUDE.md` imports
this file rather than restating it, so there is one copy of every rule.

Each rule below carries its reason. A rule you understand transfers to the case
it does not literally cover; a bare prohibition does not.

## Working style

- Reuse what the task already has running: the worktree, the dev server, the
  browser, the focused test watcher. A second dev server costs a port and a
  minute and tells you nothing the first one would not.
- Read the docs the change touches. The `docs/` tree is reference material, not
  required reading.
- Run `npm ci` for a new worktree or a changed lockfile, and not otherwise.
- Format the paths you changed, never the repository: a repository-wide format
  buries a scoped change in noise.
- Deliver the change the task asks for. A pre-existing bug, a nearby cleanup, or
  a file the task did not require is a follow-up to report at the end, not a
  change to make now, unless the requested behavior cannot work without it.

## Repository constraints

- Development is local and release goes to the existing personal app at
  `apraxia.dev`: one Cloudflare Worker serving the frontend and the `api/`
  handlers, backed by hosted Supabase. There is no Preview environment and no
  launch process to satisfy, so a change is finished when it works locally and
  passes CI.
- Merging does not deploy: the Worker is not connected to Git. A release is
  `npm run build` with the two `VITE_SUPABASE_*` values set, then
  `npm run deploy:worker`, from Toby's checkout
  ([cloud development](docs/CLOUD_DEVELOPMENT.md#cloudflare-worker)).
- Server code runs in the Workers runtime (workerd with `nodejs_compat`), not
  Node. Node and Vitest accept options workerd rejects, such as fetch's
  `redirect: "error"`, which once broke every Google and Supabase call in
  production while all tests passed. Check a new runtime API against the
  Workers docs or `npm run dev:worker`.
- New work goes in the cloud implementation. The legacy Python source and its
  data stay where they are; removing them or importing their data needs an
  explicit request, because the backup named in `README.md` is the only copy.
- Browser CRUD goes through the authenticated session and RLS. Google
  credentials and service-role keys are server-only. Never commit credentials or
  personal data: a commit is the one place a secret cannot be revoked from, and
  this repository holds one real person's data.
- Schema changes go in `supabase/migrations/`. Hosted changes are forward-only
  ([ADR 0003](docs/adr/0003-forward-only-hosted-migrations.md)), so inspect the
  existing data and preserve a backup before applying one; nothing rolls back.
  Reset and rewind commands are for disposable local Supabase only.

## Verification

Run the smallest check that would actually catch a mistake in what you changed,
then stop. Repeating a check that already passed costs minutes and finds
nothing. The table is the scope of local iteration:

| Change | Local iteration |
| --- | --- |
| Documentation | Consistency check and `git diff --check`. |
| Copy or isolated styling | Inspect the affected route; format changed files. |
| Component or application behavior | Focused tests, relevant typecheck, affected browser flow. |
| Shared layout or calendar geometry | Relevant tests plus affected viewports/scenarios. Collage multiple screenshots into one image. |
| Database/auth/data contracts | Focused checks; `npm run verify:db` before pushing. |
| Dependencies/build/CI configuration | Full app checks before pushing; see the guide for hook reuse. |

- Add a focused test for a meaningful behavior change. Do not add one that only
  restates copy or an isolated style: it breaks on the next wording change and
  proves nothing in between.
- Run `npm run verify:quick` once before pushing code, either by hand or through
  the optional pre-push hook. Not both, because the hook runs that same command.
  `npm run verify` already includes it.
- Reproduce a failure locally, fix it, and rerun the checks it touched. Report a
  blocker instead of pushing to find out whether a fix worked. Once checks pass,
  repeat or broaden them only for changed inputs, new failures, or an unresolved
  concern. Local fixture checks need no per-step confirmation.
- A release commit needs **App checks** and **Database checks** green. CI's
  `verify` is full app verification, so do not run the identical suite again
  locally for a release. Database CI skips execution for the diffs
  that cannot change a database result, listed in the development guide.
- A **Database checks** failure means running `npm run verify:db` locally; the
  size of a refactor alone does not. It resets disposable local Supabase and
  regenerates `frontend/src/types/database.ts`, so review that diff and commit
  it when the schema changed. Reuse the running Docker and Supabase rather than
  restarting them.

### Frontend QA

Reuse or start `npm run dev:web` and inspect the affected flow at
`http://localhost:5173/qa/workspace.html` (or a free port). Check `personal`
first, then `dense`. `personal` is a private reproduction of the real account,
so it shows the change on the data it is for; refresh it with
`npm run qa:snapshot`, and without a snapshot it falls back to `realistic`.
`dense` is the attempt to break the layout. Check desktop at 1218×1133 CSS
pixels, the owner's real window (device pixel ratio 1.44): it sits between the
1200px and 1400px breakpoints, and a browser pane left at its own width is
usually under 1200px, which is a different layout from the one in use.
`npm run qa:capture -- --route=<route>` does that for a layout check: it
captures both scenarios at that size and a phone in one collage and reports
sideways scrolling and console errors. Use `npx playwright-cli` for the
interaction itself
([QA fixtures](docs/QA_FIXTURES.md#scripted-capture-and-playwright-cli)). Add
`portrait` and `typical` for covers, and reload for persistence or
initialization. The snapshot and screenshots of it are personal data: never
commit them. Broader shared-layout QA runs once at completion; the scenario
matrix is in
[cloud development](docs/CLOUD_DEVELOPMENT.md#pre-deployment-ui-checks).

Fixtures cannot prove database persistence or Google sync, because the fixture
services stand in for both. The local full stack can: `npm run dev` serves the
app, the API and local Supabase at `http://127.0.0.1:3000`, and
`npm run db:import-hosted` fills it with a copy of the real account. Use the QA
workspace for layout and styling, where its scenarios are deterministic and try
to break things, and the full stack for anything that touches data, auth, the
API or Google. Setup is in
[cloud development](docs/CLOUD_DEVELOPMENT.md#optional-full-stack-local-setup). Before releasing a data-dependent or
provider-dependent change, exercise the authenticated app with the intended
configuration, and state which flows stayed unverified. Smoke-test the change
after release.

## References

- Run commands from the repository root. Frontend: `npm run dev:web`; local full
  stack: `npm run dev`.
- Setup, checks, Docker, and release: [cloud
  development](docs/CLOUD_DEVELOPMENT.md). Current status: [README](README.md).
- Service boundaries and where new code goes:
  [architecture](docs/ARCHITECTURE.md). Naming, CSS, error copy, formatting, and
  test placement: [conventions](docs/CONVENTIONS.md). Visual decisions, tokens,
  and the theme sheets: [DESIGN.md](DESIGN.md). Calendar configuration and
  security: [calendar](docs/CALENDAR.md).
- On the Windows development machine, start Docker and clear stale sockets
  yourself with `$env:USERPROFILE\docker-migration\Start-DockerVmm.ps1`, per
  [the Docker procedure](docs/CLOUD_DEVELOPMENT.md#agent-managed-docker-startup-on-this-windows-machine).
  Reuse a healthy engine, and do not hand routine cleanup back to the user.
- In an environment without Docker, such as a cloud session container,
  `verify:db`, `db:test`, and `db:types` cannot run at all. Say so and push the
  database check to CI rather than improvising a substitute.
- For a Git ownership error, configure per command and never globally:
  `git -c safe.directory="$(pwd)" ...`.
