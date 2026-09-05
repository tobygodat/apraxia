# Complete Today data without a product-sized row cap

Today must contain every incomplete, non-deleted task due on or before the
profile's local date. Long lists scroll; older tasks are not hidden. At the same
time, SPEC section 18 requires bounded list queries and pagination.

## Read protocol

`public.get_today_todos_page` takes `p_local_date`, `p_offset`, `p_limit` (at most
200), and `p_snapshot_token`. It returns one scalar JSON envelope:

```text
local_date, offset, total_count, snapshot_token, items
```

The first request starts at zero without a token. Every later page must present
the previous token. The database fingerprints the complete owned browser
projection, including ordering fields, exact timestamps, and joined project
titles, within a stable statement snapshot. A valid but stale token raises
SQLSTATE `40001`; invalid parameters do not trigger an automatic retry.

The browser collector validates page size, count, offset, date, token, every
record, uniqueness, and overall ordering. It exposes no partial result. It
restarts from zero at most twice after a snapshot change, discarding the old
pages. Other failures propagate to the existing safe retry/rollback UI. Abort
settles immediately, even if a provider ignores its signal.

The complete eligibility fingerprint scans the eligible set on each page.
This trades extra database work for consistency without a new persisted
snapshot table. Profile that cost if actual list size or latency warrants it; an indexed
revision scheme can replace the fingerprint if measurements justify it.

## Atomic order protocol

`public.reorder_today_todos` still receives the complete desired UUID order and
performs one serialized write with authenticated ownership, current-local-date,
exact-membership, and uniqueness checks. There is no 1,000-task business cap.
It returns one compact scalar receipt:

```text
local_date, applied_count, rank_step, order_fingerprint
```

The fingerprint is SHA-256 of lowercase UUIDs joined by commas in the actual
saved-rank order (the empty order hashes the empty string). The server checks
the saved rank spacing before returning the receipt. The client validates the
date, count, spacing, and fingerprint, then reconstructs the exact deterministic
ranks. JavaScript safe-integer limits are enforced; records are never dropped
to fit an arbitrary list size.

Never paginate or replay this mutation to obtain additional confirmation rows.
A missing/invalid receipt is a failed confirmation, not permission to retry the
write automatically. Existing controller rollback and explicit reload behavior
apply.

## Adapter boundary and verification

`shared/todayRpcContract.ts` contains the wire names/constants;
`todayRpcProtocol.ts` contains provider-neutral validation and collection. The
concrete `supabaseTodoService.ts` adapter uses the generated `database.ts`.
It calls the page RPC once per collector callback and maps
only SQLSTATE `40001` to `TodaySnapshotChangedError`. Ownership never comes from
a callback argument.

The old set-returning Today read helper is internal-only. Do not expose it as
the browser list API or use a table-returning reorder confirmation. Keep
`supabase/config.toml`'s general `max_rows` safety limit unchanged.

Embedded PostgreSQL tests feed real SQL envelopes through the same client
protocol, including more than 1,000 tasks and mid-pagination project edits.
The separate `npm run db:test:todos-http` passed on local Supabase on 2026-09-04:
real Auth/JWT reads, response mapping, 1,005 eligible tasks, complete reload/order,
and cross-user denial with the configured 1,000-row Data API limit unchanged.
Check the live personal Todo flow after deployment. Larger-data fingerprint
profiling is follow-up work if observed performance warrants it, not a release gate.

PostgREST distinguishes scalar responses from table-valued responses, while
table-valued functions support row limits and filters. This is why page metadata
and write acknowledgements use scalar envelopes. See its
[RPC reference](https://docs.postgrest.org/en/stable/references/api/functions.html#scalar-functions)
and [row-limit configuration](https://docs.postgrest.org/en/stable/references/configuration.html#db-max-rows).
