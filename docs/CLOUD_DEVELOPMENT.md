# Cloud development

Use the root Node workspace: React/Vite, Vercel Functions, and Supabase.
Prerequisites: Node.js 22 (`.nvmrc`), Docker (WSL 2 on Windows), and Vercel/Supabase
account access when linking hosted projects.

## Local setup

```powershell
npm ci
Copy-Item .env.cloud.example .env.local
npm run db:start
npm run db:status
npm run dev
```

Populate the ignored `.env.local` with local Supabase settings. Never commit
credentials. The first Vercel run may require account/project linking.
The local app normally uses `http://127.0.0.1:3000`; `/api/health` should identify
`orbitos-cloud` and `vercel-function`. `npm run dev:web` runs Vite alone for
fictional UI fixtures; see the root README.

## Checks

```powershell
npm run verify
npm run db:verify
npm run db:rewind:verify
npm run db:test:oauth-concurrency
npm run db:test:todos-http
```

Run checks relevant to the change. `verify` covers server/frontend types,
contract tests, the production build, and a browser secret scan. Embedded
PostgreSQL tests cover migrations and behavior but do not replace local
Supabase/RLS and HTTP checks.

`db:verify` resets the local database, lints it, and runs pgTAP. Rewind/reapply
retains the initial migration; full reset separately verifies recreation.
These commands are disposable-local only, never for hosted data.

The OAuth concurrency suite uses independent sessions in the checked local
`supabase_db_orbitos` container to prove one consume winner, expiry during a
lock wait, and rollback/retry. It verifies container identity and removes only
its generated fixtures. Do not adapt it to a hosted database.

The Todo HTTP suite accepts only the fixed local API/database ports, creates
fictional Auth users, and checks CRUD, ordering, UI persistence, and isolation
through PostgREST before cleaning up its exact fixtures. It retains the normal
1,000-row API limit and verifies complete Today access beyond that limit.
Its test-only password sessions do not verify Google OAuth.

Schema changes belong in `supabase/migrations/`; regenerate types with
`npm run db:types`. Preserve the exact soft-delete timestamp string for Undo:
JavaScript Date conversion loses required precision. See
[Today data protocol](TODAY_DATA_PROTOCOL.md) for pagination and atomic ordering.

## Live releases

| Environment | Database | Configuration |
|---|---|---|
| Development | Local Supabase | Ignored `.env.local` |
| Vercel Production | `oidvvenjamgcezdptfjr` | Vercel Production variables |

The live app is `https://orbitos-virid.vercel.app`, linked to `tobygodat/tobiOS`.
There is no required Preview environment. A main push may deploy immediately;
apply required forward migrations before publishing dependent code. Inspect
current hosted data and migration history, and preserve a backup/export when
data exists. Never infer an empty database from a historical smoke test.

Frontend Supabase configuration is embedded at build time. Only browser-safe
`VITE_` values belong in the browser; privileged Supabase and Google credentials
stay server-only. Redeploy after environment changes. Optional Preview builds
should not receive live credentials by default. Verify changed flows on the
live app after a release, including reload persistence and recovery from errors.
See [Calendar](CALENDAR.md) for OAuth setup and credential troubleshooting.

## Authentication and legacy recovery

Cloud startup restores the Supabase session before mounting protected routes.
Google app sign-in uses PKCE and identity-only scopes; Calendar consent is
separate. Auth storage strips Google provider-token fields while preserving
Supabase's own session tokens. Sign-out uses local scope and clears app caches
and drafts; a failed sign-out keeps the workspace available.

The preserved legacy runtime uses `uv run python -m orbitos.main` with
`npm run dev:legacy-web`. Cloud is the frontend default; the legacy command
explicitly enables its FastAPI proxy. Do not remove legacy source, data, or
recovery files without an explicit request. Backup location is in the root README.
