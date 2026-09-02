# orbitOS Cloud Rebuild — Implementation Plan

**Based on:** [SPEC.md](SPEC.md)

**Planning date:** 2026-09-02

**Delivery strategy:** build the manual organizational hub in goal-bearing vertical slices; make the Calendar/Today Home usable early; migrate legacy data only after the replacement is stable

## 1. Delivery principles

1. **The product is organizational, not prescriptive.** The app makes commitments visible and searchable but does not rank priorities or choose a next task.
2. **Manual entry is canonical.** There is no Brain Dump, sifting workflow, ChatGPT task, MCP server, or model API.
3. **One canonical cloud database.** New production data is written only to Supabase; there is no SQLite/Supabase dual-write period.
4. **The desktop Home is a core slice.** A Monday–Sunday Calendar and accumulated Today list are implemented before secondary collections are polished.
5. **Security ships with the schema.** RLS, private token storage, ownership constraints, and OAuth callback protection precede personal data.
6. **Accessibility is continuous.** Keyboard behavior, zoom, focus, status feedback, and non-color cues are exit criteria in each interface phase.
7. **Preserve the current system during transition.** Existing Python and SQLite files are not destructively removed until cloud verification and explicit cleanup approval.
8. **Every phase ends in a demonstrable outcome.** File creation alone does not complete a phase.

## 2. Target repository and runtime boundaries

The target repository should have one deterministic Node/Vercel boundary rather than a Vite frontend that still assumes FastAPI owns `/api`.

```text
package.json                    # root workspace and shared scripts
tsconfig.server.json            # server/function TypeScript
vercel.json
frontend/
  package.json
  src/
    components/
      app-shell/
      global-add/
      search/
    features/
      calendar/
      today/
      todos/
      ideas/
      media/
      projects/
    lib/
      supabase.ts
      api.ts
    types/
      database.ts
      domain.ts
api/
  health.ts
  calendar/
    connect.ts
    callback.ts
    disconnect.ts
    calendars.ts
    events.ts
server/
  auth/
  calendar/
  env/
  validation/
supabase/
  migrations/
  tests/
tests/
  contract/
  e2e/
SPEC.md
IMPLEMENTATION_PLAN.md
```

Files under `api/` are thin Vercel handlers. Reusable secret-bearing logic belongs under `server/`. Database changes are migrations, not dashboard-only edits.

### Runtime access rules

| Path | Responsibility |
|---|---|
| Browser → Supabase | Authenticated manual CRUD, lists, and search under RLS |
| Browser → Postgres functions | Atomic Today ordering and multi-record operations |
| Browser → Vercel Functions | Google connect, callback, disconnect, calendars, events, and connection health |
| Vercel Functions → private schema | Encrypted Google credentials and OAuth state only |
| Vercel Functions → Google | Read-only Calendar-list and event requests |

## 3. Phase 0 — Cloud foundation

**Outcome:** a clean checkout can run and deploy the React app, Vercel functions, and Supabase project without depending on FastAPI.

### Build

- Add a root npm workspace covering `frontend` and server/function code.
- Add root scripts for development, type checking, tests, generated database types, and production build.
- Add a server TypeScript configuration and test runner.
- Configure Vercel to build the Vite frontend, serve its output, preserve SPA deep links, and route `/api/*` to functions.
- Add Supabase local-development configuration and migration directories.
- Create isolated Development, Preview, and Production environment conventions.
- Add typed environment validation that fails without revealing secret values.
- Add `/api/health` for safe deployment diagnostics.
- Replace the current Vite-to-FastAPI proxy only after the new local function workflow is verified.

### Environment contract

| Variable | Exposure | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Browser-safe | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Browser-safe | Public key used with authenticated JWT and RLS |
| `SUPABASE_URL` | Server only | Server-side project URL |
| `SUPABASE_ANON_KEY` | Server only | User-scoped server calls where needed |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Narrow private-schema operations only |
| `APP_URL` | Server only | Canonical application and callback origin |
| `GOOGLE_CLIENT_ID` | Server only | Calendar OAuth client |
| `GOOGLE_CLIENT_SECRET` | Server only | Calendar OAuth secret |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Server only | Refresh-token encryption |

No model API, MCP, Telegram, vault, or scheduler secret is part of the target environment.

### Verify

- One documented command starts the frontend, local functions, and local Supabase dependencies.
- Preview deployments use non-production data and OAuth callbacks.
- Browser bundles contain no server-only secret.
- Authenticated SPA deep links survive refresh.
- The existing local application still remains recoverable during transition.

### Exit criteria

- Local and Preview builds succeed from a clean checkout.
- `/api/health` reports safe configuration status.
- The new runtime no longer requires the FastAPI proxy for target features.

