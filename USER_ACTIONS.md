# orbitOS — Account setup

Updated 2026-09-04. This is a personal-use app with local development and one
live Vercel/Supabase environment. A separate Preview environment is no longer
required. Deployment and implementation steps live in `IMPLEMENTATION_PLAN.md`;
this file tracks account setup and owner interactions only.

Never record credential values, OAuth codes/state, or populated environment files here.

## Existing targets and completed setup

- **UA-009 — Live Supabase selected:** `tobydev / orbitos`,
  `oidvvenjamgcezdptfjr`, East US / North Virginia (`us-east-1`).
- **UA-002 — Vercel linked:** `Toby Godat's projects / orbitos`, connected to
  `tobygodat/tobiOS`. The live domain is `https://orbitos-virid.vercel.app`.
  Creating or validating a separate Preview deployment is no longer an owner task.
- **UA-006 — Domain:** use that existing Vercel domain. No custom domain or region
  decision is needed unless a concrete problem requires one.
- **UA-001 — Local database:** Docker and local Supabase are working. Migrations,
  local database checks, and generated types were verified on 2026-09-04.
- **UA-005 — Sign-in method:** Google through Supabase Auth, with separate
  read-only consent for Calendar.
- **UA-004 — Live environment:** `APP_URL` and the five Supabase connection
  settings were saved and checked in Vercel Production on 2026-09-03/04.
  Those checks confirm settings at that time, not a successful new release.
- **UA-011 — Credential repair:** modern Supabase publishable/secret keys replaced
  the legacy API keys in Vercel on 2026-09-04; the old JWT-based API keys were
  disabled. The earlier Google secret was also replaced/disabled. No values
  are recorded here.
- **UA-003 — Retired:** no second hosted Supabase project is needed for Preview.

## Google application sign-in — UA-008

Already configured and read back on 2026-09-03:

- Supabase Google provider enabled with owner-supplied credentials.
- Supabase Site URL and Google JavaScript origin:
  `https://orbitos-virid.vercel.app`.
- Exact Supabase allowed return: `https://orbitos-virid.vercel.app/`.
- Google authorized redirect:
  `https://oidvvenjamgcezdptfjr.supabase.co/auth/v1/callback`.

Fresh Google sign-in, return to Home, sign-out, and persisted Todo checks passed
in the live browser on 2026-09-04. No repeated application sign-in setup is needed.
Application sign-in requests identity permissions only and does not connect Calendar.

## Google Calendar — UA-007, remaining owner setup

- **Repair one existing server setting:** the production Calendar storage call
  receives upstream HTTP 401 from Supabase, confirmed in sanitized Vercel logs
  on release `c2d8fd0`. Replace `SUPABASE_SERVICE_ROLE_KEY` in Vercel Production
  with the active secret key for `oidvvenjamgcezdptfjr`. The browser keys and
  Google application sign-in already work. Do not recreate the account setup.
- Calendar endpoints and Settings are implemented. A name-only inspection of
  Vercel Production on 2026-09-04 confirmed all three Google server settings below
  are absent; the health endpoint reports Calendar not configured.
- Enable Calendar API access and configure the live Calendar Web OAuth client
  with exact callback `https://orbitos-virid.vercel.app/api/calendar/callback`,
  retaining the existing Supabase sign-in callback.
- Keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
  `GOOGLE_TOKEN_ENCRYPTION_KEY` in server-side settings. The encryption key is
  32 random bytes encoded as padded standard Base64; do not record it here.
- The owner completes read-only Calendar consent. Verify a real week fetch,
  refresh/reconnect, and saved visibility settings as implementation work.
- Enter credential values directly in Vercel Production, not in chat or tracked
  files, then redeploy. Browser credential entry requires owner handoff; new
  Calendar data-access consent requires confirmation at the action.
- Review provider consent/token-lifetime limits for this personal account.
  Periodic reconnection may be acceptable; public OAuth publishing is not an
  automatic launch requirement. No Preview OAuth client is needed.

## Later cleanup — UA-010

A name-only check on 2026-09-03 found legacy Vercel variables for Telegram,
Anthropic, the vault/SQLite runtime, app-password sessions, and the scanner in
Production and Preview scopes. Confirm which are unused before removing them.
This does not require provisioning or maintaining a Preview app.

Legacy data import and retirement remain optional owner decisions after the
cloud features are useful. No account setup task should block independent coding.
