# Workspace data model

The core workspace tables and the rules the browser must respect. Classes,
notes, and assignments have their own document:
[Classes data model](CLASSES_DATA_MODEL.md). Today reads and ordering have
[Today data protocol](TODAY_DATA_PROTOCOL.md).

Everything below is defined in
`supabase/migrations/20260902000100_initial_cloud_schema.sql` and
`supabase/migrations/20260902000200_domain_functions.sql` unless another
migration is named.

## Tables

### `public.profiles`

One row per `auth.users` row, created by the `private.handle_new_user` trigger.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` primary key | References `auth.users(id)` on delete cascade. |
| `timezone` | `text` | Defaults to `America/New_York`. A trigger rejects names absent from `pg_timezone_names`. |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` maintained by trigger. |

The browser may select the row and update only `timezone`. Changing the timezone
serializes against Today ordering and clears ranks that are no longer eligible.

### `public.todos`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` primary key | |
| `user_id` | `uuid` | Defaults to `auth.uid()`. |
| `text` | `text` | Must not be blank. |
| `completed`, `completed_at` | `boolean`, `timestamptz` | Kept consistent by `private.sync_todo_state`; the browser never writes `completed_at`. |
| `due_date` | `date` | Date only. See below. |
| `due_time` | `time without time zone` | Allowed only when `due_date` is set. |
| `project_id` | `uuid` | Composite foreign key on `(user_id, project_id)`, so a task can only reference the same owner's project. Set to null when the project is hard-deleted; a trigger also requires the project to be active. |
| `today_rank` | `bigint` | Manual Today order. Positive when set. Cleared on completion, delete, and ineligible due-date changes. |
| `source`, `legacy_id` | enum, `text` | `legacy_id` is only allowed with `source = 'migration'`; the browser can write neither. |
| `deleted_at` | `timestamptz` | Soft delete marker and undo token. |
| `search_vector` | `tsvector` | Generated from `text`. |

Browser grants: `select` on all columns, `insert (text, due_date, due_time,
project_id)`, `update (text, completed, due_date, due_time, project_id)`.

### `public.projects`

`id`, `user_id`, `title` (not blank), `description`, `status`
(`active | someday | completed | archived`), `source`, `legacy_id`,
`deleted_at`, timestamps, and a weighted `search_vector` over title and
description. A unique `(user_id, id)` constraint backs the child foreign keys.
Browser insert and update cover `title`, `description`, `status` only.

### `public.ideas`

`id`, `user_id`, optional `title`, required `body`, `project_id` (same-owner,
must be active), `source`, `legacy_id`, `deleted_at`, timestamps, and a
`search_vector` over title and body. Browser insert and update cover `title`,
`body`, `project_id`.

### `public.media`

`id`, `user_id`, `media_type` (`book | movie`), `title` (not blank), `creator`,
`release_year`, `status` (`saved | in_progress | finished`), `rating`, `notes`,
`source`, `legacy_id`, `deleted_at`, timestamps, and a `search_vector` over
title, creator, and notes. Browser insert and update cover every content column.

Projects, ideas, and media are what the UI calls **collections**: one
`collectionService` in `frontend/src/features/collections/` serves all three
because they share the same policy shape, soft-delete contract, and search
projection.

### `public.home_appearance`

Added by `supabase/migrations/20260907000100_home_appearance.sql` and
`supabase/migrations/20260908000100_home_cover_position.sql`.
`user_id` primary key, `title` (at most 100 characters), `cover_image` (a
`data:image/webp|png|jpeg;base64,...` string of at most 350,000 bytes), and
`cover_position_x` / `cover_position_y` (`smallint`, 0 to 100, default 50).
There is no public image bucket; the browser resizes before saving.

### Google connection tables

