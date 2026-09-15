# 0002. Scalar envelopes for Today pages and reorders

Status: accepted. Date: 2026-09-02.

## Context

Today must contain every incomplete, non-deleted task due on or before the
profile's local date. Long lists scroll; nothing is hidden. At the same time
list queries must stay bounded, and the Data API applies a 1,000-row limit.

PostgREST treats table-returning functions as tables: it applies row limits and
lets the client add filters. A table-returning Today read could therefore be
silently truncated, and a table-returning reorder acknowledgement could be
paginated or replayed, which would turn a confirmation into a second write.

## Decision

Browser-facing Today functions return a single scalar JSON value.

- `public.get_today_todos_page(p_local_date, p_offset, p_limit, p_snapshot_token)`
  returns one envelope: `local_date`, `offset`, `total_count`,
  `snapshot_token`, `items`. `p_limit` is at most 200. The token fingerprints
  the complete owned projection inside a stable statement snapshot; a stale
  token raises SQLSTATE `40001` and the collector restarts from zero.
- `public.reorder_today_todos(p_local_date, p_todo_ids)` performs one serialized
  write and returns one receipt: `local_date`, `applied_count`, `rank_step`,
  `order_fingerprint`.
- The set-returning helper stays in the non-exposed `internal` schema.

## Consequences

- Pagination cannot be truncated by the row limit, and the general `max_rows`
  safety setting stays unchanged.
- The reorder confirmation cannot be paginated or replayed. A missing or invalid
  receipt is a failed confirmation, not permission to retry the write.
- Each page pays for a full eligibility fingerprint scan. Accepted for now; an
  indexed revision scheme can replace it if measurements justify it.
- The client must validate every envelope field. That logic lives in
  `frontend/src/features/todos/todayRpcProtocol.ts`, kept provider-neutral.

Full protocol: [Today data protocol](../TODAY_DATA_PROTOCOL.md).
