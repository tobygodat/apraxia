# Database migrations

Add timestamped, forward-only cloud schema migrations here.

Atomic helpers are owned by dedicated `NOLOGIN`, `NOBYPASSRLS` roles:
`orbitos_rpc` for the workspace helpers and `orbitos_agent` for the agent API.
Each is granted to `postgres` temporarily, with temporary `CREATE` on `internal`,
and both privileges are revoked once ownership has been transferred. Any later
migration that replaces or adds a helper owned by one of those roles must
explicitly repeat that temporary grant, transfer ownership, reapply exact
function grants, and revoke the temporary privileges before it ends.

`npm run db:rewind:verify` is a disposable-local rewind/reapply check down to
the initial schema migration. The CLI requires at least one migration to remain;
`npm run db:verify` separately verifies full database recreation. The rewind
count is derived by `scripts/migration-rewind.mjs`, which counts the `.sql` files
in this directory and rewinds one fewer, so adding a migration needs no edit.
Never run that check against hosted or personal data.

Two shapes the early migrations established, which later ones must keep:

- The complete set-returning Today helper stays in the non-exposed `internal`
  schema. Browser reads use bounded scalar page envelopes and reorders receive
  one scalar acknowledgement, with snapshot tokens fingerprinting the owned
  projection rather than copying personal data. Embedded PostgreSQL tests do not
  exercise the Data API's HTTP row limit, so that still needs local Supabase.
- The server reaches the `private` OAuth store through scalar functions in
  `public` that only `service_role` may execute. They are invokers, not
  privilege-elevating; their verified owner argument comes from the server's
  authenticated session, never request data; creation caps expiry using database
  time, and consumption locks the exact transaction before checking the clock and
  marking it used. See [Calendar guidance](../../docs/CALENDAR.md).
