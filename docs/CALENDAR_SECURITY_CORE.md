# Calendar security core and integration boundary

These server-only helpers and database functions prepare Phase 3. They do not
expose a live connect, callback, or disconnect route. Local embedded PostgreSQL
tests exercise transaction persistence and consumption; local Supabase pgTAP and
concurrent-request checks also pass. Hosted OAuth verification remains open. No Google account or live
credential was used.

## Verified application identity

`verifySupabaseSession` sends the request's single Bearer credential to the
configured Supabase Auth user endpoint. It does not authorize from decoded JWT
claims, cookies, query parameters, or a browser-supplied owner. It returns only
the verified permanent user's UUID; anonymous and deleted users are rejected.
Supabase documents the network-backed identity check in its
[getUser reference](https://supabase.com/docs/reference/javascript/auth-getuser).

The request uses the configured public API key, never the service-role key,
and disallows redirects and caching. A five-second deadline and a 64 KiB body
limit bound the verification. Caller cancellation, malformed responses, and
provider failures produce sanitized errors; no raw body, credential, or email
is attached to an exception or retained in the identity result.
HTTP adapters must preserve or reject duplicate Authorization headers before
constructing the Fetch Request; a discarded duplicate cannot be detected later.

## Refresh-token envelope

The `GOOGLE_TOKEN_ENCRYPTION_KEY` format is now exactly 32 cryptographically
random bytes encoded as padded standard Base64. A long password or arbitrary
32-character string is not a substitute. Health reports an invalid format as
degraded Calendar configuration without printing the value. Encoding checks do
not prove entropy: provision the value using a secure random generator directly
into the environment's server secret store. No deployment key was generated
or configured here; test vectors are not deployment credentials.

`tokenEncryption.ts` uses Node's AES-256-GCM implementation, a fresh 12-byte
nonce, and a 16-byte authentication tag. Authenticated associated data binds the
envelope to its purpose, format version, owner UUID, connection UUID, and key
version. Substituting any of them makes decryption fail. The canonical private
text envelope contains only version metadata, nonce, ciphertext, and tag.
Tokens are preserved exactly, never trimmed, and authentication completes
before plaintext is returned. See [Node's crypto API](https://nodejs.org/docs/latest-v22.x/api/crypto.html).

The helper clears owned temporary key/plaintext buffers on both success and
failure. JavaScript strings and library-internal copies cannot be guaranteed
to be erased. Keys and decrypted tokens must stay in request-local server
memory and must never be placed in browser storage, logs, or response bodies.
Rotating a key requires retaining the previous key long enough to authenticate
and re-encrypt its records; an operational rotation procedure remains pending.

## OAuth policy

`oauthPolicy.ts` derives one callback URI from the configured `APP_URL`, not a
Host or forwarded header. JSON mutation requests must be same-origin POSTs;
this origin check supplements, but never replaces, verified authentication.
Callback parsing requires the exact registered base URI, one canonical random
state, and one code or denial. Extra provider metadata is not trusted.

Authorization uses a 32-byte random state and ten-minute expiry. Only a SHA-256
hash of the transmitted state enters the pending private transaction projection.
The URL requests offline access and only Calendar-list read and event read.
Broader previously granted permissions are not merged. The eventual token
exchange must verify that the returned scope set is exactly the two allowed
scopes before retaining credentials. This policy follows
[Google's authorization guidance](https://developers.google.com/identity/protocols/oauth2/web-server)
and [Calendar scope definitions](https://developers.google.com/workspace/calendar/api/auth).

The consume command derives its owner from the verified session, not callback
query fields. Parsing or possessing state alone does not authenticate a user.

## Atomic private transaction store

Migration 005 supplies `begin_calendar_oauth_transaction` and
`consume_calendar_oauth_transaction` as scalar JSON functions in `public`.
Only the server's `service_role` may execute them; `anon`, `authenticated`,
`PUBLIC`, and the application helper role receive no EXECUTE privilege. They
are security invokers with an empty search path and do not elevate a caller.
The private table, structural validator, and credentials remain inaccessible
to browser roles. This follows Supabase's explicit
[function privilege model](https://supabase.com/docs/guides/database/functions).

The verified owner argument exists solely for the server-to-database call.
The eventual handler must derive it from `verifySupabaseSession`; it must
never accept or forward an owner from browser input. SQL bounds the state hash
and redirect structure, while the server policy is responsible for parsing
and deriving the exact canonical callback from configured `APP_URL`.

Creation stores only the hashed state projection and returns `{id, expires_at}`.
The database records its own creation time and caps expiry at the earlier of
the requested expiry and ten minutes later. It never extends a shorter
requested expiry. Hash collisions and missing owners fail without replacement.
Persist successfully before returning the Google authorization URL.

Consumption locks the row matching owner, hash, exact redirect, and unused
state. Only after acquiring that lock does it read `clock_timestamp()`, reject
expired/nonfinite/future-created/overlong state, and mark the row consumed.
The result contains only `{id, consumed_at}`. This ordering addresses time
spent waiting for a row lock: PostgreSQL distinguishes the actual clock from
[statement and transaction timestamps](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT),
and rechecks a locked row's search condition after a competing update under
[Read Committed isolation](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED).
The read and update are inside one database function, never two client calls.

The future adapter must confirm committed consumption before exchanging a
Google code. Denials also consume state. Do not perform the network exchange
while holding a database transaction open. If persistence or consumption has
an uncertain outcome, fail closed and start a fresh connection attempt; a
blind retry must never turn a missing acknowledgement into permission to
exchange a code. A rolled-back database transaction is not consumption.

Expected invalid, missing, expired, reused, mismatched, or conflicting input
gets the same sanitized `22023` error. This is not a complete transport error
sanitizer: argument-cast errors occur before function entry, and cancellation,
permission, or serialization errors may come from PostgreSQL directly. The
adapter must bound requests/lock waits and map every failure without exposing
database messages, SQL context, state hashes, callback codes, or credentials.

Embedded tests cover the actual policy-to-SQL lifecycle with a fake Auth
provider, role denials, expiry, exact binding, rollback, and sequential reuse.
The pgTAP suite's 25 assertions passed on local Supabase on 2026-09-04.
Neither suite proves simultaneous consumption or a lock held past expiry.

Before release, use two independent sessions on disposable local Supabase to
verify that one concurrent consume succeeds and the other fails; that a waiter
released after expiry fails without consumption; and that rollback releases
an attempt for a still-valid retry. Repeat access-denial checks through the
real Data API, not just SQL roles. No hosted/private data is needed for these
checks.

`npm run db:test:oauth-concurrency` now implements those three multi-session
scenarios against only the checked local PostgreSQL 17 Supabase container.
It observes `pg_blocking_pids` and independent backend identities rather than
assuming overlapping promises prove concurrency. A unique fictional Auth user
and three transactions are cleaned up by exact generated identifiers; no
reset, broad delete, or hosted connection is accepted. Its 27 safety-guard
tests pass. All three actual database scenarios and exact fixture cleanup also
passed on 2026-09-04 after local Supabase became available;
see `CLOUD_DEVELOPMENT.md` for the invocation and safeguards.

## Required before opening the routes

- Migration 005, generated database types, and the two-session checks are verified
  locally. Wire the bounded server-only transaction adapter and complete the real
  Data API access checks above.
- Implement and review the browser-to-server session handoff for Google's
  top-level callback. A normal redirect does not carry the SPA's Bearer header;
  the saved user ID or possession of state alone is not current-session proof.
- Add authorization-code binding/PKCE where supported, exact token-exchange
  redirect matching, and a maintained server-side Google OAuth transport.
- Keep a valid existing refresh token when Google omits a replacement. Validate
  scopes, handle refresh and revocation, and persist status changes atomically.
- Enforce no-store/no-referrer behavior and prevent callback query material
  from entering application/hosting logs. Check the real flow on the live app.
- Wire the generated-type private-store adapter and Calendar read transport,
  then connect Settings and independent Home loading.

These are implementation gates, not additional owner chores. Account setup
and the initial app sign-in choice remain in `USER_ACTIONS.md`.
