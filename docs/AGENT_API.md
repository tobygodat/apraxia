# Personal agent API

Muse can use ordinary HTTPS and curl against the existing Vercel app. The API
reads and writes the same Supabase records as the dashboard. Google Calendar
remains authoritative for events; event writes use the existing Google connection.

## Configure

Set these **server-only** Vercel environment variables for the existing app:

| Variable | Value |
| --- | --- |
| `APRAXIA_AGENT_TOKEN` | A dedicated random secret: 32 random bytes encoded as base64url (43 characters), or 64 random hexadecimal characters. Accepted characters are letters, digits, `_`, `-`; length 43–256. The current production value is stored under the pre-rename name `ORBITOS_AGENT_TOKEN`, which Vercel cannot rename; the server accepts either name. |
| `APRAXIA_AGENT_USER_ID` | Your existing Supabase Auth user UUID. This fixes the account; requests cannot choose an owner. |
| `APRAXIA_AGENT_SCOPES` | Comma-separated permissions. For the requested access: `workspace:read,workspace:write,calendar:read,calendar:write,files:read`. Omitted defaults to `workspace:read`. |

Existing server Supabase and Google configuration is still required. Keep the
agent token separate from the Supabase service-role key. Never give Muse the
service-role key, OAuth refresh token, or browser credentials. Store the same
agent token in Muse's secret environment and send `Authorization: Bearer ...`.
Do not place it in query strings, browser code, logs, or committed files.

The API is deployed on the existing app, with `20260916053826_agent_api.sql`
applied. Rotate the token, or remove it and redeploy, to revoke access; also
revoke obsolete deployment access if old Vercel deployments remain reachable.
Missing configuration fails closed. Google features require the account's
existing Calendar/Drive connection.

## Discover and read

The examples are POSIX shell commands for Muse's curl runner. `APRAXIA_BASE_URL`
is the existing app origin without a trailing slash; no separate API host is
needed. Both discovery endpoints require the bearer token.

```sh
curl --fail-with-body -sS "$APRAXIA_BASE_URL/api/agent/v1/meta" \
  -H "Authorization: Bearer $APRAXIA_AGENT_TOKEN"
curl --fail-with-body -sS "$APRAXIA_BASE_URL/api/agent/v1/openapi" \
  -H "Authorization: Bearer $APRAXIA_AGENT_TOKEN"
curl --fail-with-body -sS --get "$APRAXIA_BASE_URL/api/agent/v1/todos" \
  -H "Authorization: Bearer $APRAXIA_AGENT_TOKEN" \
  --data-urlencode 'completed=false' --data-urlencode 'limit=100'
curl --fail-with-body -sS --get "$APRAXIA_BASE_URL/api/agent/v1/search" \
  -H "Authorization: Bearer $APRAXIA_AGENT_TOKEN" \
  --data-urlencode 'q=exam'
```

| Endpoint under `/api/agent/v1` | Operations / permission |
| --- | --- |
| `todos`, `projects`, `ideas`, `classes`, `notes` | GET list or `?id=...` requires `workspace:read`; POST create and PATCH `?id=...` require `workspace:write`. |
| `search?q=...&bucket=...` | GET; bucket optional; `workspace:read`. |
| `changes` | GET agent write journal; `workspace:read`. |
| `calendars` | GET connected calendars; `calendar:read`. |
| `events?sunday=YYYY-MM-DD&q=...` | GET one Sunday-start week; optional case-insensitive title/location search within that week; `calendar:read`. |
| `events` | POST detail (`calendar:read`), create/update (`calendar:write`); OpenAPI supplies command bodies. |
| `drive-files?folder=root&page=...` | GET folders and PDFs; `files:read`; response `{files,nextPage}`. |
| `note-content?id=...` | GET saved PDF bytes; both `workspace:read` and `files:read`. |

List replies are `{items,next_offset}`; single-record reads and workspace writes
return `{item}`. Every workspace item contains its opaque `version`. Default
page size is 50, maximum 100; offset is 0–100000. Follow `next_offset` until null.
Lists order by record ID; concurrent changes can shift pages, so reconcile by ID.
All-bucket search returns `{buckets:{todos:{items,next_offset},...}}` with
independent pages. Continue each bucket using `bucket` and its `next_offset`.
Search is case-insensitive literal substring search of saved text, title, body,
description, or name; it does not search PDF contents or Google events.

Common list filters: `limit`, `offset`, `q` (1–500 characters), `updated_since`
(exclusive RFC3339 timestamp). Todos also accept `completed=true|false`,
`due_from`, `due_to`, `class_id`, `project_id`; ideas accept `project_id`; notes
accept `class_id` (matching their `course_id`). Other bucket-specific filters
are rejected. All-bucket search accepts only common filters. With `id`, no
other query parameters are accepted. Repeated or unknown parameters are rejected.

