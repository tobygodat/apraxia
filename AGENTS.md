# AGENTS.md

- Read `SPEC.md` before changing behavior. Keep the app minimal, calm, and
  desktop-first; reuse existing components, services, and RPCs.
- Use React/Vite, Supabase Auth/Postgres/RLS, and Vercel Functions. Develop
  locally and release to the existing personal app; no separate Preview setup.
- Browser CRUD uses the authenticated session and RLS. Google credentials stay
  server-only in the private schema. Never commit credentials or personal data.
- Keep due dates date-only, overdue dates unchanged, and Today ordering atomic.
  Calendar is read-only and must load independently of Today.
- Preserve legacy Python source and data; do not extend them for new features.
- Finish requested work and relevant checks; preserve unrelated changes.
  Prefer reasonable defaults and concise reporting over extra process.
- Use root npm scripts; setup is in `docs/CLOUD_DEVELOPMENT.md`. Run
  `npm run verify` for cloud code changes and focused tests for meaningful
  behavior. Documentation-only edits need a consistency check.
- Use `supabase/migrations/` for schema changes, run local database/RLS checks,
  and regenerate types with `npm run db:types`. Hosted changes are forward-only;
  inspect existing data and preserve backups. Reset/rewind tests are local-only.
- For Git ownership errors, use command-local configuration, never global:
  `git -c safe.directory='C:/Users/tobyg/OneDrive/Documents/ChatGPT/tobiOS' ...`
