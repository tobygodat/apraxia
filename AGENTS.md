# AGENTS.md

## Working style

- Implement only the requested scope. Do not add unrequested features, fields,
  or options. Suggest optional additions and wait for approval before adding them.
- Keep changes minimal and consistent. Complete authorized work using reasonable
  defaults; ask only when missing information materially changes the result.
  User decisions supersede repo/skill defaults. Identify any blocking skill rule.
- Preserve unrelated changes. Report the outcome, checks run, and any remaining
  blocker concisely.
- Small changes: inspect, implement, verify, finish. Plan ambiguous/substantial
  work around an observable completion condition.
- Reuse the task's worktree, dev server, browser, and focused test watcher. Read
  relevant docs only. Install dependencies for a new worktree/changed lockfile;
  format explicit changed paths.

## Repository constraints

- Continue the invoked design skill through revisions. Honor Impeccable's saved
  code-first preference: use existing components and fictional data in local QA.
  Standalone HTML/inline visualizations need an explicit request. State the target
  route and preview location before editing.

- Develop locally and release to the existing personal Vercel/Supabase app;
  no separate Preview environment or commercial launch process.
- Use the cloud implementation for new work. Preserve legacy Python source and
  data; removal or data import needs an explicit request.
- Browser CRUD uses the authenticated session and RLS. Google credentials and
  service-role keys stay server-only; never commit credentials or personal data.
- Preserve date-only due dates, unchanged overdue dates, and atomic Today ordering.
- Use `supabase/migrations/` for schema changes. Hosted changes are forward-only:
  inspect existing data and preserve backups. Reset/rewind commands are local-only.

## Verification

Use the smallest sufficient check while editing; add tests for meaningful behavior
changes. Avoid tests that only restate low-impact copy or styling changes.

| Change | Local iteration |
| --- | --- |
| Documentation | Consistency check and `git diff --check`. |
| Copy or isolated styling | Inspect the affected route; format changed files. |
| Component or application behavior | Focused tests, relevant typecheck, affected browser flow. |
| Shared layout or calendar geometry | Relevant tests plus affected viewports/scenarios. |
| Database/auth/data contracts | Focused checks; `npm run verify:db` before pushing. |
| Dependencies/build/CI configuration | Full app checks before pushing; see guide for hook reuse. |

- Frontend QA: reuse/start `npm run dev:web`, inspect the affected flow at
  `http://localhost:5173/qa/workspace.html` (or a free port), and open the preview
  in the browser panel. Use `realistic`; add `dense` for calendar geometry/text,
  `portrait`/`typical` for covers, reload for persistence/initialization. Broader
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

- Run commands from the repository root. Frontend: `npm run dev:web`; local full
  stack: `npm run dev`. Setup, checks, Docker, release, and official Codex guidance:
  `docs/CLOUD_DEVELOPMENT.md`. Status: `README.md`.
- Use `docs/ARCHITECTURE.md` for service boundaries and code placement;
  `docs/CONVENTIONS.md` for naming, CSS, error copy, formatting, and test placement;
  `docs/CALENDAR.md` for Calendar configuration/security.
- For Git ownership errors, use command-local configuration, never global:
  `git -c safe.directory="$(pwd)" ...`