## 4. Phase 1 — Authentication, schema, RLS, and shared contracts

**Outcome:** the cloud data model is secure and supports manual records, Today accumulation, Calendar status, and search.

### Database migrations

- Create public tables:
  - `profiles`
  - `todos`
  - `ideas`
  - `media`
  - `projects`
  - `google_calendar_connections`
  - `google_calendar_preferences`
- Create the non-exposed private schema and tables for:
  - Encrypted Google credentials
  - One-time OAuth transactions
  - Token-rotation metadata if required
- Add enums, checks, ownership constraints, indexes, timestamps, and soft deletion.
- Add a profile-creation trigger for new Supabase Auth users.
- Use `due_date date` and optional `due_time time`; reject a due time without a date.
- Add `today_rank` or an equivalent persistent ordering mechanism.
- Add same-owner project relationships through composite constraints or constraint triggers.
- Add search indexes and one user-scoped search function or view across Todos, Ideas, Media, and Projects.
- Generate TypeScript database types after every migration change.

### Atomic functions

- Implement Today-list retrieval using the user's configured timezone and an explicit local date.
- Implement deterministic placement for todos newly entering Today.
- Implement atomic Today reordering with ownership validation.
- Implement soft-delete and restore semantics.
- Ensure completion and rescheduling immediately remove ineligible tasks from Today results.

### Authentication

- Implement sign-in, sign-out, session restoration, route protection, and expired-session handling.
- Choose the initial sign-in method during this phase; Calendar authorization remains a separate consent flow.
- Clear user-specific caches and transient form state on sign-out.

### Security tests

- User A can CRUD their own records.
- User A cannot select, insert, update, delete, reorder, or relate User B records.
- Anonymous requests cannot access personal tables.
- Browser roles cannot access the private schema or encrypted credentials.
- A todo or idea cannot reference another user's project.
- Soft-deleted records are absent from ordinary queries and search.
- Migrations apply cleanly to and roll back from a disposable database.

### Exit criteria

- RLS allow/deny tests cover every public table and atomic function.
- Generated types compile.
- A fresh authenticated user receives a profile with the correct default timezone.

## 5. Phase 2 — App shell, global Add, and complete Todos

**Outcome:** the app works as a secure manual todo system before Calendar is connected.

### App shell

- Replace the current split shell behavior with one authenticated desktop shell.
- Add primary navigation for Home, Todos, Ideas, Media, and Projects.
- Place Settings and sign-out in the account menu.
- Add the global **+ Add** action on every authenticated route.
- Add consistent loading, empty, error, optimistic-update, and Undo patterns.
- Keep data access in typed feature services rather than page components.

### Global Add — Todo slice

- Implement the compact Todo form first.
- Support text, optional due date, optional due time, and optional project.
- Preserve entered values when a write fails.
- Return focus to the invoking control after cancel or success.

### Full Todos page

- Port the existing Todo board to Supabase UUID and field shapes.
- Preserve the permanent Inbox for undated tasks.
- Add an explicit Overdue area.
- Preserve current-week behavior from today through Sunday.
- Preserve Monday–Sunday navigated weeks and the Today reset.
- Add editing, completion, soft delete with Undo, restore, date/time changes, and project association.
- Ensure empty columns foreground Add task rather than explanatory filler text.

### Today-list domain slice

- Query all incomplete todos whose due date is today or earlier.
- Preserve the original due date when overdue.
- Implement default overdue-first ordering.
- Implement persistent drag reordering.
- Provide keyboard Move up and Move down alternatives.
- Verify completion and future rescheduling remove the task immediately.
- Build the Today list as a reusable component for the right side of Home.

### Verify

- A task due yesterday remains visible on Today and in the Todos Overdue area.
- A date-only task remains on the same local date across UTC and daylight-saving boundaries.
- Manual Today order survives reload.
- Newly eligible tasks enter a deterministic position without erasing the user's saved order.
- Reorder failure restores the prior order.
- The complete flow works keyboard-only and at 200% desktop zoom.

### Exit criteria

- Manual todo management is production-shaped without Calendar.
- Today accumulation cannot silently lose overdue tasks.
- The old numeric-ID and `done`/`due` assumptions have been removed from the new data layer.

## 6. Phase 3 — Read-only Google Calendar service

**Outcome:** an authenticated user can safely connect Google Calendar and retrieve a normalized Monday–Sunday week.

### OAuth flow

- Create separate Google OAuth clients for Development and Production; use an isolated Preview strategy.
- Request only Calendar-list read and event read scopes.
- Implement connect, callback, disconnect, and reconnect routes.
- Generate an opaque one-time state value and store only its hash with user, expiry, and consumption state.
- Bind the callback to the authenticated Supabase session and exact redirect URI.
- Request offline access.
- Encrypt refresh tokens before private-schema storage.
- Preserve an existing valid refresh token when Google does not return a replacement.
- Clear invalid credentials and expose a reconnect state when access is revoked.
- Move the OAuth consent configuration out of Testing before relying on long-lived refresh.

