# orbitOS — Cloud Product Specification

**Status:** Approved product direction; implementation pending

**Last updated:** 2026-09-03

**Supersedes:** The Obsidian, SQLite, Telegram, Anthropic, Brain Dump, ChatGPT Scheduled Task, MCP, VPS, and always-on-process designs

## 1. Product definition

orbitOS is a private organizational and collection hub. Its job is to keep personal commitments and reference items visible in one place so the user does not have to hold them in working memory.

The application does not prioritize work or decide what the user should do next. The user remains responsible for judgment and prioritization. orbitOS provides a dependable agenda, a complete todo workspace, and small collections for Ideas, Media, and Projects.

All records are added manually. There is no Brain Dump, automated sifting, Needs Review queue, model integration, or scheduled processing.

## 2. Locked decisions

| Area | Decision |
|---|---|
| Product shape | Standalone personal web app; Obsidian is not part of the replacement |
| Hosting | Vercel for the React app and server-only Calendar endpoints |
| Canonical database | Supabase Postgres |
| Authentication | Google sign-in through Supabase Auth; every user-owned row is protected by Row Level Security (RLS) |
| Organization | Todos, Ideas, Media, and Projects |
| Capture | Manual entry through contextual Add controls and one global **+ Add** action |
| Media | Books and movies share one Media section and table, distinguished by type |
| People | Removed |
| Brain Dump and AI | Removed; no ChatGPT, Anthropic, model API, MCP, or scheduled sifting dependency |
| Home | Desktop split view: Google Calendar-style weekly calendar on the left and Today todos on the right |
| Calendar week | Monday through Sunday |
| Calendar permissions | Read-only; selecting an event opens Google Calendar |
| Calendar visibility | All calendars visible by default; individual calendars can be hidden in Settings |
| Today eligibility | Every incomplete todo with `due_date <= today` in the user's timezone |
| Overdue behavior | Original due date remains unchanged; overdue todos continue appearing in Today until completed or rescheduled |
| Today ordering | Default overdue-first ordering; the user can drag to create a persistent manual order |
| Todos workspace | The complete todo board remains a separate `/todos` page |
| Notifications | No Telegram, email, push, or SMS notifications from orbitOS |
| Mobile | Mobile behavior is not designed or included in the initial implementation scope |
| Historical migration | Existing SQLite and Obsidian data are migrated only after the replacement is stable |

## 3. Product goals

1. Make it difficult to lose track of a commitment once it has been entered.
2. Show the current week and today's actionable todos without switching applications.
3. Keep manual entry fast and available from anywhere in the app.
4. Keep the organizational model small and predictable.
5. Preserve the user's control over priority and ordering.
6. Make Calendar integration useful without granting Calendar write access.
7. Run entirely in managed cloud infrastructure without an always-on personal computer.

## 4. Non-goals for the initial release

- Automatic prioritization, recommendations, productivity scoring, or a suggested “Now” task
- Brain Dump capture, LLM extraction, scheduled processing, or model API usage
- Writing to, modifying, or deleting Google Calendar events
- Placing todos inside the Calendar time grid
- Telegram or other outbound notifications
- Contact or people management
- Obsidian or filesystem synchronization
- Collaborative workspaces, sharing, or team administration
- Mobile or tablet-specific layouts
- Native mobile applications
- Advanced recurring-task behavior until it is separately specified
- Importing legacy data before the cloud replacement reaches feature parity

## 5. Target architecture

```text
+-------------------------+
| Browser                 |
| React + TypeScript SPA  |
+------------+------------+
             |
             | user JWT + RLS
             v
+-------------------------+                 +-------------------------+
| Supabase                |                 | Vercel Functions        |
| - Postgres              |<----------------+ - Google OAuth routes   |
| - Auth                  | server-only     | - Calendar event proxy  |
| - RLS                   | status/prefs    | - connection health     |
| - public app schema     |                 +------------+------------+
| - private token schema  |                              |
+-------------------------+                              | read-only OAuth
                                                         v
                                              +-------------------------+
                                              | Google Calendar API     |
                                              +-------------------------+
```

The target system has no local-filesystem dependency, scheduler, polling bot, persistent server process, or application-owned model integration.

### 5.1 Target stack

- **Frontend:** existing React, TypeScript, and Vite application, deployed to Vercel.
- **Application data:** Supabase Postgres.
- **Authentication:** Supabase Auth.
- **Routine CRUD:** direct Supabase client access using the authenticated user's JWT and RLS.
- **Atomic domain actions:** Postgres functions where one operation must update multiple records or preserve ordering.
- **Secret-bearing operations:** TypeScript Vercel Functions.
- **Calendar integration:** Google OAuth and Google Calendar REST API through Vercel Functions.

