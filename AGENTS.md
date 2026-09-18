# AGENTS.md

## Working style

- Reuse the task's worktree, dev server, browser, and focused test watcher. Read
  relevant docs only. Install dependencies for a new worktree/changed lockfile;
  format explicit changed paths.

## Repository constraints

- Develop locally and release to the existing personal Vercel/Supabase app;
  no separate Preview environment or commercial launch process.
- Use the cloud implementation for new work. Preserve legacy Python source and
  data; removal or data import needs an explicit request.
- Browser CRUD uses the authenticated session and RLS. Google credentials and
  service-role keys stay server-only; never commit credentials or personal data.
- Use `supabase/migrations/` for schema changes. Hosted changes are forward-only:
  inspect existing data and preserve backups. Reset/rewind commands are local-only.

## Verification

Use the smallest sufficient check while editing; add tests for meaningful behavior
changes. Avoid unnecessary tests that only restate low-impact copy or styling changes.

| Change | Local iteration |
| --- | --- |
| Documentation | Consistency check and `git diff --check`. |
| Copy or isolated styling | Inspect the affected route; format changed files. |
| Component or application behavior | Focused tests, relevant typecheck, affected browser flow. |
| Shared layout or calendar geometry | Relevant tests plus affected viewports/scenarios. If you need multiple screenshots, collage them into one image to minimize files sent. |
| Database/auth/data contracts | Focused checks; `npm run verify:db` before pushing. |
| Dependencies/build/CI configuration | Full app checks before pushing; see guide for hook reuse. |

- Frontend QA: reuse/start `npm run dev:web`, inspect the affected flow at
  `http://localhost:5173/qa/workspace.html` (or a free port).
  Check `personal` first (a private reproduction of the real account; refresh it
  with `npm run qa:snapshot`, and it falls back to `realistic` without one), then
  `dense` to try to break the layout. Add `portrait`/`typical` for covers, reload
  for persistence/initialization. The snapshot and screenshots of it are personal
  data: never commit them. Broader
  shared-layout QA runs once at completion; details in `docs/CLOUD_DEVELOPMENT.md`.
- Before pushing code, run `npm run verify:quick` once, manually or through the
  optional hook; do not run both. `verify` includes this check.
- Before release, require successful `App checks` and `Database checks` for the
  release commit. CI's `verify` satisfies full app verification. Database CI may
  explicitly skip execution for documented docs/style-only diffs.
- Database CI failures also require local `verify:db`; a refactor's size alone
  does not. It resets disposable local Supabase and regenerates database types;
  review the diff. Reuse Docker/Supabase; setup is in the development guide.
- Fixtures cannot prove database persistence or Google sync. Before releasing
  data/provider-dependent changes, check the authenticated app with the intended
  configuration and report unverified flows. After release, smoke-test changes.
- Reproduce failures locally; fix and rerun affected checks. Report blockers
  instead of speculative pushes. After checks pass, repeat/broaden only for
  changed inputs, failures, or unresolved concerns (including environment-specific
  ones). Local fixture checks need no per-step confirmation.

## References

- When Docker is needed on this Windows machine, agents manage startup and stale
  sockets using `$env:USERPROFILE\docker-migration\Start-DockerVmm.ps1`. Follow
  [the Docker procedure](docs/CLOUD_DEVELOPMENT.md#agent-managed-docker-startup-on-this-windows-machine);
  reuse a healthy engine and do not ask the user to perform routine cleanup.
- Run commands from the repository root. Frontend: `npm run dev:web`; local full
  stack: `npm run dev`. Setup, checks, Docker, and release:
  `docs/CLOUD_DEVELOPMENT.md`. Status: `README.md`.
- Use `docs/ARCHITECTURE.md` for service boundaries and code placement;
  `docs/CONVENTIONS.md` for naming, CSS, error copy, formatting, and test placement;
  `docs/CALENDAR.md` for Calendar configuration/security.
- For Git ownership errors, use command-local configuration, never global:
  `git -c safe.directory="$(pwd)" ...`
