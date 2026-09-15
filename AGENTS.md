# AGENTS.md

## Working style

- Implement only the requested scope. Do not add unrequested features, fields,
  or options. Suggest optional additions and wait for approval before adding them.
- Keep changes minimal and consistent with the existing app. Prefer reasonable
  defaults and complete authorized work; ask only when missing information would
  materially change the result. Explicit user decisions supersede repo defaults.
- Preserve unrelated changes. Report the outcome, checks run, and any remaining
  blocker concisely.

## Repository constraints

- For design work, continue using the invoked skill throughout follow-ups and
  revisions. Honor the saved Impeccable build-path preference. Build code-first
  mockups inside the existing app's local QA workspace using fictional data and
  existing components. Do not switch to standalone HTML or inline visualizations
  unless explicitly requested. Before editing, state the target route and preview
  location.

- Develop locally and release to the existing personal Vercel/Supabase app;
  no separate Preview environment or commercial launch process.
- Use the cloud implementation for new work. Preserve legacy Python source and
  data; removal or data import needs an explicit request.
- Browser CRUD uses the authenticated session and RLS. Google credentials and
  service-role keys stay server-only; never commit credentials or personal data.
- Preserve date-only due dates, unchanged overdue dates, and atomic Today ordering.
- Use `supabase/migrations/` for schema changes. Hosted changes are forward-only:
  inspect existing data and preserve backups. Reset/rewind commands are local-only.

## Commands and references

- Run commands from the repository root. Use `npm run dev` for the full local app
  or `npm run dev:web` for frontend work. Setup and release: `docs/CLOUD_DEVELOPMENT.md`.
  Calendar configuration and security: `docs/CALENDAR.md`. Status: `README.md`.
- System overview and where new code belongs: `docs/ARCHITECTURE.md`. Naming,
  CSS, error copy, and test placement: `docs/CONVENTIONS.md`. Follow both.
- For frontend changes, run `npm run dev:web`, check the affected flow at `http://localhost:5173/qa/workspace.html`, and open it in the browser panel. Start with `realistic`; calendar/appearance work also needs dense, portrait-cover, and no-cover (`typical`) checks, including reload. Use a free port if another checkout occupies 5173.
- Fixtures use fictional data and cannot prove Google sync or database persistence.
  Scenarios and parameters are documented in `docs/QA_FIXTURES.md`. Before deploying data/provider-dependent changes, check the normal authenticated app with the intended data/configuration and report anything unverified. See `docs/CLOUD_DEVELOPMENT.md` for the pre-deployment workflow.
- GitHub Actions runs `App checks` and `Database checks`; require both before
  release. Iterate locally: use `npm run test:watch -- <test-file>` or
  `npm run test:related -- <source-file>` after edits, and `npm run verify:quick`
  before pushing. Run `npm run verify` before release. For database/auth changes,
  broad refactors, or database CI failures, run `npm run verify:db` against
  disposable local Supabase before pushing; keep Docker/Supabase running between
  attempts. This regenerates the checked-in database types; review the diff.
  After a CI failure, reproduce the failing command locally and verify the fix
  before another push. If the local environment cannot reproduce it, report the
  specific blocker instead of cycling through speculative remote fixes.
  Docker is not needed for ordinary frontend tests. See `docs/CLOUD_DEVELOPMENT.md`.
- Use Docker only when the task requires local containers. Check `docker info`
  first and reuse a running engine. Otherwise use `docker desktop start` once
  and wait for `docker info` to succeed; a startup timeout alone does not mean
  the engine failed. If startup fails, inspect logs before retrying. Do not
  force-kill Docker, shut down WSL, or restart Docker as routine cleanup. Never
  automatically reset Docker or delete its data.
- Add focused tests for meaningful behavior changes. Documentation-only edits
  need a consistency and diff check. Once required checks pass, repeat or broaden
  testing only for new changes, failures, or unresolved concerns.
- For Git ownership errors, use command-local configuration, never global:
  `git -c safe.directory="$(pwd)" ...`