The existing Python/FastAPI service may remain during the transition, but it is not part of the target deployment. It is retired only after the cloud app is verified.

## 6. Navigation and global interaction

The primary destinations are:

- Home
- Todos
- Ideas
- Media
- Projects

Settings is accessed from the account menu rather than competing with the primary destinations.

One global **+ Add** action is available throughout the authenticated app. It offers:

- Todo
- Idea
- Media
- Project
- Calendar event

The first four choices open compact orbitOS forms. **Calendar event** opens Google Calendar's event composer in a new tab; orbitOS does not submit the event through the Calendar API. Each collection also retains its own contextual Add action.

A global search searches orbitOS Todos, Ideas, Media, and Projects. Google Calendar events are not indexed or included in global search in the initial release.

## 7. Home — `/`

### 7.1 Desktop layout

Home is a full-width desktop operating surface with two adjacent panels:

```text
+------------------------------------------------------+------------------+
| Weekly Calendar                                     | Today            |
| Monday through Sunday                               | incomplete todos |
| all-day row + hourly grid                           | due today or     |
| Google Calendar events only                         | overdue          |
| approximately 70–75% of width                       | 25–30% of width  |
+------------------------------------------------------+------------------+
```

The Calendar and Today panels load independently. Calendar failure must not delay or disable the Today list.

The initial release is designed for desktop. Mobile rearrangement, tab behavior, and compact Calendar treatment are explicitly deferred.

### 7.2 Weekly Calendar panel

The Calendar panel follows the information structure of Google Calendar's weekly view without copying Google's visual branding.

It includes:

- Monday–Sunday day columns.
- Previous week, next week, and Today controls.
- A timezone label.
- An all-day event row.
- A vertically scrollable hourly grid.
- Timed events positioned by start and end time.
- Overlapping-event layout.
- Calendar-specific event colors.
- A distinct current-day header.
- A current-time indicator when the visible week contains today.
- Read-only event selection that opens Google's returned event link in a new tab.

The initial scroll position should make the user's normal daytime hours immediately visible while allowing access to the full day.

### 7.3 Today todo panel

The Today panel contains every todo satisfying:

```text
completed = false
deleted_at is null
due_date is not null
due_date <= local_today(profile.timezone)
```

Important behavior:

- A todo does not have its due date silently changed when it becomes overdue.
- Overdue tasks automatically remain in Today on every subsequent day.
- The default order places overdue tasks before tasks due today, with older due dates first.
- The user can drag todos into a preferred order; that explicit order persists across reloads.
- Newly qualifying tasks enter a deterministic default position until the user reorders them.
- Completion removes a todo from Today immediately.
- Rescheduling it to a future date removes it from Today immediately.
- The panel supports inline completion, editing, rescheduling, deletion with undo, and Add task.
- The panel does not hide or summarize overdue tasks merely because the list becomes long; it scrolls independently.

The Today panel is an organizational list, not an automatic priority recommendation.

## 8. Todos — `/todos`

The separate Todos page is the complete task-management workspace.

It contains:

- A permanent Inbox for todos without a due date.
- An explicit Overdue area so past-due work never disappears from the full workspace.
- Current-week columns from today through Sunday.
- Navigated-week columns from Monday through Sunday.
- Previous week, next week, and Today controls.
- Manual Add controls in Inbox and each date column.
- Completion, editing, due date, optional due time, deletion with undo, and optional project association.

Date-only todos and timed todos use separate database fields. A date-only todo must not shift dates due to UTC conversion or daylight-saving changes.

The Home Today ordering is allowed to differ from the date-column ordering on the full Todos page because it represents the user's chosen working order for the accumulated Today list.

## 9. Ideas — `/ideas`

Ideas are lightweight manual records with:

- Optional title.
- Required body.
- Optional project association.
- Created and updated timestamps.

Ideas do not require a workflow status in the initial release.

## 10. Media — `/media`

Media combines books and movies. Each record contains:

- `media_type`: Book or Movie.
- Required title.
- Optional creator, release year, rating, and notes.
- Status: Saved, In Progress, or Finished.

Book and Movie filters operate over the same collection rather than separate pages or tables.

## 11. Projects — `/projects`

Projects represent ongoing outcomes rather than single actions. Each project has:

- Required title.
- Optional description.
- Status: Active, Someday, Completed, or Archived.
- Related todos and ideas.

A project detail view shows its incomplete and completed todos plus associated ideas.

## 12. Settings — `/settings`

Settings includes:

- Google Calendar connection, disconnection, and reconnection status.
- A list of the user's Google calendars with visibility toggles.
- All newly discovered calendars visible by default.
- Account sign-out.
- The configured timezone.
- Later data export and account-deletion controls.

