# Database tests

Database security and function tests live here. Every user-owned table must have
allow/deny coverage for two isolated users before it receives personal data.

The files run in numeric order and each name states its area. Between them they
cover the security contract (schema, role, function, and private-table ACL
posture), two-account RLS isolation, Today ordering and pagination, soft delete
and restore with exact undo tokens, search, schedule bounds, OAuth transactions,
the calendar and home-appearance services, classes and notes, the
assignment-to-todo aggregation, Classes deletion, browser-role posture, and the
agent API.

Coverage is narrower than the whole schema: a new table or `SECURITY DEFINER`
function needs the posture suites (`000` and `140`) widened deliberately, not
assumed to reach it.

Run the authoritative suite against local Supabase with:

```powershell
npm run db:verify
```

`npm test` also checks that every TAP plan matches its assertion count and
uses an embedded PostgreSQL runtime for fast migration and behavior coverage.
Embedded single-connection tests do not prove concurrent replay protection;
that needs a separate two-session test on the real local Supabase stack.
