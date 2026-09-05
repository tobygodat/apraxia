# Cloud development

The cloud replacement uses the root Node workspace, Vercel Functions, and
Supabase. The Python/FastAPI/SQLite runtime remains recoverable during the
transition but is not extended for target product features.

## Prerequisites

- Node.js 22 (pinned by `.nvmrc`)
- A Docker-compatible runtime for local Supabase. On this Windows host, Docker
  Desktop requires WSL 2; the one-time owner action is tracked in
  `USER_ACTIONS.md`.
- Vercel and Supabase account authorization only when linking hosted projects

Install the deterministic workspace from the repository root:

```powershell
npm ci
```

Copy `.env.cloud.example` to the ignored `.env.local` file. Start Supabase once
with `npm run db:start`, then use `npm run db:status` to obtain its local public
and server keys and place them in `.env.local`. Do not commit or paste those
values into documentation.

After the local values exist, one command starts local Supabase, the Vite app,
and Vercel Functions:

```powershell
npm run dev
```

Vercel may request account/project linking on its first run. That owner action
is tracked in `USER_ACTIONS.md`.

The cloud runtime listens through Vercel's local URL (normally
`http://127.0.0.1:3000`). Verify the Node function—not the legacy FastAPI
endpoint—by checking that `/api/health` identifies both `orbitos-cloud` and
`vercel-function`.

## Verification

```powershell
npm run verify
npm run db:verify
npm run db:rewind:verify
npm run db:test:oauth-concurrency
npm run db:test:todos-http
```

`npm run verify` runs server and frontend type checking, contract tests, the
production frontend build, and a scan that fails if server-only names or active
secret values appear in the browser bundle. Its contract suite also applies all
migrations to an embedded PostgreSQL runtime and exercises two-user isolation,
Today reordering, exact-token undo, and user-scoped search. This fast check does
not replace `npm run db:verify`, which resets the real local Supabase stack,
lints the database, and runs the pgTAP suite. The embedded migration test rolls
back only an uncommitted batch to verify transaction atomicity. A committed
rewind and reapply is verified separately by `npm run db:rewind:verify` against
the real local stack. Docker must be reachable before running these checks;
their current verification status is recorded in `IMPLEMENTATION_STATUS.md`.

The rewind command retains the initial migration because the CLI rejects
rewinding every migration; the reset command separately recreates the full
database. Both paths passed on the local stack on 2026-09-04.

`npm run db:test:todos-http` reads local CLI status without printing credentials
and accepts only the fixed `127.0.0.1:54321` API and local database port. It
creates fictional Auth users, exercises the typed Todo adapter and authenticated
Todo UI against real PostgREST, and deletes/verifies its exact users afterward.
The configured 1,000-row cap stays unchanged. Its UI test uses happy-dom and a
test-only password session; this does not add password login to the app or verify
Google OAuth. Hosted browser acceptance remains separate.

Authenticated `/todos` now mounts the persisted workspace. Other unfinished
cloud routes still show the session checkpoint with a link to Todos.

`npm run db:test:oauth-concurrency` runs after migrations are applied, against
only the local `supabase_db_orbitos` PostgreSQL 17 container. It pins a local
Docker endpoint and immutable container ID, checks project labels/database
identity/migration 005, and uses two independent consumers plus an observer.
It proves actual lock waits for one committed winner, expiry while waiting,
and a first consumer rolling back. It creates one fictional Auth user and three
OAuth transactions, then deletes and verifies only its exact generated fixtures.
It accepts no connection string or target override, logs no credentials or SQL
context, and must never be adapted to a hosted/personal database casually.
Guard tests in `npm run verify` do not replace this actual multi-session run.

Database changes must be committed as timestamped files in
`supabase/migrations/`. Regenerate frontend database types after each migration:

```powershell
npm run db:types
```

Keep the soft-delete timestamp returned by `soft_delete_record` as the original
string when calling `restore_record`; converting through a JavaScript `Date`
can lose the precision required by the exact undo token.

## Local development and the live personal app

| Environment | Database | App/OAuth origin | Secret storage |
|---|---|---|---|
| Development | Local Supabase | Local Vercel URL | Ignored `.env.local` |
| Live (Vercel Production) | Existing hosted `orbitos` Supabase | `https://orbitos-virid.vercel.app` | Vercel Production variables |

The owner removed the separate Preview requirement on 2026-09-04. Use local
Supabase for disposable tests and the existing hosted `tobydev / orbitos` project
(`oidvvenjamgcezdptfjr`) for personal data. Do not treat old reports that it was
empty as current evidence: inspect migration history and data before changes,
preserve a backup/export when data exists, and apply forward migrations only.
Never run reset or rewind checks on the hosted project.

For a live release, use Vercel's Production variables when building the frontend;
Supabase browser settings are embedded at build time. A `main` push may deploy
immediately, so apply required migrations before publishing dependent code.
There is no Preview provisioning step. Any automatically created Preview
deployment is optional and should not receive live credentials by default.
Local tests use local keys. Browser code may receive only the `VITE_` values;
privileged Supabase and Google credentials stay server-only.

The Calendar encryption key must be exactly 32 cryptographically random bytes
encoded as padded standard Base64, stored only in the server environment. The
validator checks the encoding and length, not entropy. Do not use a password or
paste generated keys into documentation, chat, or committed files. See
`CALENDAR_SECURITY_CORE.md` for the envelope and pending rotation workflow.

## Transitional legacy workflow

Until Supabase Auth and the new data layer replace the current API calls, the
legacy frontend remains available with its FastAPI proxy:

```powershell
uv run python -m orbitos.main
npm run dev:legacy-web
```

Cloud is the frontend default. The legacy command explicitly sets
`VITE_ORBITOS_RUNTIME=legacy` and enables the FastAPI proxy; its routes and API
client are lazy-loaded only in that mode. Do not remove the legacy source,
SQLite schema, or deployment files until cloud feature parity is verified and
cleanup is explicitly approved.

## Authentication boundary

Cloud startup validates only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, creates one browser Supabase client, and restores the
provider-owned session before mounting any protected route. React receives only
the user's ID, optional email, and session expiry metadata—not access, refresh,
or provider tokens. The configured auth-storage adapter recursively removes
OAuth provider token fields before session writes and repairs any legacy value
on read while preserving Supabase's own access and refresh tokens. Sign-out
uses local scope, clears registered orbitOS caches and drafts, and leaves the
protected workspace mounted when sign-out itself fails.

The owner selected Google application sign-in on 2026-09-03 (`UA-005`). The
signed-out entry now starts Supabase's PKCE Google flow with identity-only
scopes and a fixed return to the current application origin. The control
prevents duplicate attempts, supports failure/retry, and abandons navigation
after unmount or cancellation. Provider configuration and real callback/storage
verification remain in `UA-008`. The development-only
`/qa/google-sign-in.html` fixture simulates a connection failure; it neither
opens Google nor uses credentials.
Google application sign-in and the later read-only Google Calendar consent are
separate authorizations; no Calendar credentials belong in browser storage.
