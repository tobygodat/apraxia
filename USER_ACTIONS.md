# orbitOS user actions

This is the bookmark for work that needs account access or a product decision
from the owner. Implementation work that does not depend on these items can
continue independently.

> Never record passwords, tokens, keys, OAuth state, signed URLs, recovery
> codes, or populated `.env` values here. Record only that an item was
> configured in a named provider and environment.

## Next owner checkpoint

Updated 2026-09-03: the owner confirms Supabase `orbitos` is currently empty
and is the permanent project database, intended for Production (**UA-009**).
It is not disposable Preview infrastructure. The owner separately approved the
non-secret URL settings below; this does not authorize deployment or database changes.

The owner reports Google provider credentials saved in Supabase, a replacement
secret created, and the old secret disabled on 2026-09-03. These are confirmed
owner actions, not a verified end-to-end login. A later read-only check found
Google enabled in Supabase and the old Google secret Disabled/new secret Enabled.
No credential values were revealed, copied, or recorded.

1. Complete real hosted sign-in verification (**UA-008**). Google Calendar
   consent (**UA-007**) is separate.
2. Approve publication of the checked cloud replacement before deployment
   (**UA-002**). Vercel is already linked to the repository, but its first
   deployment used the older published code and failed.

Saved and verified on 2026-09-03 with explicit owner approval:

- Supabase Site URL: `https://orbitos-virid.vercel.app`.
- Supabase allowed return: exactly `https://orbitos-virid.vercel.app/`, with no
  wildcard. Both settings were read back after a page reload.
- Google authorized JavaScript origin: `https://orbitos-virid.vercel.app`, read
  back after saving and reopening the client.
- Google authorized redirect URI:
  `https://oidvvenjamgcezdptfjr.supabase.co/auth/v1/callback`. The owner separately
  approved this addition on 2026-09-03. Google confirmed the client was saved,
  and reopening it showed the exact callback plus the unchanged app origin.
  No secret, scope, or other client field was changed.
- Vercel `APP_URL`: configured as a non-secret Config value in Production only,
  using the assigned app origin. Save success, stored value, and environment
  were verified. No other variable was edited and Redeploy was not selected.

On 2026-09-04, the five Supabase connection settings were verified in Vercel
Production only. The public and server key values were migrated to Supabase's
existing publishable and secret keys, then the legacy JWT-based `anon` and
`service_role` API keys were disabled. No key value is recorded here. No OAuth
scope, database data, migration, or deployment was changed.

Development uses disposable local Supabase. The plan's isolated hosted Preview
target remains unselected (**UA-003**); do not put this permanent project's
credentials in Vercel Preview or run reset/rewind/destructive test suites on it.
Future Production schema setup uses reviewed forward migrations after local
verification and explicit hosted-change approval.

Received targets (read-only dashboard check on 2026-09-03):

