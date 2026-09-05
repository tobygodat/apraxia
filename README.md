# orbitOS

A private, manual-entry workspace for Todos, Projects, Ideas, and Media.
Home pairs a read-only Monday–Sunday Google Calendar with Today. Built with
React/Vite, Supabase Auth/Postgres/RLS, and Vercel Functions.

Product behavior lives in [SPEC.md](SPEC.md). The personal live app is
[orbitos-virid.vercel.app](https://orbitos-virid.vercel.app).

## Development

Use Node.js 22 and a running Docker-compatible runtime:

```powershell
npm ci
Copy-Item .env.cloud.example .env.local
npm run db:start
npm run db:status
npm run dev
```

Populate the ignored `.env.local` from local Supabase status. See
[cloud development](docs/CLOUD_DEVELOPMENT.md) for setup, release, and database
checks, and [Calendar](docs/CALENDAR.md) for provider configuration and security.

Run `npm run verify` for type checks, tests, the production build, and the
browser secret scan. Database changes also need local `npm run db:verify` and
regenerated types via `npm run db:types`.

For UI checks, run `npm run dev:web` and open
[/qa/workspace.html](http://localhost:5173/qa/workspace.html).
Use `?route=/ideas` (or `/`, `/todos`, `/projects`, `/media`, `/settings`) and
`&scenario=typical|empty|error|long|disconnected` to inspect fictional data.
The standalone Todo and Today fixtures remain at `/qa/todos-workspace.html`
and `/qa/today-panel.html`; these use `?scenario=empty|dense|error`.
Fixtures reset on reload and do not verify persistence or provider access.

## Verification record

All planned feature slices are implemented and deployed. On 2026-09-04,
`npm run verify` passed 1,635 tests; local database checks passed 176 pgTAP
assertions. Live checks covered Google app sign-in/out, persisted collection
CRUD, search, Undo, project deletion preserving children, and Today during
Calendar failure. The owner reported the app looks good on 2026-09-05.

The last recorded agent checks still leave real Calendar connection/week,
hidden-calendar persistence, reconnect/disconnect, and actual 200% desktop zoom
unverified. Provider setup changes since that check have not been rechecked;
see Calendar guidance before diagnosing an old configuration failure as current.

## Repository and recovery

- `frontend/`: React application; `api/` and `server/`: server-only endpoints.
- `supabase/`: migrations and database tests; `tests/contract/`: cloud tests.
- `src/`, Python tests, and `deploy/`: preserved legacy runtime and recovery files.

Legacy recovery: `uv sync`, `uv run python -m orbitos.main`, then
`npm run dev:legacy-web`. Legacy checks are `uv run pytest` and
`uv run ruff check`. Do not remove legacy source or import personal data without
an explicit request.

The SQLite backup is `.local/backups/orbitos-legacy-20260904T212441Z.db`
(ignored by Git; integrity check passed). Original `orbitos.db` is preserved.
Off-device backup and hosted retention have not been verified.

Export/account deletion UI and legacy import remain deferred, as do mobile,
recurrence, AI, reminders, analytics, rich text, and media metadata services.
