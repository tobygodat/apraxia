# Google Drive notes

Classes uses Google's native Picker for PDF search, thumbnails, and folder
navigation. **Open from Drive** opens the popup; selecting a PDF loads it in the
existing notes reader. Cancel keeps the current document. Previously saved class
folders are used as the initial location. No background sync or Drive writes run.

## Deployment setup

1. Apply `supabase/migrations/20260913000100_google_drive.sql` after inspecting
   the hosted database and preserving a backup, following `CLOUD_DEVELOPMENT.md`.
2. Enable Google Drive API and Google Picker API in the existing OAuth project.
   Register `https://apraxia.dev/api/drive/callback` alongside the
   Calendar redirect. Local full-stack work uses `APP_URL` plus that path.
3. Keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
   `GOOGLE_TOKEN_ENCRYPTION_KEY` on the server. Request the existing
   `https://www.googleapis.com/auth/drive.readonly` scope.
4. Create a browser API key restricted to **Google Picker API** and these website
   referrers: `https://apraxia.dev/*` and `https://docs.google.com/*`.
   Set server environment `GOOGLE_PICKER_API_KEY` to that key and
   `GOOGLE_PICKER_APP_ID` to the Google Cloud project number. For local provider
   testing, explicitly allow the local origin too. See
   [Google's Picker setup](https://developers.google.com/workspace/drive/picker/guides/web-picker).
5. Deploy to the existing app. Open a class, connect Drive if needed, then select
   **Open from Drive**. Existing Drive consent works with the Picker; Calendar
   consent alone does not grant Drive access.

## Security and recovery

Every endpoint verifies the Supabase session. Mutations and the POST Picker grant
require the configured origin. Owner-bound, one-use OAuth state and PKCE precede
code exchange. Refresh tokens remain encrypted in Drive's private table, with
conditional writes preventing a late refresh from reconnecting a disconnected
account. Browser roles cannot invoke credential RPCs or access the tables.

Google's native Picker requires a temporary read-only access token in browser
memory. The authenticated `/api/drive/picker` response returns only that token,
the public restricted API key, and project number, with private/no-store headers.
Neither the token nor the grant is persisted in browser storage. Refresh tokens,
client secrets, and encryption keys remain server-only. The SDK loads lazily
from Google's API domain; CSP permits the Picker's Google frames. The app uses a
`strict-origin` referrer policy so Google can validate the restricted key without
receiving page paths or query strings. Both the HTTP header and HTML meta policy
must agree; `no-referrer` causes Google to reject the restricted key.

Access tokens are cached beside the refresh token in a separate AES-256-GCM
envelope with an expiry. Requests reuse the cached token and refresh only when it
is missing, within a minute of expiry, or rejected once by Google. The
`save_drive_credentials` eight-argument overload carries that envelope and expiry;
the six-argument form remains and delegates with an empty cache.

A reconnect must return a fresh refresh token. Disconnect deletes Drive's stored
credentials and pending attempts and now also revokes the refresh token at
Google, as Calendar does. Because both features share one Google client, revoking
Drive can require reconnecting Calendar. Revocation failure never blocks the local
disconnect, so disconnect still works after Google configuration or key loss. A
previously issued temporary access token expires independently of disconnect.

PDF MIME type and download permission are checked by the authenticated server
before streaming. Responses are private/no-store. The server avoids buffering the
whole PDF to avoid Vercel's buffered response limit. Downloads have a two-minute
deadline; the browser's reader still holds the document in memory.

## Verification

Run `npm run verify`. GitHub Actions runs the database suite and type generation.
Contract tests cover the Picker grant's session/origin boundary and response
fields. UI tests cover selection, cancellation, retry, and stale class requests.
Existing transport tests cover pagination, permissions, and streaming over 4.5 MB.

The fictional workspace is `/qa/workspace.html?route=/classes/math3012`.
Add `&drive=disconnected` or `&drive=error` for recovery states. Its Picker stub
simulates selecting a fixture PDF; it does not render Google's popup or establish
production OAuth, API-key restrictions, CSP, streaming, or provider permissions.
After deployment, test the real Picker, cancel with an existing document, open a
PDF, reopen an updated backup, and test disconnect/reconnect.
