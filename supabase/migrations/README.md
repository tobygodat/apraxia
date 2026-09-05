# Database migrations

Add timestamped, forward-only cloud schema migrations here. Phase 1 introduces
the first application schema together with RLS, ownership constraints, and its
database tests.

The internal atomic helpers are owned by the `NOLOGIN`, `NOBYPASSRLS`
`orbitos_rpc` role. The bootstrap migration grants `postgres` temporary
membership and gives that role temporary `CREATE` on `internal`; the domain
function migration revokes both after transferring ownership. Any later
migration that replaces or adds an `orbitos_rpc`-owned helper must explicitly
repeat that temporary grant, transfer ownership, reapply exact function grants,
and revoke the temporary privileges before it ends.

`npm run db:rewind:verify` is a disposable-local rewind/reapply check down to
the initial schema migration. The CLI requires at least one migration to remain;
`npm run db:verify` separately verifies full database recreation. The explicit
`--last 4` count must stay one below the migration count when migrations are added.
Never run that check against hosted or personal data.

Migration 004 keeps the complete set-returning Today helper in the non-exposed
`internal` schema. Browser reads use bounded scalar page envelopes; browser
reorders receive one compact scalar acknowledgement for the single atomic write.
Snapshot tokens fingerprint the complete owned projection rather than storing
copies of personal data. Real Data API pagination still requires local Supabase
verification; embedded PostgreSQL tests alone do not exercise its HTTP row limit.

Migration 005 adds server-only scalar OAuth transaction functions in `public`
so the server can reach the private store through the Data API without exposing
the `private` schema. These are invokers, not privilege-elevating functions;
only `service_role` receives EXECUTE. Browser roles cannot invoke them. The
verified owner argument must come from the server's authenticated session, not
request data. Creation caps expiry using database time, and consumption locks
the exact transaction before checking the current clock and marking it used.
See [Calendar guidance](../../docs/CALENDAR.md) for the integrated OAuth flow.
