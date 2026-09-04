# Read-only Calendar core

The Phase 3 server core is implemented independently of Google credentials,
Supabase adapters, and the Home interface. It is not an authenticated endpoint
or proof of a real Google connection. Production still stops at the existing
setup checkpoint.

## Dates and source projection

`weekWindow.ts` accepts a strict Monday date and a named timezone. It derives
Sunday and the next Monday as civil dates, then converts their first valid
local instants to UTC request bounds. It never assumes that a week is 168 hours.
The server-only Temporal polyfill handles daylight-saving and midnight changes;
it is not imported by the browser. See the
[Temporal date conversion reference](https://tc39.es/proposal-temporal/docs/plaindate.html#date.toZonedDateTime).

`normalizeGoogleEvent.ts` projects unknown provider records into the existing
shared `CalendarEvent` contract. All-day end dates remain exclusive dates.
Timed records preserve explicit offsets and named timezones; zone-only times
must resolve unambiguously. Invalid dates, non-positive durations, unexpanded
recurrence masters, and unsafe event links produce a fixed sanitized failure.
Canceled records are skipped. Recurring instances retain their own event IDs.
Missing titles receive a neutral fallback, and descriptions, attendee data,
and other provider-only fields are not copied. These distinctions follow the
[Google event resource](https://developers.google.com/workspace/calendar/api/v3/reference/events).

## Complete bounded reads and partial failure

`loadCalendarWeek.ts` receives server-loaded calendar choices and a read-only
page transport. It supplies no user ownership or credential arguments. A later
authenticated adapter must derive the account and load these choices itself;
it must never accept them as trusted browser input.

Only visible calendars are fetched. Their fresh Google metadata must include
the source timezone. Google uses that timezone when deciding whether an all-day
event matches a time-bounded query, even when the response timezone differs.
The request therefore spans the smallest UTC interval containing both the
profile week and source-calendar week. Returned timed events are filtered to
the profile interval; all-day events are filtered by date overlap. This avoids
date-line omissions without displaying an extra day. A missing source timezone
fails only that calendar, with no guessed fallback. See
[Google's timezone semantics](https://developers.google.com/workspace/calendar/api/concepts/events-calendars#calendar_time_zone).

The loader requests expanded instances, excludes deleted events, and asks only
for the fields needed by the normalizer. It follows page tokens even when a
page is empty. Requests are sequential within each calendar and limited to
three calendars at once. Resource limits are 250 records per page, 100 pages
per calendar, and a 20-second whole-load deadline. Reaching a limit is an
explicit partial error, never a silently truncated success. These requests
use the documented [Google list contract](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

Malformed pages, token loops, duplicate instance IDs, or a failed later page
discard that calendar's earlier pages. Other calendars survive. Invalid
individual events leave an explicit partial warning alongside the valid
events. Cancellation ends promptly even if the transport ignores its signal;
a deadline preserves completed calendars and marks unfinished ones. Provider
error text is never returned or logged. There is no persistence or shared cache.

Google pagination does not promise a cross-request snapshot. Fresh metadata
and duplicate detection do not prove atomicity if Google edits events or the
source timezone during a load. Real integration must exercise those changes
and provide an explicit reload path; the core does not claim snapshot isolation.

## Bounded Google read transport

`googleCalendarTransport.ts` supplies the loader's `fetchEventPage` and a
complete `listCalendars` operation from a request-local server access token.
Only fixed Google Calendar v3 GET endpoints are available. Calendar IDs are
encoded, redirects are rejected, and credentials/caching/referrers are disabled
apart from the explicit server-side Bearer header. Responses are projected to
an allowlist even when the provider returns extra fields.

Calendar discovery includes Google-hidden calendars and defaults every new
calendar to visible; an authenticated adapter must merge orbitOS's persisted
choices. Source timezones come from fresh metadata, never the profile or an
events response. A missing/invalid timezone is left invalid so the week loader
can report failure for that calendar alone. See Google's
[Calendar list contract](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list).

Bounds are 8 seconds per request, 20 seconds for complete calendar discovery,
2 MiB decoded response bodies, 16 KiB accepted headers, 16,384 stream chunks,
250 records per page, 20 discovery pages, and 2,048-character page tokens.
The platform controls wire-level header parsing; the header limit applies
after that parsing. Ignoring fetches/readers cannot hold up cancellation, and
late responses are discarded. Pagination cycles and resource limits fail
explicitly, never returning a truncated calendar list as complete.

HTTP 401 produces a provisional `reconnect_required`; the future credential
layer must attempt refresh before concluding access was revoked. HTTP 403,
429, and 5xx map to sanitized `calendar_unavailable`, without returning provider
bodies. There is no token exchange, refresh, credential persistence, endpoint,
or live Google call in this slice. Its 69 fake-fetch tests check bounds,
cancellation, projection, pagination, and error handling.

## Remaining integration gates

- Wire the tested session verifier, exact-origin/callback policy, and encrypted
  token envelope from `CALENDAR_SECURITY_CORE.md` into authenticated routes.
- Wire the prepared atomic one-time OAuth-state consumption, the browser callback
  session handoff, credential storage, refresh, and revocation before live use.
- Load calendar metadata and saved visibility with authenticated ownership;
  default newly discovered calendars to visible.
- Wire the bounded HTTP transport behind authentication and refreshed
  credentials; add disconnect/reconnect routes and private no-store responses.
- Exercise a real Google week fetch in the isolated Preview environment,
  including pagination, date-line calendars, refresh, and revoked access.
- Compose Calendar and Today independently in Home, then perform browser and
  accessibility acceptance checks. This core does not complete those checks.

Owner setup remains in `USER_ACTIONS.md`; no account action was performed while
building this core, and no legacy records or runtime were changed.
