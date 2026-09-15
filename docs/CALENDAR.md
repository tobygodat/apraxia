# Calendar

Calendar supports event creation, editing, and deletion and loads independently of Today. Settings handles
connection, visibility, refresh, and disconnect. Events are fetched on opening
or changing the week and explicit refresh, without a persisted event cache.

## Provider setup and recovery

The live Supabase project is `oidvvenjamgcezdptfjr`. Vercel Production holds
`APP_URL`, Supabase configuration, and these server-only Calendar settings:

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from a Google Web OAuth client.
- `GOOGLE_TOKEN_ENCRYPTION_KEY`: 32 cryptographically random bytes encoded as
  padded standard Base64. Never put its value in chat or tracked files.

Enable Google Calendar API. Register the exact Calendar redirect:
`https://orbitos-virid.vercel.app/api/calendar/callback`.
Retain the separate Supabase app sign-in redirect:
`https://oidvvenjamgcezdptfjr.supabase.co/auth/v1/callback`.
Supabase's Site URL and allowed app return are `https://orbitos-virid.vercel.app/`.
Redeploy after changing environment settings; connect through Settings and
complete the separate Calendar consent. Existing read-only connections must
reconnect to grant event editing. App sign-in alone does not connect Calendar.

On 2026-09-04, the live Calendar store returned upstream 401 and the Google
settings were absent. Reinspect current configuration before taking action.
For a repeated storage 401, check that `SUPABASE_SERVICE_ROLE_KEY` is an active
server key for this Supabase project. Modern `sb_secret_` keys use `apikey`;
legacy JWT keys also use Bearer authentication. Never replace browser keys
with a server key. Verify a real week, saved visibility, reconnect after revoked
access, and disconnect after setup. Never log credential values or OAuth material.

## Security boundaries

- The server verifies the Supabase session through Auth, not decoded claims or
  a browser-supplied owner. Mutation requests also require the expected origin.
- The callback handoff keeps code/state in memory, strips the query, restores
  the session, and posts to `/api/calendar/complete` with its JWT. Missing or
  switched sessions require a new connection attempt.
- One-use state, PKCE, and exact redirect matching bind the authorization.
  The database atomically consumes matching, unexpired state before exchange;
  uncertain consumption fails closed. Do not blindly retry an exchange.
- Offline token exchange and refresh stay server-side. A validated existing
  refresh token survives Google's omission of a replacement.
- Each access token is cached beside its refresh token as its own AES-256-GCM
  envelope with an expiry, so an ordinary request reuses it instead of calling
  Google. The server refreshes only when the cache is missing, within a minute of
  expiry, or after Google rejects the token once; that retry happens at most once
  per request. Disconnect clears the cached token with the refresh token.
- `read_calendar_credentials` also returns the profile timezone, so a week load
  makes no separate profile request. It runs with invoker rights as `service_role`,
  which holds a column grant on `public.profiles (user_id, timezone)` only.
- `save_calendar_credentials` has an eight-argument overload carrying the cached
  access-token envelope and expiry; the six-argument form remains and delegates
  with an empty cache. The server always passes all eight named arguments so
  PostgREST resolves the overload unambiguously.
- AES-256-GCM envelopes bind refresh tokens to owner, connection, and key
  version. Credentials and transaction data remain private; only server roles
  can invoke credential RPCs. Callback responses use no-store/no-referrer.
- Key rotation requires the previous key to decrypt and re-encrypt records;
  no operational rotation procedure has been verified.

## Event editing

Click **Add event**, select an all-day slot, or drag an empty time range in
15-minute increments. Click an event to edit its title, location, calendar,
dates, times, all-day status, and repeat schedule. Timed inputs use the event
timezone; new events use the profile timezone. All-day end dates in the editor
are inclusive and become exclusive Google dates. Skipped or ambiguous DST
times are rejected.

Repeating events offer **This event** and **Entire series**. Series editing
loads the first event's dates and affects past events too. Daily, weekly,
weekday, monthly-by-date, and yearly schedules support intervals and optional
end dates/counts. Existing custom rules are preserved unless explicitly changed.
Google expands repeat instances when the week reloads.

The separate OAuth grant requests `calendar.events`,
`calendar.calendarlist.readonly`, and `calendar.calendars.readonly` under
`https://www.googleapis.com/auth/`. The metadata read permission resolves Google's
per-calendar event label colors; existing two-scope connections need a one-time
reconnect after this update. Add the metadata scope to the Google OAuth consent
configuration before releasing. No additional write permission is requested.
Server writes require the verified session, expected origin, and fresh Google
writer/owner access. Read-only calendars remain viewable. No migration is needed.

POST commands on `/api/calendar/events` validate bounded input. Details are
projected to editor fields only. Conditional PATCH/DELETE requests reject stale
edits; PATCH preserves guests, descriptions, and other untouched fields.
Existing guests receive Google updates. Delete requires in-app confirmation.
Calendar moves use Google's move endpoint for eligible events the user organizes;
individual recurring instances cannot move. A failed move after a successful
edit reports partial success and refreshes the week. Mutations are never blindly
retried; creation uses a stable draft ID. After an uncertain result, close and
refresh before retrying.

The local workspace fixture exercises editor, drag selection, and CRUD with
fictional data. It stores repeat settings but does not expand recurrence or
verify Google OAuth, permissions, notifications, or persistence. Live Google
verification remains required after deployment and renewed consent.

## Reads and contracts

The calendar runs Sunday through Saturday, including navigation, all-day spans,
and the `events?sunday=YYYY-MM-DD` read window. The response range contains
inclusive `sunday` and `saturday` dates in the profile timezone.
The week grid includes all 24 hours at 30 pixels per hour. On load and when
pressing Today it scrolls toward the current profile-local time, clamped at the
end of the day. Clock updates and refreshes preserve manual scrolling. A colored
time label and line identify the current time. Event text clips at the right edge
without wrapping or ellipses: roomy cards show title, time range, and optional
location; medium cards combine start time and location below the title; the
shortest cards combine title, start time, and location on one line. Short events
reserve one readable row, and overlap lanes account for that minimum footprint.
Week reads include bounded plain-text locations so cards need no per-event fetch.

Event reads opt into `eventLabelVersion=1` and resolve `eventLabelId` against
`Calendars.get` label colors. Only label IDs and background colors are requested;
names and unrelated metadata are discarded. Palettes are cached only within the
current request and calendar. Missing or unavailable color metadata falls back
to the calendar color without dropping events; revoked grants still reconnect.
Legacy `colorId` responses retain the Colors endpoint fallback.
References: [Google event labels](https://developers.google.com/workspace/calendar/api/guides/labels)
and [calendar metadata permissions](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/get).

Keep `CalendarEvent` and `WeekViewModel` as the shared contracts. Week bounds
use civil dates and named timezones, including DST; all-day ends are exclusive.
Fetch bounds include both profile and source-calendar weeks to avoid date-line
omissions. Newly discovered calendars default visible; saved visibility is
owned by the authenticated user and protected by RLS.

Reads expand recurring instances and follow pagination within bounded request
and load deadlines. Invalid events produce partial warnings; a failed calendar
does not discard successful calendars. Limits and malformed pagination must
produce explicit errors, never silently truncated success. Provider bodies,
attendees, descriptions, and credentials do not enter browser projections or logs.

Local verification commands are documented in [cloud development](CLOUD_DEVELOPMENT.md).
Fixtures and fake-provider tests do not prove live Google access.