- Supabase: `tobydev / orbitos`, project reference `oidvvenjamgcezdptfjr`,
  [project origin](https://oidvvenjamgcezdptfjr.supabase.co). Dashboard reports
  Healthy, East US / North Virginia (`us-east-1`), and no tracked migrations.
  This does not verify table contents, RLS, Auth, or CLI linkage.
  The owner subsequently confirmed it is empty and intended for the actual
  permanent project; emptiness is owner-reported, not a database inspection.
- Vercel: [Toby Godat's projects / orbitos](https://vercel.com/toby-godats-projects/orbitos),
  linked to `tobygodat/tobiOS`. No Production deployment serves traffic; the
  initial deployment from the older PR #5 merge is marked Error. Its failure
  cause has not been diagnosed, and no new deployment was triggered here.
  A follow-up read-only Domains check found `orbitos-virid.vercel.app` assigned
  to Production with status No Deployment. No domain setting was changed.

Do not paste any database password, API secret, OAuth secret, or token here.

The live local [Todos UI preview](http://localhost:5173/qa/todos-workspace.html)
and [Today panel preview](http://localhost:5173/qa/today-panel.html)
can run independently via `npm run dev:web`. They contain fictional test data;
its edits are not saved to Supabase and reset on reload. Local verification
does not complete the outstanding real-stack or hosted checkpoints below.

## Blocking external verification

- [x] **UA-001 · Phase 0 local database — Repair Docker Desktop startup**
  - Owner reports Docker Desktop running and logged in on 2026-09-03.
  - Verified the Linux engine responds with version 28.3.3. The restricted
    execution context cannot access its pipe, but the approved host-level
    read succeeds; this is no longer a Docker startup failure.
  - On 2026-09-04 image downloads and local Supabase startup succeeded without
    network/security changes. Reset, lint, all 166 pgTAP assertions, migration
    rewind/reapply, and canonical `database.ts` generation passed.
  - Real HTTP Todo checks now cover 1,005 eligible tasks and atomic ordering.
    Calendar two-session replay/expiry/rollback checks passed. Calendar's
    service-only Data API adapter and hosted checks remain implementation work.
    See `docs/IMPLEMENTATION_STATUS.md`.

- [ ] **UA-002 · Phase 0 Preview — Authorize and link Vercel**
  - Received: `Toby Godat's projects / orbitos`, with the intended repository
    already linked. Preview verification and publication approval remain open.
  - Action: select the Vercel team, link this Git repository as a project, and
    permit a Preview deployment from the repository root.
  - Blocks: hosted function, SPA deep-link, and Preview-build verification.
  - Done when: a Preview URL serves both `/api/health` and a direct `/todos`
    page refresh.
  - Safe evidence: record the Vercel project name and Preview URL only.

- [ ] **UA-003 · Phase 0 Preview — Create and link non-production Supabase**
  - No Preview database has been selected. The supplied `tobydev / orbitos`
    project is reserved for Production, not this checkpoint.
  - Action: select the Supabase organization and create a hosted project used
    only by Preview. Local Supabase remains the Development database, and
    the permanent project remains isolated from Preview.
  - Blocks: hosted schema, Auth, and RLS verification.
  - Done when: the CLI is linked to the Preview project without committing its
    database password or access token.
  - Safe evidence: record only the project name/reference and environment.

- [x] **UA-004 · Hosting — Configure environment-specific cloud variables**
  - [x] `APP_URL` configured and read back in Vercel Production on 2026-09-03.
  - [x] Supabase URL/public/server settings configured in Vercel Production
    only and read back after reload on 2026-09-04.
  - [x] Browser and server user-scoped keys use the existing Supabase
    publishable key; the privileged server-only setting uses the existing
    Supabase secret key. The legacy JWT-based keys are disabled.
  - Action: store `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
    `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and the
    environment-specific `APP_URL` directly in Vercel. The supplied permanent
    project's values belong only in Production. Preview requires its own
    non-production values when that environment is provisioned.
  - Blocks: a healthy hosted `/api/health` response and authenticated use.
  - Done when: health reports the application environment configured. Calendar
    may remain deferred/degraded.
  - Safe evidence: record only the configured Vercel environment and date.

- [x] **UA-011 · Security — Replace exposed legacy Supabase API keys**
  - During the initial Production environment transfer on 2026-09-03, a
    diagnostic tool output included the legacy server-role key. Its value is
    intentionally omitted.
  - On 2026-09-04, all three Vercel key settings were replaced with the
    project's existing modern publishable/secret keys and verified as
    Production-only. Supabase then confirmed that the legacy `anon` and
    `service_role` API keys were disabled.
  - No deployment was triggered during this repair.

## Later decisions and setup

- [x] **UA-009 · Production — Select the permanent Supabase project**
  - Owner confirmed on 2026-09-03: `tobydev / orbitos`, reference
    `oidvvenjamgcezdptfjr`, is currently empty and intended for the actual project.
  - This completes project selection only. Hosted migrations, Auth setup,
    environment configuration, live verification, and launch remain pending.
  - Never use this project for disposable resets or migration rewind tests.

- [x] **UA-005 · Phase 1 — Choose the initial sign-in method**
  - Owner selected **Google sign-in through Supabase Auth** on 2026-09-03.
  - The decision is complete; Google provider setup is tracked as **UA-008**.
    The sign-in button is implemented and locally checked; live verification
    remains implementation work after provider configuration.
  - Calendar consent remains a separate read-only OAuth flow.

- [ ] **UA-008 · Phase 1 — Configure Google application sign-in**
  - [x] Owner reports on 2026-09-03 that the Google client ID and replacement
    secret are saved directly in Supabase and the previous secret is disabled.
    A read-only check subsequently confirmed the old secret's Disabled status,
    the replacement's Enabled status, and Google's Enabled status in Supabase.
    No secret values were read back or copied.
  - [x] Approved app origin, Supabase Site URL, and exact Supabase return URL
    saved and read back on 2026-09-03.
  - [x] Exact Supabase callback added to Google's authorized redirect URIs with
    separate owner approval on 2026-09-03; save success and reopened value verified.
  - [ ] Pass a real hosted sign-in, session-isolation, and provider-token storage
    check. The overall item remains open until these verification gates pass.
  - In Google Cloud / Google Auth Platform, create or select the orbitOS
    project and configure the app's audience and branding. Create a dedicated
    Web application OAuth client for Production application sign-in.
  - Copy the exact callback URL from the permanent Supabase project's Google
    provider settings into Google's Authorized redirect URIs. This is the
    Supabase Auth callback, not orbitOS's `/api/calendar/callback`.
    For the supplied standard project origin the expected callback is
    `https://oidvvenjamgcezdptfjr.supabase.co/auth/v1/callback`; confirm it in
    the provider panel before saving the Google client.
  - Save the client ID and secret directly in Supabase's Google provider
    settings. Add the actual Production app origin to Google Authorized JavaScript
    origins and Supabase Site URL/redirect settings once that URL is known.
  - App sign-in uses only identity/email/profile permissions. Do not add
    Calendar scopes or reuse the Calendar client/secret for this flow.
  - Use separate Development and isolated Preview clients when configuring
    those environments. No secret belongs in chat or browser environment variables.
  - Official setup: [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google).
  - Security constraint: Supabase Google sign-in can return a Google provider
    token with the app session. The local client now filters those provider
    fields from Supabase-owned session storage, but a real hosted Google flow
    must verify that neither field appears in browser storage. orbitOS must
    never copy, use, or retain it.
  - Done when: the permanent project's Google provider is configured and a real app sign-in
    passes the callback, session-isolation, and browser-storage checks.

- [ ] **UA-006 · Before Production — Choose deployment region and domain**
  - The selected Supabase project is in East US / North Virginia (`us-east-1`).
  - Vercel's Domains page assigns `https://orbitos-virid.vercel.app` to
    Production, with no serving deployment as of the 2026-09-03 read-only check.
    This default address can be used for initial setup; no custom domain was
    requested or configured. Vercel region and live URL verification remain open.

- [ ] **UA-007 · Phase 3 — Configure read-only Google Calendar OAuth**
  - The server read core can be developed without this setup, but its local
    tests do not prove a Google connection. No consent or live fetch has run.
  - Create or authorize the Google Cloud project, enable Calendar API access,
    configure consent, create environment-specific OAuth clients/callbacks,
    and choose an isolated Preview callback strategy.
  - Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a generated
    `GOOGLE_TOKEN_ENCRYPTION_KEY` only in server-side secret stores.
    The encryption key must be 32 cryptographically random bytes encoded as
    padded standard Base64, not a password or arbitrary text. Never paste it here.
  - Move consent out of Testing before relying on long-lived refresh tokens.

- [ ] **UA-010 · Before launch — Review obsolete Vercel environment entries**
  - Read-only name/scope inspection on 2026-09-03 found legacy entries in
    Production and Preview: `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`,
    `ANTHROPIC_API_KEY`, `VAULT_PATH`, `DB_PATH`, `APP_PASSWORD`,
    `SESSION_SECRET`, `SCAN_INTERVAL_MIN`, `CONFIDENCE_THRESHOLD`, `HOST`,
    `PORT`, and `ENV`. No values were revealed or copied.
  - Review and approve removal of obsolete entries before launch, consistent
    with the plan's no-legacy-secret gate. Do not infer they are unused by
    every existing workflow, and do not delete them without approval.