### Calendar list and preferences

- Retrieve all calendars visible to the Google account.
- Upsert browser-safe calendar display metadata.
- Default every newly discovered calendar to visible.
- Add Settings toggles to hide individual calendars.
- Keep encrypted credentials inaccessible to browser roles.

### Week events endpoint

- Accept a validated Monday date and derive the Monday–Sunday window server-side.
- Load only calendars marked visible.
- Handle Google pagination with bounded concurrency.
- Normalize raw events into the shared `CalendarEvent` type.
- Preserve all-day date semantics and timed-event timezone semantics.
- Return partial errors alongside successfully loaded calendars.
- Avoid shared public caching; use only user-specific short-lived caching if proven necessary.
- Never log event titles or descriptions.

### Contract tests

- Invalid, expired, reused, or wrong-user OAuth state is rejected.
- Exact callback and origin validation is enforced.
- No Calendar write scope or mutation request exists.
- Token refresh succeeds after access-token expiry.
- Revoked authorization becomes a reconnect response.
- All-day, timed, recurring-instance, canceled, paginated, and overlapping events normalize correctly.
- One calendar failure does not discard other calendar results.

### Exit criteria

- Calendar authorization and a real week fetch work in Preview or a controlled development deployment.
- Security inspection confirms tokens never reach the browser.
- Calendar preferences persist across sessions.

## 7. Phase 4 — Desktop Home: weekly Calendar plus Today

**Outcome:** the primary product surface matches the confirmed side-by-side desktop brief.

### Weekly Calendar panel

- Replace the current orbital Home navigation with a weekly Calendar operating surface.
- Render Monday–Sunday columns.
- Add previous week, next week, and Today controls.
- Add a sticky day header and all-day row.
- Add a vertically scrollable hourly grid and timezone label.
- Position timed events by start and duration.
- Lay out overlapping events without hiding their titles and times.
- Preserve Calendar-specific colors while retaining text/non-color identification.
- Highlight the current day and render a current-time line in the active week.
- Open Google's event link in a new tab when an event is selected.
- Use a mature week-grid library only if it meets styling, accessibility, timezone, all-day, overlap, and read-only requirements; otherwise implement the grid directly.

### Today panel

- Place the reusable Today todo list to the right of the Calendar.
- Use approximately 70–75% Calendar width and 25–30% Today width.
- Keep the Today panel visible and independently scrollable.
- Support completion, editing, rescheduling, soft delete/Undo, Add task, drag reorder, and keyboard reorder.
- Preserve overdue-first default behavior without presenting it as a priority recommendation.
- Do not truncate or hide overdue tasks when the list becomes long.

### Independent loading

- Render Today as soon as Supabase responds.
- Load Calendar separately.
- Show connect, loading, partial-error, retry, and reconnect states inside the Calendar panel only.
- Never replace the complete Home screen with a Calendar spinner or error.

### Desktop design verification

- Validate typical weeks with 0, 5, 20, and 50+ events.
- Validate Today with 0, 5, 20, and 100 accumulated tasks.
- Validate overlapping events, long titles, all-day overflow, DST boundaries, and midnight-spanning events.
- Verify keyboard navigation, focus order, event accessible names, reorder alternatives, and status announcements.
- Inspect representative desktop widths and 200% browser zoom.
- Do not invent or implement a mobile transformation in this phase.

### Exit criteria

- The Home page visibly matches the confirmed Monday–Sunday side-by-side structure.
- Today remains fully usable during Calendar failure.
- Overdue todos remain present until completed or rescheduled.
- Calendar events remain read-only and open in Google Calendar.

## 8. Phase 5 — Ideas, Media, Projects, global Add, and search

**Outcome:** all four collections are manually usable and retrievable without remembering where an item was stored.

### Ideas

- Implement list, create, edit, soft delete/Undo, and optional project association.
- Support titleless ideas with a safe display excerpt.

### Media

- Replace separate Books and Movies routes with one Media route.
- Add Book/Movie filtering.
- Add Saved, In Progress, and Finished states.
- Keep creator, year, rating, and notes optional.

### Projects

- Add Active, Someday, Completed, and Archived lists.
- Add project detail with related incomplete/completed todos and ideas.
- Prevent cross-user relationships at both UI and database layers.

### Global Add completion

- Add compact forms for Idea, Media, and Project.
- Add Calendar event as an external action that opens Google Calendar's composer.
- Retain contextual Add controls inside each section.

### Search

