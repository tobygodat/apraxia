# Database tests

Database security and function tests live here. Every user-owned table must have
allow/deny coverage for two isolated users before it receives personal data.

The database suite covers:

- `000_security_contract.test.sql` — schema, role, function, and private-table
  ACL posture.
- `010_rls_isolation.test.sql` — two-user access across every public table,
  ownership derivation, cross-owner relationships, and hard-delete denial.
- `020_today_reorder.test.sql` — eligibility, deterministic ordering, atomic
  rank persistence, and non-oracular validation failures.
- `030_soft_delete_restore.test.sql` — all four record types, foreign/stale
  no-ops, exact undo tokens, replay denial, and stale-rank removal.
- `040_search.test.sql` — all record types, ownership/deletion filtering,
  negative terms, pagination bounds, and injection-like input.
- `050_todo_schedule_bounds.test.sql` — authenticated INSERT/UPDATE schedule
  boundaries, finite four-digit dates, microsecond preservation, and null rules.
- `060_today_pagination.test.sql` — complete bounded Today pages beyond 1,000
  rows, snapshot consistency, scalar reorder receipts, and API-role isolation.
- `070_calendar_oauth_transactions.test.sql` — service-only OAuth creation and
  consumption, exact ownership/redirect binding, database-time expiry, replay
  rejection, and browser-role denial.
- `120_class_deletes.test.sql` — owner-scoped Classes deletion, cross-account
  denial, foreign-key protection for a class that still has saved data, private
  PDF object deletion, Storage SHA-256 verification at finalization, and
  service-role-only access to the abandoned-upload reaper.
- `130_browser_role_posture.test.sql` — row-level security on every personal
  table, internal Today reader grants, read-only calendar connections, and the
  visibility-only calendar preference write surface.

Run the authoritative suite against local Supabase with:

```powershell
npm run db:verify
```

`npm test` also checks that every TAP plan matches its assertion count and
uses an embedded PostgreSQL runtime for fast migration and behavior coverage.
Embedded single-connection tests do not prove concurrent replay protection;
that needs a separate two-session test on the real local Supabase stack.
