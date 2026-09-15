# 0001. RLS-only browser access

Status: accepted. Date: 2026-09-02.

## Context

The workspace holds one person's private records and will later hold several
people's. Every ordinary read and write comes from the browser. Putting an
application server in front of that path would mean writing and securing
authorization twice, so the database has to be the boundary that actually holds.
Postgres policies alone are not enough: a policy cannot stop a browser from
writing `deleted_at`, `today_rank`, or `source`, and some operations (Today
reordering, soft delete, restore) must be atomic across rows.

## Decision

The browser talks to Supabase directly with the user's JWT, and the database
enforces ownership.

- RLS on every user-owned table, with `to authenticated` policies comparing
  `(select auth.uid()) = user_id`, and `deleted_at is null` in select and update.
- All privileges revoked from `public`, `anon`, `authenticated`, `service_role`,
  and `orbitos_rpc`, then re-granted column by column. Protected lifecycle
  columns are simply not granted.
- Atomic operations live in the non-exposed `internal` schema, owned by
  `orbitos_rpc`, a `NOLOGIN` `NOBYPASSRLS` role, as `SECURITY DEFINER` functions
  with `search_path = ''` and `row_security = on`. They derive the owner from
  `internal.request_user_id()`, never from an argument. A `SECURITY INVOKER`
  wrapper in `public` is what PostgREST exposes.
- Credentials and OAuth state live in the `private` schema, reachable only by
  `service_role` from server code.

## Consequences

- Authorization is testable in one place. `supabase/tests/` proves isolation
  against real Postgres for two users on every table.
- Any new `internal` helper must repeat the temporary-grant, ownership-transfer,
  exact-grant, revoke sequence described in `supabase/migrations/README.md`.
  Forgetting it leaves the helper owned by `postgres` and bypassing RLS.
- New columns are invisible to the browser until granted explicitly. That is
  intended friction.
- Google work cannot use this path at all, because it needs secrets. It goes
  through `/api` instead. See [architecture](../ARCHITECTURE.md).
