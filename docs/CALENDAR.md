# Calendar

Calendar is read-only and loads independently of Today. Settings handles
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
complete the separate read-only consent. App sign-in alone does not connect Calendar.

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
- AES-256-GCM envelopes bind refresh tokens to owner, connection, and key
  version. Credentials and transaction data remain private; only server roles
  can invoke credential RPCs. Callback responses use no-store/no-referrer.
- Key rotation requires the previous key to decrypt and re-encrypt records;
  no operational rotation procedure has been verified.

## Reads and contracts

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
