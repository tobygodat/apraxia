# 0003. Forward-only hosted migrations

Status: accepted. Date: 2026-09-02.

## Context

There is one hosted Supabase project and it holds the owner's real data. There
is no preview database and no separate staging copy. The Supabase CLI offers
`db reset` and `migration down`, both of which destroy data. A rewind run against
the hosted project by mistake would be unrecoverable.

## Decision

Hosted schema changes are forward-only.

- Every schema change is a new timestamped file in `supabase/migrations/`.
  Migrations are never edited or reordered after they are applied.
- A migration that changes existing rows inspects the data first and preserves
  it. `20260913000300_classes_and_notes.sql` is the pattern: recover parents,
  then enforce the constraint.
- `db:reset`, `db:verify`, and `db:rewind:verify` are disposable-local only, and
  run in CI against a temporary instance on the runner. Never against hosted or
  personal data.
- `npm run db:rewind:verify` rewinds to the initial schema and reapplies. The
  CLI requires at least one migration to remain, so the count is derived by
  `scripts/migration-rewind.mjs` rather than hardcoded.
- Apply required migrations before publishing the code that depends on them,
  because a push to `main` may deploy immediately.

## Consequences

- Mistakes are corrected by a follow-up migration, not by rewriting history.
- Rollback of a released schema change is not available; design each migration
  to be additive and compatible with the currently deployed code.
- Generated types can drift until CI's `database-types` artifact is downloaded
  and committed.

Details: `supabase/migrations/README.md` and
[cloud development](../CLOUD_DEVELOPMENT.md).
