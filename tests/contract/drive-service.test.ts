import { describe, expect, it, vi } from 'vitest';
import { createDriveHandler } from '../../server/drive/driveHandlers';
import { createGoogleOAuthTransport } from '../../server/drive/googleOAuthTransport';
import { DRIVE_SCOPES } from '../../server/drive/oauthPolicy';
import { encryptRefreshToken } from '../../server/calendar/tokenEncryption';
import { createDriveStore } from '../../server/drive/driveStore';

const userId = '11111111-1111-4111-8111-111111111111';
const environment = {
  APP_URL: 'https://app.example.test', VITE_SUPABASE_URL: 'https://db.example.test', SUPABASE_URL: 'https://db.example.test',
  VITE_SUPABASE_ANON_KEY: 'sb_publishable_test', SUPABASE_ANON_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
  GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'google-secret', GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
};
const state = Buffer.alloc(32, 1).toString('base64url');
const request = (action: string, body?: unknown) => new Request(`${environment.APP_URL}/api/drive/${action}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Authorization: 'Bearer session-token', Origin: environment.APP_URL, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const tokens = { access_token: 'access-token', token_type: 'Bearer', refresh_token: 'refresh-token', scope: DRIVE_SCOPES.join(' ') };
const config = { GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_TOKEN_ENCRYPTION_KEY: environment.GOOGLE_TOKEN_ENCRYPTION_KEY };
const connectionId = '22222222-2222-4222-8222-222222222222';
const stored = () => ({ connection: { id: connectionId, connection_state: 'connected', granted_scopes: [...DRIVE_SCOPES],
  created_at: '2026-09-04T12:00:00Z', updated_at: '2026-09-04T12:00:00Z' },
  envelope: encryptRefreshToken('existing-refresh', { userId, connectionId, keyVersion: 1 }, environment.GOOGLE_TOKEN_ENCRYPTION_KEY), key_version: 1 });

describe('Drive endpoint session and callback boundary', () => {
  it.each(['sb_secret_fixture-key', 'legacy.service-role.jwt'])('reads a disconnected status with the correct headers for %s', async key => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(null));
    const result = await createDriveStore({ ...environment, SUPABASE_SERVICE_ROLE_KEY: key }, new AbortController().signal, fetcher).read(userId);
    expect(result).toBeNull();
    const headers = new Headers(fetcher.mock.calls[0]![1]!.headers);
    expect(headers.get('apikey')).toBe(key);
    expect(headers.get('authorization')).toBe(key.startsWith('sb_secret_') ? null : `Bearer ${key}`);
  });

  it('logs only the static RPC name, status, and provider code when storage fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ code: 'PGRST202',
      message: 'private-provider-message', details: 'private-token-value', hint: userId }, { status: 404 }));
    await expect(createDriveStore(environment, new AbortController().signal, fetcher).read(userId)).rejects.toThrow();
    expect(warning).toHaveBeenCalledExactlyOnceWith('Drive storage request failed.', {
      operation: 'read_drive_credentials', status: 404, code: 'PGRST202',
    });
    const logged = JSON.stringify(warning.mock.calls);
    for (const sensitive of ['private-provider-message', 'private-token-value', userId, environment.SUPABASE_SERVICE_ROLE_KEY]) {
      expect(logged).not.toContain(sensitive);
    }
  });

  it('does not log arbitrary text supplied in a provider code field', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ code: 'private-token-value', message: 'private-provider-message' }, { status: 401 }));
    await expect(createDriveStore(environment, new AbortController().signal, fetcher).read(userId)).rejects.toThrow();
    expect(warning).toHaveBeenCalledExactlyOnceWith('Drive storage request failed.', {
      operation: 'read_drive_credentials', status: 401,
    });
  });

  it('moves callback data into a same-origin fragment without exchanging or verifying a code', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await createDriveHandler('callback', { environment, fetch: fetcher })(new Request(
      `${environment.APP_URL}/api/drive/callback?state=${state}&code=private-code`,
    ));
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/drive/callback');
    expect(location.search).toBe('');
    expect(new URLSearchParams(location.hash.slice(1)).get('code')).toBe('private-code');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a callback sent to another origin', async () => {
    const response = await createDriveHandler('callback', { environment })(new Request(
      `https://evil.example.test/api/drive/callback?state=${state}&code=private-code`,
    ));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private-code');
  });

  it('rejects cross-origin mutations before contacting Auth or storage', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await createDriveHandler('connect', { environment, fetch: fetcher })(new Request(
      `${environment.APP_URL}/api/drive/connect`, { method: 'POST', headers: {
        Authorization: 'Bearer session-token', Origin: 'https://evil.example.test', 'Content-Type': 'application/json',
      }, body: '{}' },
    ));
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('persists the verified owner and PKCE verifier before returning an authorization URL', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: userId, role: 'authenticated', is_anonymous: false });
      return Response.json({ id: 'attempt', expires_at: '2026-09-04T12:10:00Z' });
    });
    const response = await createDriveHandler('connect', { environment, fetch: fetcher })(request('connect', {}));
    expect(response.status).toBe(200);
    const authorization = new URL((await response.json() as { authorizationUrl: string }).authorizationUrl);
    const stored = JSON.parse(fetcher.mock.calls[1]![1]!.body as string) as Record<string, string>;
    expect(stored.p_verified_user_id).toBe(userId);
    expect(stored.p_code_verifier).toMatch(/^[\w-]{43}$/);
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).not.toBe(stored.p_code_verifier);
    expect(stored.p_state_hash).not.toBe(authorization.searchParams.get('state'));
  });

  it('never exchanges a code when atomic state consumption is rejected', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: userId, role: 'authenticated', is_anonymous: false });
      if (String(url).endsWith('/read_drive_credentials')) return Response.json(null);
      return Response.json({ message: 'sensitive-database-detail' }, { status: 400 });
    });
    const response = await createDriveHandler('complete', { environment, fetch: fetcher })(request('complete', { state, code: 'private-code' }));
    expect(response.status).toBe(400);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('googleapis.com'))).toBe(false);
    expect(await response.text()).not.toContain('sensitive-database-detail');
  });

  it('consumes an owner-bound denial without touching Google or credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: userId, role: 'authenticated', is_anonymous: false });
      if (String(url).endsWith('/read_drive_credentials')) return Response.json(null);
      return Response.json({ code_verifier: state });
    });
    const response = await createDriveHandler('complete', { environment, fetch: fetcher })(request('complete', { state, error: 'access_denied' }));
    expect(await response.json()).toEqual({ connected: false, denied: true });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('googleapis.com'))).toBe(false);
  });

  it('persists an encrypted refresh token and returns no credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: userId, role: 'authenticated', is_anonymous: false });
      if (String(url).endsWith('/read_drive_credentials')) return Response.json(null);
      if (String(url).endsWith('/consume_drive_oauth_attempt')) return Response.json({ code_verifier: state });
      if (String(url).endsWith('/token')) return Response.json(tokens);
      return Response.json(true);
    });
    const response = await createDriveHandler('complete', { environment, fetch: fetcher })(request('complete', { state, code: 'private-code' }));
    expect(await response.json()).toEqual({ connected: true });
    const persisted = fetcher.mock.calls.find(([url]) => String(url).endsWith('/save_drive_credentials'))!;
    expect(persisted[1]!.body).not.toContain('refresh-token');
    expect(persisted[1]!.body).not.toContain('access-token');
    const exchange = fetcher.mock.calls.find(([url]) => String(url).endsWith('/token'))!;
    expect(new URLSearchParams(exchange[1]!.body as string).get('code_verifier')).toBe(state);
  });

  it('does not save a grant if Google omits its first refresh token', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: userId, role: 'authenticated', is_anonymous: false });
      if (String(url).endsWith('/read_drive_credentials')) return Response.json(null);
      if (String(url).endsWith('/consume_drive_oauth_attempt')) return Response.json({ code_verifier: state });
      return Response.json({ ...tokens, refresh_token: undefined });
    });
    const response = await createDriveHandler('complete', { environment, fetch: fetcher })(request('complete', { state, code: 'private-code' }));
    expect(response.status).toBe(409);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/save_drive_credentials'))).toBe(false);
  });

  it('does not reuse another Google account when reconnect omits a refresh token', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: userId, role: 'authenticated', is_anonymous: false });
      if (String(url).endsWith('/read_drive_credentials')) return Response.json(stored());
      if (String(url).endsWith('/consume_drive_oauth_attempt')) return Response.json({ code_verifier: state });
      if (String(url).endsWith('/token')) return Response.json({ ...tokens, refresh_token: undefined });
      return Response.json(true);
    });
    const response = await createDriveHandler('complete', { environment, fetch: fetcher })(request('complete', { state, code: 'private-code' }));
    expect(response.status).toBe(409);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/save_drive_credentials'))).toBe(false);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
  });

  it('clears a revoked grant with its expected revision', async () => {
    const existing = stored();
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: userId, role: 'authenticated', is_anonymous: false });
      if (String(url).endsWith('/read_drive_credentials')) return Response.json(existing);
      if (String(url).endsWith('/token')) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json(true);
    });
    const response = await createDriveHandler('files', { environment, fetch: fetcher })(request('files'));
    expect(response.status).toBe(409);
    const clear = fetcher.mock.calls.find(([url]) => String(url).endsWith('/clear_drive_credentials'))!;
    expect(JSON.parse(clear[1]!.body as string)).toMatchObject({ p_state: 'reconnect_required', p_expected_updated_at: existing.connection.updated_at });
  });

  it('can disconnect even when the Google configuration has been removed', async () => {
    const fetcher = vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: userId, role: 'authenticated', is_anonymous: false });
      if (String(url).endsWith('/read_drive_credentials')) return Response.json(stored());
      return Response.json(true);
    });
    const response = await createDriveHandler('disconnect', { environment: { ...environment, GOOGLE_CLIENT_SECRET: '' }, fetch: fetcher })(request('disconnect', {}));
    expect(await response.json()).toEqual({ disconnected: true });
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/clear_drive_credentials'))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('googleapis.com'))).toBe(false);
  });

});

describe('Google OAuth transport', () => {
  it('keeps omitted refresh-token and scope fields explicit during refresh', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ access_token: 'new-access', token_type: 'Bearer' }));
    const result = await createGoogleOAuthTransport(config, new AbortController().signal, fetcher).refresh('old-refresh');
    expect(result.refreshToken).toBeNull();
    expect(result.scopes).toEqual(DRIVE_SCOPES);
  });
  it('maps a revoked refresh grant to reconnect without provider text', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: 'invalid_grant', error_description: 'private-details' }, { status: 400 }));
    await expect(createGoogleOAuthTransport(config, new AbortController().signal, fetcher).refresh('old-refresh'))
      .rejects.toMatchObject({ code: 'reconnect_required', message: 'Reconnect Google Calendar to continue.' });
  });
  it('rejects extra write scopes instead of persisting a write-capable grant', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ...tokens, scope: `${tokens.scope} https://www.googleapis.com/auth/drive` }));
    await expect(createGoogleOAuthTransport(config, new AbortController().signal, fetcher).exchange('code', 'https://app.example.test/api/drive/callback', state))
      .rejects.toThrow('Drive authorization could not be verified');
  });
});