## 13. Data model

All public application tables use UUID primary keys, `user_id`, `created_at`, and `updated_at`. Every user-owned public table has RLS enforcing ownership. Timestamps are stored as UTC; date-only values remain SQL `date` values.

### 13.1 `profiles`

| Column | Notes |
|---|---|
| `user_id` | Primary key; references the Supabase Auth user |
| `timezone` | IANA timezone; default `America/New_York` |

### 13.2 `todos`

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `user_id` | Owner |
| `text` | Required task text |
| `completed` | Boolean |
| `completed_at` | Nullable timestamp |
| `due_date` | Nullable SQL `date` |
| `due_time` | Nullable SQL `time`; meaningful only when `due_date` is present |
| `project_id` | Nullable same-owner project reference |
| `today_rank` | Nullable sortable value used after explicit Today reordering |
| `source` | `manual` or later `migration` |
| `legacy_id` | Nullable stable identifier used only by the migration |
| `deleted_at` | Nullable soft-deletion timestamp |

The database rejects `due_time` when `due_date` is null. Completing a todo sets `completed_at`; restoring it clears `completed_at`.

### 13.3 `ideas`

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `user_id` | Owner |
| `title` | Optional concise title |
| `body` | Required idea text |
| `project_id` | Nullable same-owner project reference |
| `source` | `manual` or later `migration` |
| `legacy_id` | Nullable migration identifier |
| `deleted_at` | Nullable soft-deletion timestamp |

### 13.4 `media`

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `user_id` | Owner |
| `media_type` | `book` or `movie` |
| `title` | Required |
| `creator` | Optional author, director, or other creator |
| `release_year` | Optional integer |
| `status` | `saved`, `in_progress`, or `finished` |
| `rating` | Optional user rating |
| `notes` | Optional |
| `source` | `manual` or later `migration` |
| `legacy_id` | Nullable migration identifier |
| `deleted_at` | Nullable soft-deletion timestamp |

### 13.5 `projects`

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `user_id` | Owner |
| `title` | Required |
| `description` | Optional |
| `status` | `active`, `someday`, `completed`, or `archived` |
| `source` | `manual` or later `migration` |
| `legacy_id` | Nullable migration identifier |
| `deleted_at` | Nullable soft-deletion timestamp |

### 13.6 Google Calendar public tables

`google_calendar_connections` contains only browser-safe status:

- `user_id`
- Google account identifier and display email
- Connection state
- Granted scope names
- Last successful refresh timestamp
- Created and updated timestamps

`google_calendar_preferences` stores:

- `user_id`
- Google calendar identifier
- Display name and color metadata
- `is_visible`, defaulting to true
- Last-seen timestamp

### 13.7 Private integration tables

A non-exposed `private` schema stores:

- Encrypted Google refresh tokens and token metadata.
- One-time Google OAuth transactions containing a hashed state value, user ID, expiration, and consumption timestamp.
- Secret-rotation metadata when required.

The browser roles have no grants on the private schema. RLS alone is not treated as column-level protection.

Google event bodies are not persisted in Supabase in the initial release.

### 13.8 Constraints and indexes

- `todos` is indexed by `(user_id, completed, due_date)` with deleted rows excluded where practical.
- Ideas, Media, and Projects are indexed for user-owned list and search queries.
- `legacy_id` is unique per user and record type when present.
- Project relationships enforce matching ownership through composite constraints or constraint triggers.
- Calendar preferences are unique by `(user_id, calendar_id)`.
- Soft-deleted rows are excluded from ordinary reads.

## 14. Shared application contracts

### 14.1 `CalendarEvent`

The server normalizes Google events once into a typed contract containing:

- Stable event and calendar identifiers.
- Title.
- All-day versus timed discriminator.
- Date or timestamp start and end values.
- Calendar color.
- Google event link.

The frontend does not independently reinterpret raw Google event payloads.

### 14.2 `WeekViewModel`

The Home Calendar receives a Monday–Sunday range, timezone, normalized events, visible-calendar metadata, and partial-error information in one response.

### 14.3 `TodayTodo`

The Today list uses a shared todo representation containing due-date status, optional time, completion state, project summary, and persistent Today order.

### 14.4 Service boundary

- Browser-to-Supabase: authenticated manual CRUD, list queries, and search under RLS.
- Browser-to-Postgres function: atomic Today reordering and multi-row domain actions.
- Browser-to-Vercel: Calendar connect, callback, disconnect, calendars, events, and connection health.
- Vercel-to-private schema: encrypted Calendar credentials only.

No browser or Calendar request accepts a caller-supplied `user_id`; ownership comes from the validated Supabase session.

## 15. Google Calendar integration

### 15.1 Authorization