## Create and edit

| Bucket | Writable fields | Create requirements |
| --- | --- | --- |
| `todos` | `text`, `completed`, `due_date`, `due_time`, `project_id`, `class_id`, `assignment_type` | `text` |
| `projects` | `title`, `description`, `status` | `title`; status is `active`, `someday`, `completed`, or `archived` |
| `ideas` | `title`, `body`, `project_id` | `body` |
| `classes` | `name`; `id` only on create | `id`, `name`; IDs are stable strings, at most 120 characters |
| `notes` | `name`, `course_id`; `source`, `drive_file_id` only on create | `name`, `course_id`, `source:"drive"`, `drive_file_id`; also requires `files:read` |

Notes attach accessible Drive PDFs after provider verification. The API can
rename or move a saved note association; it cannot replace its underlying file
or upload PDF bytes. Upload files through the dashboard, then retrieve them
through `note-content`. No text extraction is provided. A note's `course_id`
references a class; assignment tasks instead use `class_id`. Tasks may have only
one parent (`class_id` or `project_id`). Assignment type is `""`, `Homework`,
`Quiz`, `Reading`, `Exam`, or `Other`; a nonempty type requires a class.
Relationships must belong to the configured account.

Preserve `due_date` as `YYYY-MM-DD` and `due_time` as local wall time. A time
requires a date; clearing the date may require explicitly clearing its time.
Never convert date-only values through UTC or move overdue dates automatically.
Use null to clear nullable relationships/schedule fields. Server-managed owner,
timestamps, lifecycle state, and Today order cannot be set. Changes retain the
existing atomic Today ordering rules.

Save a create body to a file and use a unique key for that logical operation:

```sh
printf '%s\n' '{"data":{"text":"Plan next week"}}' > create-task.json
curl --fail-with-body -sS "$APRAXIA_BASE_URL/api/agent/v1/todos" \
  -H "Authorization: Bearer $APRAXIA_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: muse-plan-week-2026-09-20-01' \
  --data-binary @create-task.json
```

To edit, first GET the record using its ID. Save a JSON file such as
`{"data":{"completed":true},"expected_version":"<exact returned version>"}`
and use PATCH:

```sh
curl --fail-with-body -sS -X PATCH \
  "$APRAXIA_BASE_URL/api/agent/v1/todos?id=$TODO_ID" \
  -H "Authorization: Bearer $APRAXIA_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: muse-complete-task-2026-09-20-01' \
  --data-binary @edit-task.json
```

`expected_version` is required for every workspace edit. A stale version returns
409; fetch current state and reconsider the proposed change before using a new
key. Do not calculate the token. JSON requests are bounded to 64 KiB; event
commands are bounded to 16 KiB. There is no DELETE operation.

Use the **same key and identical request** to retry a logical write after a
transport failure. A successful workspace replay returns the original response
without another insert or edit. Keys are durable with no automatic expiry and
shared across endpoints for the account. A different payload under a used key
returns 409. Do not reuse sample keys for unrelated work.

Google writes use a durable reservation and generated event ID for creates.
Updates require the current detail `etag` and an `instance` or `series` scope.
If the API reports `outcome_unknown`, Google may already have committed the
operation: inspect the current event before further action. A new key is not a
safe blind retry. Google event timing uses RFC3339 instants for timed events and
exclusive end dates for all-day events. Full command schemas are at `/openapi`.

## Scheduled operation and verification

Muse should discover `/meta`, read relevant buckets and calendar weeks, follow
pagination, and distinguish a failed read from an empty dataset. Poll current
records for dashboard changes. `/changes` is only the agent journal, ordered by
creation time then ID; it accepts `limit`, `offset`, `updated_since` and records
before/after data and provider results. It is not an account-wide change feed
and does not observe direct Google changes. `updated_since` is exclusive: use
an overlapping time window and deduplicate by ID when polling. Lists exclude
soft-deleted records; periodically reconcile complete lists to detect removals.

401 means invalid credentials; 403 means insufficient scope; 400 means invalid
fields/relationships/filters; 428 means missing edit version; 409 requires
conflict or provider-state reconciliation. 502/503 indicate unavailable services
or configuration. Error envelopes contain `error.code` and `error.message`.
Never interpret an error as permission to overwrite or create replacement data.

Fixture tests cannot prove hosted persistence or Google access, so report any
authenticated flow a change leaves unverified. This API intentionally excludes
appearance/settings, credentials, retired data, and raw database access.