- Add one global search action available from the shell.
- Search Todos, Ideas, Media, and Projects with user ownership and soft-deletion filters.
- Group results by type while keeping the result count and query visible.
- Link directly to the matching record or section context.
- Do not imply that Google Calendar events are searched.

### Exit criteria

- All four record types support complete manual CRUD.
- Global Add works from every authenticated route.
- Search finds representative records across every orbitOS collection.
- Books and Movies no longer require separate data models or routes.

## 9. Phase 6 — Hardening, deployment, and launch

**Outcome:** the cloud application is safe and dependable for personal production data.

### Quality and security

- Complete unit tests for date logic, ordering, event normalization, search mapping, and validation.
- Complete RLS and database-function integration tests.
- Complete Calendar OAuth/token contract tests.
- Add end-to-end tests for sign-in, global Add, Today accumulation, reorder, full Todos, Calendar connection/preferences, Home, search, and sign-out.
- Add Content Security Policy and platform security headers.
- Verify production logs redact record contents, tokens, and Calendar descriptions.
- Add bounded pagination to collection pages and search.
- Configure production error monitoring without personal-content capture.
- Document backup, restore, secret rotation, account recovery, Calendar reconnection, and incident steps.
- Update README and deployment documentation to describe the Vercel/Supabase architecture.

### Launch checklist

- All acceptance criteria in `SPEC.md` §19 pass.
- Type checking, automated tests, accessibility checks, and the production build pass from a clean checkout.
- Production RLS has been tested with two isolated test users.
- Browser roles cannot access the private schema.
- Development, Preview, and Production do not share personal data or OAuth credentials.
- Google refresh and revocation behavior have been tested.
- The Home Calendar cannot block Today rendering.
- A database backup exists and a restore has been rehearsed.
- No obsolete model, Telegram, vault, or scheduler secret exists in cloud environments.

### Rollback

Before legacy migration, rollback means returning to the existing local deployment. No reverse synchronization is promised. After the cloud app becomes canonical, database recovery uses backups and forward-fix migrations rather than destructive repository resets.

## 10. Phase 7 — Legacy migration and retirement

This phase starts only after stable cloud use and explicit migration approval.

### Inventory and mapping

- Create a read-only backup of SQLite and relevant Obsidian source material.
- Record table counts, exports, checksums, and schema versions.
- Approve the mapping before import:
  - Legacy todos → Todos
  - Legacy books and movies → Media
  - Legacy projects → Projects
  - Potential writing records → Ideas only after review
  - People → archived export; there is no People collection
  - Scanner state, Telegram drafts, and stale proposals → not imported by default
- Map numeric legacy IDs to stable UUID records through `legacy_id`.
- Convert legacy `done` and `due` fields into `completed`, `due_date`, and optional `due_time` without date shifting.

### Rehearse and execute

- Run the importer against a disposable Supabase project.
- Compare counts, rejected rows, date conversions, completion state, relationships, and representative samples.
- Resolve mapping exceptions before production import.
- Run the production import and rerun it to prove idempotency.
- Keep the original backup read-only for an agreed retention period.

### Retire

- Disable the VPS service, APScheduler, Telegram bot, and Obsidian scanner.
- Remove obsolete production secrets.
- Archive or remove the Python backend and deployment files only after backup and cloud verification and with explicit cleanup approval.
- Mark Supabase as the sole canonical database.

### Exit criteria

- Every approved legacy row is imported, intentionally skipped, or rejected with a recorded reason.
- The deployed app runs without Python, SQLite, Telegram, Obsidian, Anthropic, OpenAI, MCP, a scheduler, or an always-on personal computer.

## 11. Test matrix

| Layer | Minimum coverage |
|---|---|
| Database | Migrations, constraints, same-owner relationships, RLS, soft deletion, Today eligibility/order, search |
| Calendar service | OAuth state, exact redirects, token encryption/refresh/revocation, pagination, normalization, partial failure |
| Frontend | Auth restoration, global Add, optimistic rollback, Undo, full Todos, Today, collections, search, desktop accessibility |
| Home | Monday–Sunday grid, all-day/timed/overlap layout, current time, Calendar independence, accumulated Today list |
| End to end | Sign in → add task → overdue/Today → reorder/complete; connect Calendar → choose calendars → render week |
| Operations | Clean build, environment isolation, logging redaction, backup/restore, secret rotation, rollback |

## 12. Explicitly deferred decisions

These are not required to begin the approved rebuild:

- Initial sign-in method: Google sign-in or email magic link.
- Supabase and Vercel production region.
- Production domain.
- Media rating scale.
- Advanced recurring-task behavior.
- Exact default visible-hour range for the weekly Calendar.
- Mobile and tablet layouts.

None of these deferred choices should reintroduce Brain Dump automation, model integration, Calendar write access, or automatic task prioritization without a new explicit product decision.
