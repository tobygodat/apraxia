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
- For frontend changes, run `npm run dev:web`, check the affected flow at `http://localhost:5173/qa/workspace.html`, and open it in the browser panel. Start with `realistic`; calendar/appearance work also needs dense, portrait-cover, and no-cover (`typical`) checks, including reload. Use a free port if another checkout occupies 5173.
- Fixtures use fictional data and cannot prove Google sync or database persistence. Before deploying data/provider-dependent changes, check the normal authenticated app with the intended data/configuration and report anything unverified. See `docs/CLOUD_DEVELOPMENT.md` for the pre-deployment workflow.
- GitHub Actions runs `App checks` and `Database checks`; require both before
  release. Run `npm run verify` locally for cloud changes. Schema validation and
  type generation run in CI; download its `database-types` artifact when updating
  the checked-in types. Local Docker is optional for backend debugging, not a
  prerequisite for ordinary work. See `docs/CLOUD_DEVELOPMENT.md`.
- Add focused tests for meaningful behavior changes. Documentation-only edits
  need a consistency and diff check. Once required checks pass, repeat or broaden
  testing only for new changes, failures, or unresolved concerns.
- For Git ownership errors, use command-local configuration, never global:
  `git -c safe.directory='C:/Users/tobyg/OneDrive/Documents/ChatGPT/tobiOS' ...`
