import { serveDriveFiles } from './driveFiles.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { requireApplicationEnvironment, requireCalendarEnvironment, EnvironmentConfigurationError } from '../env/cloud.js';
import { verifySupabaseSession, SessionVerificationError } from '../auth/verifySession.js';
import { assertDriveMutationRequest, createDriveOAuthAttempt, createDriveOAuthConsumeCommand,
  getDriveOAuthRedirectUri, parseDriveOAuthCallback, DriveOAuthPolicyError, DRIVE_SCOPES,
  validateGrantedDriveScopes } from './oauthPolicy.js';
import { CalendarHttpError, object, readBoundedJson } from '../calendar/calendarHttp.js';
import { createDriveStore, type StoredDriveCredentials } from './driveStore.js';
import { createGoogleOAuthTransport } from './googleOAuthTransport.js';
import { encryptRefreshToken, decryptRefreshToken, TokenEncryptionError } from '../calendar/tokenEncryption.js';

export type DriveAction = 'connect' | 'callback' | 'complete' | 'disconnect' | 'status' | 'files' | 'pdf' | 'picker';
const HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: HEADERS });

/** Each invocation derives ownership from a fresh Auth verification, never request input. */
export function createDriveHandler(action: DriveAction, dependencies: {
  environment?: Record<string, string | undefined>; fetch?: typeof fetch;
} = {}) {
  return async (request: Request): Promise<Response> => {
    try {
      const expectedMethod = (['connect', 'complete', 'disconnect', 'picker'].includes(action)) ? 'POST' : 'GET';
      if (request.method !== expectedMethod) return json({ error: { code: 'invalid_request', message: 'This action is unavailable.' } }, 405);
      const environment = requireApplicationEnvironment(dependencies.environment ?? process.env);
      const fetcher = dependencies.fetch ?? fetch;
      if (action === 'callback') {
        const callback = parseDriveOAuthCallback(request.url, environment.APP_URL);
        const target = new URL('/drive/callback', environment.APP_URL);
        target.hash = new URLSearchParams(callback.status === 'code'
          ? { state: callback.state, code: callback.code } : { state: callback.state, error: 'access_denied' }).toString();
        return new Response(null, { status: 303, headers: { ...HEADERS, Location: target.href } });
      }
      if (expectedMethod === 'POST') assertDriveMutationRequest(request, environment.APP_URL);
      const session = await verifySupabaseSession(request, environment, { fetch: fetcher });
      const store = createDriveStore(environment, request.signal, fetcher);
      const userId = session.userId;
      if (action === 'status') return json((await store.read(userId))?.connection ?? null);
      if (action === 'disconnect') {
        await store.clear(userId, 'disconnected');
        return json({ disconnected: true });
      }
      const drive = requireCalendarEnvironment(dependencies.environment ?? process.env);
      const oauth = createGoogleOAuthTransport(drive, request.signal, fetcher);
      const decrypt = (stored: StoredDriveCredentials): string => {
        if (!stored.envelope || stored.keyVersion !== 1) throw new CalendarHttpError('reconnect_required', 409);
        return decryptRefreshToken(stored.envelope, { userId, connectionId: stored.connection.id, keyVersion: 1 }, drive.GOOGLE_TOKEN_ENCRYPTION_KEY);
      };

      if (action === 'connect') {
        const attempt = createDriveOAuthAttempt(session, { appUrl: environment.APP_URL, clientId: drive.GOOGLE_CLIENT_ID });
        const verifier = randomBytes(32).toString('base64url');
        const authorization = new URL(attempt.authorizationUrl);
        authorization.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
        authorization.searchParams.set('code_challenge_method', 'S256');
        const transaction = attempt.transaction;
        await store.rpc('begin_drive_oauth_attempt', { p_verified_user_id: userId, p_state_hash: transaction.stateHash,
          p_redirect_uri: transaction.redirectUri, p_expires_at: transaction.expiresAt, p_code_verifier: verifier });
        return json({ authorizationUrl: authorization.href });
      }
      if (action === 'complete') {
        const body = await readBoundedJson(new Response(request.body), 16 * 1024, request.signal);
        if (!object(body) || Object.keys(body).some(key => !['state', 'code', 'error'].includes(key)) ||
          typeof body.state !== 'string' || (typeof body.code !== 'string' && typeof body.error !== 'string')) {
          throw new CalendarHttpError('invalid_request', 400);
        }
        const callbackUrl = new URL(getDriveOAuthRedirectUri(environment.APP_URL));
        for (const key of ['state', 'code', 'error']) if (typeof body[key] === 'string') callbackUrl.searchParams.set(key, body[key]);
        const callback = parseDriveOAuthCallback(callbackUrl.href, environment.APP_URL);
        // Read the revision before consuming state/exchanging: disconnect wins against late completions.
        const previous = await store.read(userId);
        const command = createDriveOAuthConsumeCommand(callback, session, environment.APP_URL);
        const consumed = await store.rpc('consume_drive_oauth_attempt', { p_verified_user_id: userId,
          p_state_hash: command.stateHash, p_redirect_uri: command.redirectUri });
        if (!object(consumed) || typeof consumed.code_verifier !== 'string') throw new CalendarHttpError('invalid_request', 400);
        if (callback.status === 'denied') return json({ connected: false, denied: true });
        const tokens = await oauth.exchange(callback.code, command.redirectUri, consumed.code_verifier);
        // A missing replacement must not silently reconnect a different Google account
        // using the previous account's refresh token. Start consent again instead.
        const refreshToken = tokens.refreshToken;
        if (!refreshToken) throw new CalendarHttpError('reconnect_required', 409);
        const id = previous?.connection.id ?? randomUUID();
        const envelope = encryptRefreshToken(refreshToken, { userId, connectionId: id, keyVersion: 1 }, drive.GOOGLE_TOKEN_ENCRYPTION_KEY);
        if (!await store.save(userId, id, previous?.connection.updatedAt ?? null, envelope, tokens.scopes)) {
          throw new CalendarHttpError('invalid_request', 409);
        }
        return json({ connected: true });
      }
      const stored = await store.read(userId);
      if (!stored || stored.connection.connectionState !== 'connected' || !stored.envelope) {
        throw new CalendarHttpError('reconnect_required', 409);
      }
      let accessToken: string;

      try {
        validateGrantedDriveScopes(stored.connection.grantedScopes.join(' '));
        const originalRefreshToken = decrypt(stored);
        const tokens = await oauth.refresh(originalRefreshToken);
        const envelope = tokens.refreshToken ? encryptRefreshToken(tokens.refreshToken,
          { userId, connectionId: stored.connection.id, keyVersion: 1 }, drive.GOOGLE_TOKEN_ENCRYPTION_KEY) : stored.envelope;

        const saved = await store.save(userId, stored.connection.id, stored.connection.updatedAt, envelope, DRIVE_SCOPES);
        if (!saved) {
          // A concurrent refresh can succeed; a disconnect or new grant must stop this request.
          const current = await store.read(userId);
          if (!current || current.connection.connectionState !== 'connected' || current.envelope !== envelope) {
            throw new CalendarHttpError('reconnect_required', 409);
          }
        }
        accessToken = tokens.accessToken;
      } catch (error) {
        if (error instanceof TokenEncryptionError || error instanceof DriveOAuthPolicyError ||
          (error instanceof CalendarHttpError && error.code === 'reconnect_required')) {
          await store.clear(userId, 'reconnect_required', stored.connection.updatedAt);
          throw new CalendarHttpError('reconnect_required', 409);
        }
        throw error;
      }
      if (action === 'picker') {
        const config = dependencies.environment ?? process.env;
        const developerKey = config.GOOGLE_PICKER_API_KEY?.trim();
        const appId = config.GOOGLE_PICKER_APP_ID?.trim();
        if (!developerKey || !appId || !/^\d+$/.test(appId)) {
          return json({ error: { code: 'not_configured', message: 'Google Picker setup is not finished yet.' } }, 503);
        }
        // Explicit Google Picker handoff: temporary access only, never the refresh
        // token, encryption key, or client secret. No browser persistence.
        return json({ accessToken, developerKey, appId });
      }
      return await serveDriveFiles(action, request, accessToken, fetcher, HEADERS).catch(async (error: unknown) => {
        if (error instanceof CalendarHttpError && error.code === 'reconnect_required') {
          const current = await store.read(userId);
          if (current?.envelope === stored.envelope) await store.clear(userId, 'reconnect_required', current.connection.updatedAt);
        }
        throw error;
      });
    } catch (error) {
      if (error instanceof SessionVerificationError) return json({ error: { code: error.code, message: error.message } },
        error.code === 'unauthenticated' ? 401 : 503);
      if (error instanceof EnvironmentConfigurationError) return json({ error: { code: 'not_configured', message: 'Drive setup is not finished yet.' } }, 503);
      if (error instanceof DriveOAuthPolicyError) {
        return json({ error: { code: 'invalid_request', message: 'Drive request could not be verified. Try again.' } }, 400);
      }
      if (error instanceof CalendarHttpError) return json({ error: { code: error.code, message: error.code === 'reconnect_required' ? 'Reconnect Google Drive to continue.' : 'Google Drive could not load. Try again.' } }, error.status);
      return json({ error: { code: 'drive_unavailable', message: 'Drive is temporarily unavailable. Try again.' } }, 502);
    }
  };
}
