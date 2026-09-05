# AGENTS.md

- Read `SPEC.md` before changing product behavior. Follow `IMPLEMENTATION_PLAN.md`
  for sequencing and `docs/IMPLEMENTATION_STATUS.md` for verified progress.
- This is a personal-use app: local development plus one live Vercel/Supabase
  environment. No separate Preview setup or commercial launch process is required.
  Ship useful slices; keep personal data and credentials protected.
- Target React/Vite, Supabase Auth/Postgres/RLS, and Vercel Functions for Google
  Calendar. `src/` is the legacy Python backend; preserve it and do not extend it
  for new product features.
- Browser CRUD uses the authenticated session and RLS. Keep Google credentials
  in the private schema; use atomic Postgres functions for Today ordering.
- Keep due dates date-only and overdue dates unchanged. Calendar is read-only
  and must never block Today loading. Other product rules live in `SPEC.md`.

## Agent workflow

- Carry requested work through implementation and required checks. Choose reasonable
  defaults for routine gaps; ask when missing information materially changes scope
  or outcome. Incorporate follow-ups without dropping unfinished work.
- Act within existing authorization. Before requesting necessary approval, prepare
  the reviewable result and finish independent work.
- User instructions override skill guidance, subject to system and developer
  requirements. If a skill blocks progress, cite its file and exact rule and explain
  the unresolved requirement.
- Delegate independent, bounded tasks when parallel work improves speed or quality.
  Coordinate shared files and preserve unrelated changes in a dirty worktree.
- Lead with results in concise, plain prose. State changes, verification, and
  remaining limits; avoid stock phrases and unnecessary formatting.
- Complete required checks below. Add tests for meaningful behavior; broaden or
  repeat checks only when failures, changes, or unresolved risks warrant it.

## Development

- Use root npm scripts. `npm run dev` requires Docker/local Supabase; setup is in
  `docs/CLOUD_DEVELOPMENT.md`. `npm run dev:legacy-web` selects the old frontend.
- Run `npm run verify` for cloud code changes and focused checks for the changed
  behavior. Documentation-only edits need a consistency check, not a full test run.
- Change schema through `supabase/migrations/`, cover ownership with local RLS
  tests, and regenerate `frontend/src/types/database.ts` using `npm run db:types`.
  Database reset/rewind tests are local-only; apply forward migrations to live data.

## Windows Git

If Git reports dubious ownership, use command-local configuration:

```powershell
git -c safe.directory='C:/Users/tobyg/OneDrive/Documents/ChatGPT/tobiOS' status
```

Use the same option for other Git commands; do not change global configuration.
