# AGENTS.md

## Source of truth

- Read `SPEC.md` before changing product behavior. It contains the locked product decisions.
- Use `IMPLEMENTATION_PLAN.md` for sequencing and completion criteria.
- The target is a manual-entry, cloud-hosted executive-function hub. The existing FastAPI/SQLite application is transitional, not the architecture to extend.

## Product invariants

- Primary sections are Todos, Ideas, Media, and Projects.
- Entry is manual through section forms and a global Add action. Search is global.
- The desktop Home page places a Monday-Sunday Google Calendar-style week on the left and Today todos on the right.
- Today contains every incomplete todo due on or before the user's local date. Overdue items keep their original due dates and remain until completed or rescheduled.
- The complete todo system lives on its own page, including Inbox, Overdue, the current week, and navigable Monday-Sunday weeks.
- Google Calendar is read-only. Calendar failure must not prevent Today from loading.
- Mobile design and advanced recurring tasks are outside the current scope.
- Do not add Brain Dump, AI extraction, MCP, Telegram, Obsidian, or automatic priority features unless the spec is explicitly revised.

## Target architecture

- React/Vite frontend deployed on Vercel.
- Supabase Postgres, Auth, and Row Level Security for application data.
- Browser clients may perform ordinary CRUD directly through Supabase under the signed-in user's JWT and RLS.
- Use Postgres functions for operations that must be atomic, such as persisted Today ordering.
- Use Vercel Functions for Google OAuth and Calendar API calls.
- Store Google credentials and OAuth transactions in a private schema that browser roles cannot access.
- Never trust a client-supplied `user_id`; derive ownership from the authenticated session.

## Repository status

- The Python/FastAPI/SQLite service under `src/` is the legacy implementation. Preserve it until the cloud replacement is verified.
- Do not implement target features in the legacy backend unless `IMPLEMENTATION_PLAN.md` explicitly calls for it.
- The current frontend may still proxy FastAPI during the transition. Phase 0 replaces that setup with the root Vercel/Supabase workspace.

## Commands

Cloud replacement (primary):

```bash
npm ci
npm run dev
npm run verify
npm run db:reset
npm run db:types
```

`npm run dev` starts local Supabase before Vercel's local frontend/function
runtime. It requires a running Docker-compatible runtime and one-time local
environment/project setup documented in `docs/CLOUD_DEVELOPMENT.md`.

Transitional legacy frontend only:

```bash
npm run dev:legacy-web
```

Legacy backend, only when maintaining or verifying existing behavior:

```bash
uv sync
uv run pytest
uv run ruff check
uv run python -m orbitos.main
```

The root scripts supersede direct `frontend/` npm commands for cloud work.

## Working rules

- Preserve unrelated changes in a dirty worktree.
- Make database changes through committed migrations, not dashboard-only edits.
- Add RLS policies and cross-user isolation tests for every user-owned table.
- Keep `due_date` as a date-only value; store any optional time separately. Do not roll overdue dates forward automatically.
- Derive Today with `completed_at IS NULL AND due_date <= local_today`, then apply the saved manual order.
- Request no Google Calendar write scopes. Keep calendar and Today loading paths independent.
- Keep domain contracts and generated database types shared across UI and server code.
- Do not add mobile-specific work unless requested.
- For cloud/frontend changes, run `npm run verify`. Run focused tests for the behavior changed.

## Git on this Windows checkout

If Git reports dubious ownership, use command-local configuration:

```bash
git -c safe.directory='C:/Users/tobyg/OneDrive/Documents/ChatGPT/tobiOS' status
```

Apply the same `-c safe.directory=...` option to other Git commands. Do not change the user's global Git configuration.