Calendar connection is a separate, explicit Google OAuth flow even if application sign-in also uses Google.

Requested permissions are limited to:

- Read the user's Calendar list.
- Read Calendar events.

The server:

- Uses an opaque, one-time OAuth state value bound to the authenticated user.
- Validates exact callback origins and redirect URIs.
- Requests offline access so it can refresh access tokens.
- Encrypts refresh tokens before storage.
- Never returns tokens to the browser or logs them.
- Handles Google responses that omit a new refresh token without overwriting the stored valid token.

The OAuth application must not rely on Testing-mode refresh tokens for normal use.

### 15.2 Event retrieval

The Calendar endpoint:

- Fetches the selected Monday–Sunday window only.
- Requests events only for calendars marked visible.
- Handles pagination with bounded concurrency.
- Cancels upstream work when the browser request is abandoned where the runtime permits.
- Normalizes all-day and timed events without losing timezone semantics.
- Returns partial-calendar errors without discarding successfully loaded calendars.
- Uses a private, user-specific cache for no more than five minutes if caching is enabled.

Calendar responses must never use a shared public cache containing personal event data.

## 16. Authentication, privacy, and security

- Anonymous application use is disabled in production.
- Supabase Auth owns identities and sessions.
- Every public user-owned table enables and tests RLS before personal data is entered.
- Public browser keys are used only with authenticated user JWTs and RLS.
- The Supabase service-role key, Google client secret, and token-encryption keys exist only in server environments.
- Logs contain record identifiers, timing, counts, and sanitized errors—not todo text, idea bodies, notes, tokens, or Calendar descriptions.
- Sign-out clears user-specific application caches and transient form state.
- Environment-specific OAuth clients and callback URLs are used for Development, Preview, and Production.
- Security headers and a Content Security Policy are configured before launch.

## 17. Failure and recovery behavior

| Failure | Required behavior |
|---|---|
| Supabase read fails | Preserve the current screen when safe, show a retry state, and do not display false empty results |
| Supabase write fails | Preserve form input and roll back optimistic UI |
| Calendar request fails | Keep Today fully usable and show Calendar retry/reconnect state |
| One visible calendar fails | Render successfully loaded calendars and identify the partial failure |
| Google authorization is revoked | Clear unusable server credentials and request reconnection |
| Today reorder fails | Restore the prior order and explain that the order was not saved |
| Delete is accidental | Offer immediate Undo through soft deletion |
| Search fails | Preserve the query and offer retry without clearing the current page |

orbitOS sends no external failure notification in the initial release.

## 18. Accessibility, privacy, and performance

- All primary desktop flows are keyboard accessible.
- Drag reordering has keyboard-accessible Move up and Move down alternatives.
- Status and Calendar identity are not communicated by color alone.
- Interactive controls meet WCAG 2.2 AA contrast and focus requirements.
- Calendar events expose meaningful accessible names including title and time.
- Home renders the Today panel without waiting for Google Calendar.
- Calendar event layout remains usable at 200% browser zoom within the supported desktop scope.
- Section lists use bounded queries and pagination.
- The UI does not display raw technical error messages.

## 19. Acceptance criteria

The replacement is ready for normal use when all of the following are true:

1. A user can authenticate and manually create, edit, soft-delete, restore, and search orbitOS records.
2. The global **+ Add** action creates Todos, Ideas, Media, and Projects from every authenticated route.
3. The Home desktop layout shows a Monday–Sunday weekly Calendar on the left and Today todos on the right.
4. Google Calendar connects with read-only scopes; all calendars begin visible and hidden choices persist.
5. Calendar events render in all-day and timed positions and open their Google Calendar links.
6. The Calendar panel can fail or load slowly without blocking Today.
7. Today contains all incomplete, non-deleted todos due today or earlier in the user's timezone.
8. An overdue todo retains its original due date and remains in Today until completed or rescheduled.
9. Today defaults to overdue-first and preserves an explicit drag or keyboard reorder after reload.
10. Completing or future-rescheduling a todo removes it from Today immediately.
11. The separate Todos page includes Inbox, Overdue, the current-week remainder, and Monday–Sunday navigated weeks.
12. Date-only todos do not shift because of UTC conversion or daylight-saving changes.
13. RLS isolation tests pass for every public user-owned table, and browser roles cannot access the private schema.
14. Google tokens and Calendar descriptions do not appear in browser storage or application logs.
15. The frontend passes type checking, automated tests, accessibility checks, and a production Vercel build.
16. The deployed app requires no Python service, SQLite database, Obsidian vault, Telegram bot, scheduler, MCP server, or model API key.

## 20. Authoritative references

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Google Calendar API authorization scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Google OAuth for web-server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth security best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Google Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
