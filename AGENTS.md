# AGENTS.md

This file is the shared reference for product rules and repository workflow.
Update these rules when the user changes a product decision. Keep implementation
details in code and migrations, setup in `docs/`, and verification in `README.md`.

## Product rules

- Keep orbitOS a minimal, calm, desktop-first personal workspace. Entry and
  prioritization are manual; reuse existing components, services, and RPCs.
- Home pairs a Monday–Sunday Calendar on the left with Today on the right.
  Calendar and Today load independently; Calendar failure never blocks Todos.
- Today includes every incomplete, non-deleted todo due today or earlier in the
  user's timezone. Preserve overdue dates; default to oldest overdue first.
  Explicit manual ordering persists and saves atomically. Completion or moving
  the due date into the future removes the todo from Today immediately.
- Keep due dates date-only and optional due times separate; UTC or daylight
  saving conversion must not shift dates. A due time requires a due date.
- The separate Todos page keeps Inbox, Overdue, today through Sunday for the
  current week, and Monday–Sunday for navigated weeks.
- Calendar remains read-only. Events open Google Calendar; global Add's Calendar
  event choice opens Google's composer. Show all calendars by default and save
  visibility choices in Settings. Preserve all-day and timed-event timezone
  semantics, overlapping events, and successful results when one calendar fails.
- Global Add and contextual controls support Todos, Ideas, Media, and Projects.
  Global search covers those collections, excluding Google Calendar events.
  Settings belongs in the account menu.
- Ideas need a body but no title or workflow status. Media combines Books and
  Movies with Saved, In Progress, and Finished states. Projects use Active,
  Someday, Completed, and Archived states and group Todos and Ideas; deleting a
  project preserves its children.
- Offer immediate Undo for soft deletion and exclude deleted records from normal
  reads. Failed writes preserve input and roll back optimistic changes; failed
  reads preserve useful content and show retry, not false empty results.
- Keep desktop flows keyboard accessible, including alternatives to dragging,
  visible focus, sufficient contrast, and usable Calendar layout at 200% zoom.
  Do not communicate status by color alone or show raw technical errors.
- After sign-in, preload Todos and the first page of Ideas, Media, and active
  Projects. Reuse successful reads during navigation for up to one minute in
  session memory. Writes and returning focus invalidate cached reads; Calendar
  Refresh bypasses cached data. On sign-out or account changes, clear caches and
  transient forms and cancel outstanding cached requests. Do not persist personal
  records or Calendar events in browser storage for this cache.
- AI/Brain Dump, automatic prioritization, MCP, schedulers, outbound notifications,
  People, Obsidian sync, collaboration, mobile-specific layouts, advanced
  recurrence, and legacy import remain outside scope unless requested. Deliver
  usable slices incrementally; personal use does not need a commercial launch gate.

## Architecture and privacy

- Use React/Vite, Supabase Auth/Postgres/RLS, and Vercel Functions. Develop
  locally and release to the existing personal app; no separate Preview setup.
- Browser CRUD uses the authenticated session and RLS. Google credentials stay
  server-only in the private schema. Never commit credentials or personal data.
- Every user-owned public table needs tested RLS; project references enforce the
  same owner. Derive request ownership from the validated session, not a supplied
  user ID. Browser roles cannot access the private schema or service-role keys.
- Calendar uses separate explicit OAuth consent with read-only scopes, exact
  callbacks, and one-time user-bound state. Encrypt refresh tokens; preserve a
  valid stored token when Google omits a replacement. Keep secrets and personal
  content out of logs. See `docs/CALENDAR.md` for integration details.
- Do not persist Google event bodies in Supabase or use shared public caches for
  personal data. Bound list queries and pagination; any server Calendar cache is
  user-specific and lasts no more than five minutes.
- Preserve legacy Python source and data; do not extend them for new features.
  Import legacy data only when requested and the relevant cloud collections are
  verified. Retire the legacy runtime only after cloud verification and approval.

## Working in this repository

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
