# orbitOS

orbitOS is a private, manual-entry organizational hub for Todos, Ideas, Media,
and Projects. The approved replacement is a React/Vite app on Vercel with
Supabase Postgres, Auth, and Row Level Security. Home will pair a read-only
Monday-Sunday Google Calendar with an accumulated Today todo list.

The locked product behavior lives in [SPEC.md](SPEC.md), and implementation
order and exit criteria live in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Status

The Phase 0 cloud foundation code is in place and its local contract/build
checks pass. The real local Supabase/Vercel workflow and hosted Preview are
not yet verified. Phase 1's migrations, security boundary, and browser auth boundary are in
place, while its real-stack verification and canonical generated database
types remain blocked on local Supabase startup; Docker is healthy, but its
first-time container image downloads failed. Hosted owner setup remains in
`USER_ACTIONS.md`. The schema now
includes RLS, a private Calendar credential store, serialized Today ordering,
soft-delete/undo functions, and user-scoped search. The cloud frontend fails
closed during session restoration, account changes, and user-state cleanup.
The owner selected Google sign-in on 2026-09-03. The signed-out control now
starts the identity-only Supabase PKCE flow with pending, failure, retry, and
cancellation handling. Provider setup and a real callback/storage check remain
open; the local simulated preview does not prove live login.

Phase 2 now includes an integrated, provider-injected Todos workspace: global
Add, editing, completion, delete/Undo, project association, Inbox, Overdue,
and navigable weeks. Account-scoped controllers reconcile saved rows, reject
malformed provider responses, and abandon stale requests. A timezone-aware
date hook advances the current week after midnight or waking the browser.
The reusable Today panel also supports contextual Add, editing, schedule-only
rescheduling, completion, keyboard/drag ordering, and delete/Undo with rollback.
Undo survives local midnight and reloads authoritative rows after restoration;
a failed refresh never repeats a successful restore. These pieces
are not connected to Supabase yet; that
integration deliberately waits for canonical generated `database.ts` types
rather than introducing an untyped temporary data layer.

The [Today data protocol](docs/TODAY_DATA_PROTOCOL.md) retrieves bounded pages
without exposing an incomplete snapshot and confirms a full atomic reorder
with one compact receipt. Local SQL/client tests cover lists above 1,000 tasks;
real Data API verification remains an explicit gate.

Phase 3's [Calendar read core](docs/CALENDAR_READ_CORE.md) now handles civil-week
boundaries, server-side event normalization, bounded pagination, partial
calendar failures, and a size/deadline-limited Google read transport. It remains
disconnected from live Google accounts and Home while authenticated OAuth,
credential refresh, persistence, and endpoint integration continue.
The [Calendar security core](docs/CALENDAR_SECURITY_CORE.md) adds server-verified
sessions, authenticated refresh-token encryption, strict OAuth policy, and
service-only atomic state creation/consumption. Embedded SQL tests pass. A
local-only multi-session concurrency runner is prepared, but its real database
execution, the generated-type adapter, and the browser callback handoff still
need verification before live routes open.

The Python/FastAPI/SQLite app under `src/` remains available during the
transition. It is legacy code, not the target architecture, and should not
receive new target product features.

Owner-only setup and product decisions are tracked without secrets in
[USER_ACTIONS.md](USER_ACTIONS.md). Current implementation gaps and the next
safe work are recorded in [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

## Cloud quick start

Prerequisites are Node.js 22 and a running Docker-compatible runtime.

```powershell
npm ci
Copy-Item .env.cloud.example .env.local
npm run db:start
npm run db:status
npm run dev
```

Use the local Supabase status output to populate the ignored `.env.local` file.
The first `vercel dev` run may require the owner to authorize and link a Vercel
project. Full setup and environment-isolation guidance is in
[docs/CLOUD_DEVELOPMENT.md](docs/CLOUD_DEVELOPMENT.md).

### Local UI preview without account setup

Run `npm run dev:web`, then open
[the local Todos QA fixture](http://localhost:5173/qa/todos-workspace.html)
or [the reusable Today panel](http://localhost:5173/qa/today-panel.html).
It uses fictional, in-memory test records and updates with Vite hot reload;
changes reset on page reload. It is not the production app or a substitute
for Supabase persistence. Optional `?scenario=empty`, `?scenario=dense`, and
`?scenario=error` views support visual checks. The normal `/todos` cloud route
continues to fail closed while configuration/adapter work remains incomplete.

The [Google sign-in preview](http://localhost:5173/qa/google-sign-in.html) shows
the real signed-out interface with a simulated connection failure. It does not
open Google, use credentials, or sign in.

## Cloud verification

```powershell
npm run verify
npm run db:verify
npm run db:test:oauth-concurrency
```

`npm run verify` performs server and frontend type checking, contract tests, a
production Vite build, and a browser-bundle scan for server-only material. The
contract tests apply the migrations to an embedded PostgreSQL runtime even when
Docker is unavailable. `npm run db:verify` remains the authoritative local
Supabase reset, lint, and pgTAP verification.

The cloud diagnostic endpoint is `/api/health`. A Node response identifies
`orbitos-cloud` and `vercel-function`, making it distinguishable from the legacy
FastAPI health route.

## Repository boundaries

```text
api/                    Thin Vercel Function handlers
server/                 Reusable server-only TypeScript
frontend/               React/Vite browser app
supabase/               Tracked local config, migrations, seed, and DB tests
tests/contract/          Server/function contract tests
src/orbitos/             Legacy Python application; preserved during migration
tests/*.py               Legacy Python tests
deploy/                  Legacy VPS material; preserved during migration
```

Database changes must be committed as migrations. Browser code may use only
browser-safe `VITE_` values; the Supabase service-role key and Google credentials
remain server-only.

The browser defaults to `VITE_ORBITOS_RUNTIME=cloud`. Only the explicit
`npm run dev:legacy-web` command loads the transitional API client and FastAPI
session flow.

## Legacy recovery workflow

Use this only to maintain or verify the existing local application while the
cloud replacement is incomplete:

```powershell
uv sync
uv run python -m orbitos.main
npm run dev:legacy-web
```

Legacy checks remain:

```powershell
uv run pytest
uv run ruff check
```

Do not remove the legacy runtime or migrate personal data until the cloud app is
verified and cleanup/migration is explicitly approved.
