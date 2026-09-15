# orbitOS

A private, manual-entry workspace for Todos, Projects, Ideas, and Media.
Home pairs an editable Sunday-to-Saturday Google Calendar with Today. Built with
React/Vite, Supabase Auth/Postgres/RLS, and Vercel Functions.

Product rules and repository workflow live in [AGENTS.md](AGENTS.md). The personal live app is
[orbitos-virid.vercel.app](https://orbitos-virid.vercel.app).

## Status

All planned feature slices are implemented and deployed; Drive notes are
implemented but their hosted setup and live verification are still pending.
Real Calendar connection and reconnect/disconnect flows remain unverified since
the last recorded check, so reinspect the current provider configuration before
diagnosing an old failure as current.

## Development

For routine development, use Node.js 22; Docker is not required:

```bash
npm ci
npm run dev:web
```

For UI checks, open
[/qa/workspace.html](http://localhost:5173/qa/workspace.html). Scenarios,
URL parameters, and what the fixtures can and cannot prove are documented in
[QA fixtures](docs/QA_FIXTURES.md). Fixtures do not verify database
persistence, Google sync, OAuth, or hosted configuration.

Run `npm run verify` for type checks, tests, the production build, and the
browser secret scan. GitHub Actions runs **App checks** and **Database checks**
on pull requests and pushes to `main`; both must pass before release. The
database job uses a temporary Supabase instance on the runner and publishes
regenerated types as its `database-types` artifact.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): the two data paths, folder layout, and
  where new code goes.
- [Workspace data model](docs/WORKSPACE_DATA_MODEL.md) and
  [Classes data model](docs/CLASSES_DATA_MODEL.md): tables, RLS, and the
  soft-delete undo contract.
- [Today data protocol](docs/TODAY_DATA_PROTOCOL.md): complete Today reads and
  atomic ordering.
- [Conventions](docs/CONVENTIONS.md): naming, CSS, error copy, test placement.
- [QA fixtures](docs/QA_FIXTURES.md): the local fictional workspace.
- [Cloud development](docs/CLOUD_DEVELOPMENT.md): environment variables, CI,
  local setup, release.
- [Calendar](docs/CALENDAR.md) and [Drive](docs/DRIVE.md): provider setup and
  security.
- [Decision records](docs/adr/): why access is RLS-only, why Today uses scalar
  envelopes, why hosted migrations are forward-only, why time arithmetic runs on
  the server.

## Repository and recovery

- `frontend/`: React application; `api/` and `server/`: server-only endpoints.
- `supabase/`: migrations and database tests; `tests/contract/`: cloud tests.
- `src/`, Python tests, and `deploy/`: preserved legacy runtime and recovery files.

Legacy recovery: `uv sync`, `uv run python -m orbitos.main`, then
`npm run dev:legacy-web`. Legacy checks are `uv run pytest` and
`uv run ruff check`. These commands are unverified since 2026-09 and are not
covered by CI. Do not remove legacy source, data, or recovery files without an
explicit request.

The SQLite backup is `.local/backups/orbitos-legacy-20260904T212441Z.db`
(ignored by Git; integrity check passed). Original `orbitos.db` is preserved.
Off-device backup and hosted retention have not been verified.

Export/account deletion UI and legacy import remain deferred, as do mobile,
recurrence, AI, reminders, analytics, rich text, and media metadata services.
