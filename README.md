# apraxia

A private workspace for tasks, projects, ideas, classes, and interview preparation.
Home pairs an editable Sunday-to-Saturday Google Calendar with Today. Built with
React/Vite, Supabase Auth/Postgres/RLS, and Vercel Functions.

Tasks aggregates ordinary tasks, project tasks, class assignments, and Career
preparation into Inbox and date columns, filtered by source. Career preparation
currently appears under personal tasks. Incomplete past-due tasks join Today with
their original due dates shown in red; stored dates are never rewritten.

Product rules and repository workflow live in [AGENTS.md](AGENTS.md). The personal live app is
[apraxia.dev](https://apraxia.dev).

The app was renamed from orbitOS to apraxia on 2026-09-17. Persisted and hosted
identifiers keep the old name on purpose: the database roles and enum, names
inside applied migrations, token-encryption purpose strings, the legacy
`orbitos:classes:v1` browser payload, the preserved `src/orbitos` package with
its `orbitos.db` data, and the Vercel variable `ORBITOS_AGENT_TOKEN`, which
cannot be renamed in place. Renaming any of them is a separate, data-affecting
change.

## Status

The personal app is deployed, including the consumer slice: Career prep linked
to daily tasks, an editable assistant brief and plan import, and responsive daily
views. See [Career plan handoff](docs/CAREER_PLAN_HANDOFF.md).

Class PDFs and the Google Drive connection are removed; a class keeps its
assignments and written notes. The uploaded files remain in the private
`class-pdfs` bucket for removal through the Storage API; see
[Classes data model](docs/CLASSES_DATA_MODEL.md#retired-pdf-notes).

Every migration in `supabase/migrations/` is applied to the hosted app, checked
against its migration history on 2026-10-09.

Real Calendar connection and reconnect were verified on `https://apraxia.dev` on
2026-09-18. An explicit Calendar disconnect is still unverified, so reinspect the
current provider configuration before diagnosing an old failure as current.

## Development

For routine development, use Node.js 22; Docker is not required:

```bash
npm ci # New worktree or changed lockfile only.
npm run dev:web
```

For UI checks, open
[/qa/workspace.html](http://localhost:5173/qa/workspace.html). Scenarios,
URL parameters, and what the fixtures can and cannot prove are documented in
[QA fixtures](docs/QA_FIXTURES.md). Fixtures do not verify database
persistence, Google sync, OAuth, or hosted configuration.

Use focused checks while editing, then run `npm run verify:quick` once before
pushing; see [fast local feedback](docs/CLOUD_DEVELOPMENT.md#fast-local-feedback).
GitHub Actions runs **App checks** and **Database checks**, which must both pass
for the release commit.

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
- [Calendar](docs/CALENDAR.md): provider setup and security.
- [Agent API](docs/AGENT_API.md): the personal agent endpoints, permissions, and
  retry rules.
- [Career plan handoff](docs/CAREER_PLAN_HANDOFF.md): preparation shared with
  daily tasks, selected context for an assistant, and reviewed plan imports.
- [Decision records](docs/adr/): why access is RLS-only, why Today uses scalar
  envelopes, why hosted migrations are forward-only, why time arithmetic runs on
  the server.
- [History](docs/history/): the 2026-09-14 audit and the task aggregation
  roadmap and release records, kept for reference.

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

Export/account deletion UI, legacy import, a native mobile app, hosted AI,
per-account assistant connections, reminders, and analytics remain deferred.
