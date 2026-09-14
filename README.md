# orbitOS

A private, manual-entry workspace for Todos, Projects, Ideas, and Media.
Home pairs an editable Monday–Sunday Google Calendar with Today. Built with
React/Vite, Supabase Auth/Postgres/RLS, and Vercel Functions.

Product rules and repository workflow live in [AGENTS.md](AGENTS.md). The personal live app is
[orbitos-virid.vercel.app](https://orbitos-virid.vercel.app).

## Development

For routine development, use Node.js 22; Docker is not required:

```powershell
npm ci
npm run dev:web
```

GitHub Actions runs app and database checks on pull requests and pushes to `main`.
Its database job uses a temporary Supabase instance on the runner. See
[cloud development](docs/CLOUD_DEVELOPMENT.md) for CI, optional full-stack local setup, release, and database
checks, and [Calendar](docs/CALENDAR.md) for provider configuration and security.

Run `npm run verify` for type checks, tests, the production build, and the
browser secret scan. CI validates database changes and provides regenerated types
in its `database-types` artifact. Both CI jobs must pass before release.

For UI checks, run `npm run dev:web` and open
[/qa/workspace.html](http://localhost:5173/qa/workspace.html).
Use `?route=/ideas` (or `/`, `/todos`, `/projects`, `/media`, `/classes`, `/settings`).
The default `realistic` scenario includes event-specific colors, overlapping and
adjacent events, short events, long titles, and a saved cover with an off-center
crop. The QA menu switches to `typical` (no cover), `empty`, `dense`, `long`,
`portrait`, `slow`, `error`, or `disconnected` without changing the app layout.
It shares the authenticated app's navigation cache, preload, and invalidation.
Calendar edits/visibility and page appearance survive reload in this tab; the
menu resets them. Tasks and collections still reset on reload. QA storage is
separate from account storage; no real data or credentials are loaded.
The standalone Todo and Today fixtures remain at `/qa/todos-workspace.html`
and `/qa/today-panel.html`; these use `?scenario=empty|dense|error`.
Standalone fixtures reset on reload. Fixtures do not verify database persistence,
Google sync, OAuth, or hosted configuration. See the
[pre-deployment checks](docs/CLOUD_DEVELOPMENT.md#pre-deployment-ui-checks).

## Verification record

Classes now uses account-owned database records for classes, assignments, and
saved notes. Device PDFs upload to private Storage; Drive PDFs are saved as file
references. Apply the required forward migrations before releasing this UI; see
[Classes data model](docs/CLASSES_DATA_MODEL.md) for recovery and upload details.

Drive notes are implemented for Classes with separate consent, native Google
Picker PDF and folder navigation, and streamed PDF reading. Hosted setup and
live verification are pending; see
[Drive setup](docs/DRIVE.md).


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
