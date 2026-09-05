# orbitOS

orbitOS is a private, manual-entry organizational hub for Todos, Ideas, Media,
and Projects. The approved replacement is a React/Vite app on Vercel with
Supabase Postgres, Auth, and Row Level Security. Home pairs a read-only
Monday-Sunday Google Calendar with an accumulated Today todo list.

The locked product behavior lives in [SPEC.md](SPEC.md), and implementation
order and exit criteria live in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Status

The app is for personal use: develop against local Supabase and release useful
features to the existing Vercel/Supabase app. No separate Preview environment
or commercial launch checklist is required.

Home/Today, Todos, Projects, Ideas, Media, Settings, global capture and search
are implemented and deployed. Fresh Google application sign-in, persisted records,
editing, delete/Undo and direct-route refresh were checked live on 2026-09-04.
The health endpoint now returns 200. Calendar code is implemented; live Calendar
still needs a rejected Supabase server credential repaired, its Google server
settings entered, and separate owner consent. Actual 200% zoom QA remains open.

See [implementation status](docs/IMPLEMENTATION_STATUS.md) for verification
results, [the plan](IMPLEMENTATION_PLAN.md) for next steps, and
[account setup](USER_ACTIONS.md) for remaining owner interactions. The legacy
Python/FastAPI/SQLite source under `src/` stays preserved during the transition.

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
