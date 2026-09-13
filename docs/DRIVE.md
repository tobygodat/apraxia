# Google Drive notes

Classes can connect Google Drive, browse My Drive folders, remember a folder per
class, and open its PDF backups in the existing reader. Folder choices remain
browser/account-local, like Classes. Only direct folder children are listed;
choose a nested folder to read its notes. Lists support pagination and explicit
refresh. No background synchronization or Drive writes run.

## Deployment setup

1. Apply `supabase/migrations/20260913000100_google_drive.sql` after inspecting
   the hosted database and preserving a backup, following `CLOUD_DEVELOPMENT.md`.
   This adds separate Drive connection, private credential, and OAuth tables.
2. Enable Google Drive API in the project containing the existing Google OAuth
   web client. Register the exact redirect
   `https://orbitos-virid.vercel.app/api/drive/callback` alongside Calendar's
   existing redirect. For local full-stack work use the configured `APP_URL`
   followed by `/api/drive/callback`.
3. The server reuses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
   `GOOGLE_TOKEN_ENCRYPTION_KEY`; no browser Google credential is required.
   Request consent for `https://www.googleapis.com/auth/drive.readonly`.
   This scope permits viewing/downloading all Drive files; the app exposes only
   folder and PDF browsing. Google documents its classification and requirements
   in [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
4. Deploy to the existing app, open a class, select **Connect Google Drive**, and
   complete Google consent. App sign-in and Calendar consent do not grant Drive
   access. Select the class's Goodnotes backup folder with **Use this folder**.

## Security and recovery

Every request verifies the Supabase session server-side. Mutations require the
configured origin. Owner-bound, one-use OAuth state and PKCE are consumed before
code exchange. Refresh tokens are encrypted with the existing AES-GCM envelope
and stored in Drive's private table. Browser roles cannot invoke credential RPCs
or access the new tables. Conditional credential writes prevent late refreshes
from reconnecting a disconnected account.

A reconnect must return a fresh refresh token; an omitted token does not silently
reuse another Google account's previous credentials. Start consent again if
Google omits it. Disconnect deletes Drive credentials and pending attempts; it
does not revoke the shared Google client grant, which could affect Calendar.
Revoking the app in Google, or disconnecting Calendar through its existing
revocation flow, may require reconnecting Drive too.

PDFs are checked for their MIME type and download permission before being
streamed through the authenticated server endpoint. Refresh/access tokens never
enter the browser. Responses are private/no-store. The server does not buffer the
whole PDF, avoiding the buffered Vercel response-size limit; see
[Vercel's streaming guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).
Downloads have a two-minute deadline. The browser still loads the PDF into memory
for the existing reader; very large documents remain subject to device memory and
network speed. **Open in Drive** is available alongside each PDF.

## Verification

Run `npm run verify` locally. GitHub Actions runs the full database suite and
generates types; see [the CI workflow](CLOUD_DEVELOPMENT.md#github-actions).
The embedded PostgreSQL tests exercise credential isolation, one-time state, and
stale writes. The transport tests check narrow file projections, pagination,
permission failures, and streaming a response over 4.5 MB.

The fictional workspace is `/qa/workspace.html?route=/classes/math3012`.
Add `&drive=disconnected` or `&drive=error` for recovery states. It exercises
folder selection, persistence, and the real PDF reader without contacting Google.
It does not establish production OAuth, streaming, or provider permissions.
After deployment, verify consent, a real PDF larger than 4.5 MB, updated backups
after Refresh and reopening, pagination, revoked access, and disconnect.