`public.google_calendar_connections` and `public.google_calendar_preferences`
hold browser-visible connection state and per-calendar visibility.
`private.google_calendar_credentials` and `private.google_oauth_transactions`
hold encrypted refresh tokens and one-use OAuth state; they are reachable only
through `service_role` RPCs. `supabase/migrations/20260913000100_google_drive.sql`
adds the same three-table shape for Drive. Details in [Calendar](CALENDAR.md)
and [Drive](DRIVE.md).

## Soft delete and the undo token

Deleting is never a `DELETE`. The browser calls:

```text
public.soft_delete_record(p_record_type, p_record_id) -> timestamptz
public.restore_record(p_record_type, p_record_id, p_deleted_at) -> boolean
```

`p_record_type` is `public.orbitos_record_type`: `todo`, `idea`, `media`, or
`project`. The returned `timestamptz` **is** the undo token. Contract:

- Keep the token as the exact string the database returned. `domain.ts` brands it
  as `DeleteUndoToken` for that reason. Converting it through a JavaScript `Date`
  loses microseconds and the restore silently matches nothing.
- `restore_record` matches on `deleted_at = p_deleted_at`, so a replayed or
  stale token returns `false` instead of resurrecting a later state.
- Restoring a todo clears `today_rank`; the task returns to date ordering.
- A soft-deleted row disappears from every browser `select`, because each select
  policy requires `deleted_at is null`.
- No browser role holds `DELETE` on these tables at all.

Covered by `supabase/tests/030_soft_delete_restore.test.sql`.

## Ownership and RLS model

- Every user-owned table has RLS enabled and `user_id` defaulting to
  `auth.uid()`. Policies are `to authenticated` and compare
  `(select auth.uid()) = user_id`; select and update additionally require
  `deleted_at is null`, and insert additionally requires `source = 'manual'` and
  `legacy_id is null`.
- Policies alone are not the boundary. All privileges are revoked from
  `public`, `anon`, `authenticated`, `service_role`, and `orbitos_rpc`, then
  re-granted column by column. That is what keeps `completed_at`, `today_rank`,
  `deleted_at`, `source`, and `legacy_id` out of browser reach.
- Multi-row atomic operations live in the non-exposed `internal` schema and are
  owned by `orbitos_rpc`, a `NOLOGIN` `NOBYPASSRLS` role. The `internal`
  functions are `SECURITY DEFINER` with `search_path = ''` and
  `row_security = on`, so they run as `orbitos_rpc` and are still filtered by
  that role's own policies, which use `internal.request_user_id()` rather than a
  caller-supplied owner. A thin `SECURITY INVOKER` wrapper in `public` is what
  PostgREST exposes.
- The `private` schema holds credentials and OAuth state. Only `service_role`
  has usage, so only server code reaches it. See
  [ADR 0001](adr/0001-rls-only-browser-access.md) and
  `supabase/migrations/README.md` for the ownership-transfer rule every new
  `internal` helper must repeat.

## Date-only due dates

- `due_date` is a SQL `date` and `due_time` a `time without time zone`. There is
  no timestamp for a due date anywhere in the schema.
- `todos_due_time_requires_date` forbids a time without a date.
- `supabase/migrations/20260902000300_todo_schedule_bounds.sql` bounds
  `due_date` to years 0001 through 9999 and `due_time` to `[00:00, 24:00)`, so
  persisted schedules stay representable by the browser domain.
- Never parse or format a due date through `Date`: use the helpers in
  `frontend/src/features/todos/dateDomain.ts`, which work on `YYYY-MM-DD`
  strings. Overdue dates are shown as stored and are never rewritten.
- "Today" means `due_date <= the profile's local date`, computed from
  `profiles.timezone`, not from the browser clock.

## Today ordering

`today_rank` is the manual order. Reads and the single atomic reorder write are
defined in [Today data protocol](TODAY_DATA_PROTOCOL.md); the SQL is in
`supabase/migrations/20260902000400_today_pagination.sql`. Do not write
`today_rank` directly: the browser has no grant for it.
