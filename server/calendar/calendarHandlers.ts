import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { requireApplicationEnvironment, requireCalendarEnvironment, EnvironmentConfigurationError } from '../env/cloud.js';
import { verifySupabaseSession, SessionVerificationError } from '../auth/verifySession.js';
import { assertCalendarMutationRequest, createCalendarOAuthAttempt, createCalendarOAuthConsumeCommand,
  getCalendarOAuthRedirectUri, parseCalendarOAuthCallback, CalendarOAuthPolicyError, CALENDAR_READ_SCOPES,
  validateGrantedCalendarScopes } from './oauthPolicy.js';
import { CalendarHttpError, boundedFetchJson, object, readBoundedJson } from './calendarHttp.js';
import { createCalendarStore, type StoredCalendarCredentials } from './calendarStore.js';
import { createGoogleOAuthTransport } from './googleOAuthTransport.js';
import { encryptRefreshToken, decryptRefreshToken, TokenEncryptionError } from './tokenEncryption.js';
import { createGoogleCalendarReadTransport } from './googleCalendarTransport.js';
import { loadCalendarWeek, CalendarProviderError } from './loadCalendarWeek.js';
import { buildCalendarWeekWindow, CalendarWeekRequestError } from './weekWindow.js';

export type CalendarAction = 'connect' | 'callback' | 'complete' | 'disconnect' | 'status' | 'calendars' | 'events';
const HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff' };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: HEADERS });

/** Each invocation derives ownership from a fresh Auth verification, never request input. */
export function createCalendarHandler(action: CalendarAction, dependencies: {
  environment?: Record<string, string | undefined>; fetch?: typeof fetch;
} = {}) {
  return async (request: Request): Promise<Response> => {
    try {
      const expectedMethod = ['connect', 'complete', 'disconnect'].includes(action) ? 'POST' : 'GET';
      if (request.method !== expectedMethod) return json({ error: { code: 'invalid_request', message: 'This action is unavailable.' } }, 405);
      const environment = requireApplicationEnvironment(dependencies.environment ?? process.env);
      const fetcher = dependencies.fetch ?? fetch;
      if (action === 'callback') {
        const callback = parseCalendarOAuthCallback(request.url, environment.APP_URL);
        const target = new URL('/calendar/callback', environment.APP_URL);
        target.hash = new URLSearchParams(callback.status === 'code'
          ? { state: callback.state, code: callback.code } : { state: callback.state, error: 'access_denied' }).toString();
        return new Response(null, { status: 303, headers: { ...HEADERS, Location: target.href } });
      }
      if (expectedMethod === 'POST') assertCalendarMutationRequest(request, environment.APP_URL);
      const session = await verifySupabaseSession(request, environment, { fetch: fetcher });
      const store = createCalendarStore(environment, request.signal, fetcher);
      const userId = session.userId;
      if (action === 'status') return json((await store.read(userId))?.connection ?? null);
      if (action === 'disconnect') {
        const previous = await store.read(userId);
        await store.clear(userId, 'disconnected');
        if (previous?.envelope && previous.keyVersion === 1) {
          try {
            const configuration = requireCalendarEnvironment(dependencies.environment ?? process.env);
            const refreshToken = decryptRefreshToken(previous.envelope,
              { userId, connectionId: previous.connection.id, keyVersion: 1 }, configuration.GOOGLE_TOKEN_ENCRYPTION_KEY);
            await createGoogleOAuthTransport(configuration, request.signal, fetcher).revoke(refreshToken);
          } catch { /* Local disconnect also works after Calendar configuration/key loss. */ }
        }
        return json({ disconnected: true });
      }
      const parameters = new URL(request.url).searchParams;
      if (action === 'events') {
        if (parameters.getAll('monday').length !== 1 || [...parameters.keys()].some(key => key !== 'monday')) {
          throw new CalendarHttpError('invalid_request', 400);
        }
        buildCalendarWeekWindow(parameters.get('monday'), 'UTC');
      }
      const calendar = requireCalendarEnvironment(dependencies.environment ?? process.env);
      const oauth = createGoogleOAuthTransport(calendar, request.signal, fetcher);
      const decrypt = (stored: StoredCalendarCredentials): string => {
        if (!stored.envelope || stored.keyVersion !== 1) throw new CalendarHttpError('reconnect_required', 409);
        return decryptRefreshToken(stored.envelope, { userId, connectionId: stored.connection.id, keyVersion: 1 }, calendar.GOOGLE_TOKEN_ENCRYPTION_KEY);
      };

      if (action === 'connect') {
        const attempt = createCalendarOAuthAttempt(session, { appUrl: environment.APP_URL, clientId: calendar.GOOGLE_CLIENT_ID });
        const verifier = randomBytes(32).toString('base64url');
        const authorization = new URL(attempt.authorizationUrl);
        authorization.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
        authorization.searchParams.set('code_challenge_method', 'S256');
        const transaction = attempt.transaction;
        await store.rpc('begin_calendar_oauth_attempt', { p_verified_user_id: userId, p_state_hash: transaction.stateHash,
          p_redirect_uri: transaction.redirectUri, p_expires_at: transaction.expiresAt, p_code_verifier: verifier });
        return json({ authorizationUrl: authorization.href });
      }
      if (action === 'complete') {
        const body = await readBoundedJson(new Response(request.body), 16 * 1024, request.signal);
        if (!object(body) || Object.keys(body).some(key => !['state', 'code', 'error'].includes(key)) ||
          typeof body.state !== 'string' || (typeof body.code !== 'string' && typeof body.error !== 'string')) {
          throw new CalendarHttpError('invalid_request', 400);
        }
        const callbackUrl = new URL(getCalendarOAuthRedirectUri(environment.APP_URL));
        for (const key of ['state', 'code', 'error']) if (typeof body[key] === 'string') callbackUrl.searchParams.set(key, body[key]);
        const callback = parseCalendarOAuthCallback(callbackUrl.href, environment.APP_URL);
        // Read the revision before consuming state/exchanging: disconnect wins against late completions.
        const previous = await store.read(userId);
        const command = createCalendarOAuthConsumeCommand(callback, session, environment.APP_URL);
        const consumed = await store.rpc('consume_calendar_oauth_attempt', { p_verified_user_id: userId,
          p_state_hash: command.stateHash, p_redirect_uri: command.redirectUri });
        if (!object(consumed) || typeof consumed.code_verifier !== 'string') throw new CalendarHttpError('invalid_request', 400);
        if (callback.status === 'denied') return json({ connected: false, denied: true });
        const tokens = await oauth.exchange(callback.code, command.redirectUri, consumed.code_verifier);
        let refreshToken = tokens.refreshToken;
        if (!refreshToken) {
          if (!previous?.envelope) throw new CalendarHttpError('reconnect_required', 409);
          try {
            validateGrantedCalendarScopes(previous.connection.grantedScopes.join(' '));
            const existingToken = decrypt(previous);
            // Consent can omit a replacement. Only reuse a credential that still refreshes,
            // and retain any rotation returned by that verification request.
            const verified = await oauth.refresh(existingToken);
            refreshToken = verified.refreshToken ?? existingToken;
          } catch (error) {
            if (error instanceof TokenEncryptionError || error instanceof CalendarOAuthPolicyError ||
              (error instanceof CalendarHttpError && error.code === 'reconnect_required')) {
              await store.clear(userId, 'reconnect_required', previous.connection.updatedAt);
              throw new CalendarHttpError('reconnect_required', 409);
            }
            throw error;
          }
        }
        const id = previous?.connection.id ?? randomUUID();
        const envelope = encryptRefreshToken(refreshToken, { userId, connectionId: id, keyVersion: 1 }, calendar.GOOGLE_TOKEN_ENCRYPTION_KEY);
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
      let usedEnvelope = stored.envelope;
      try {
        validateGrantedCalendarScopes(stored.connection.grantedScopes.join(' '));
        const originalRefreshToken = decrypt(stored);
        const tokens = await oauth.refresh(originalRefreshToken);
        const envelope = tokens.refreshToken ? encryptRefreshToken(tokens.refreshToken,
          { userId, connectionId: stored.connection.id, keyVersion: 1 }, calendar.GOOGLE_TOKEN_ENCRYPTION_KEY) : stored.envelope;
        usedEnvelope = envelope;
        const saved = await store.save(userId, stored.connection.id, stored.connection.updatedAt, envelope, CALENDAR_READ_SCOPES);
        if (!saved) {
          // A concurrent refresh can succeed; a disconnect or new grant must stop this request.
          const current = await store.read(userId);
          if (!current || current.connection.connectionState !== 'connected' || current.envelope !== envelope) {
            throw new CalendarHttpError('reconnect_required', 409);
          }
        }
        accessToken = tokens.accessToken;
      } catch (error) {
        if (error instanceof TokenEncryptionError || error instanceof CalendarOAuthPolicyError ||
          (error instanceof CalendarHttpError && error.code === 'reconnect_required')) {
          await store.clear(userId, 'reconnect_required', stored.connection.updatedAt);
          throw new CalendarHttpError('reconnect_required', 409);
        }
        throw error;
      }
      const transport = createGoogleCalendarReadTransport({ accessToken, fetch: fetcher });
      const expireUsedGrant = async () => {
        const current = await store.read(userId);
        if (current?.envelope === usedEnvelope) await store.clear(userId, 'reconnect_required', current.connection.updatedAt);
      };
      const discovered = await transport.listCalendars({ signal: request.signal }).catch(async (error: unknown) => {
        if (error instanceof CalendarProviderError && error.code === 'reconnect_required') await expireUsedGrant();
        throw error;
      });
      const preferences = await store.syncPreferences(userId, discovered);
      if (action === 'calendars') return json(preferences);
      const { response, value } = await boundedFetchJson(`${environment.SUPABASE_URL}/rest/v1/profiles?select=timezone`, {
        signal: request.signal, headers: { apikey: environment.SUPABASE_ANON_KEY,
          Authorization: request.headers.get('authorization')! },
      }, fetcher);
      if (!response.ok || !Array.isArray(value) || value.length !== 1 || !object(value[0]) || typeof value[0].timezone !== 'string') {
        throw new CalendarHttpError('calendar_unavailable');
      }
      buildCalendarWeekWindow(parameters.get('monday'), value[0].timezone);
      const byId = new Map(preferences.map(preference => [preference.calendarId, preference]));
      const model = await loadCalendarWeek({ monday: parameters.get('monday'), timezone: value[0].timezone,
        calendars: discovered.map(item => ({ ...item, isVisible: byId.get(item.calendarId)?.isVisible ?? true })) },
      transport.fetchEventPage, { signal: request.signal });
      if (model.partialErrors.some(error => error.code === 'reconnect_required')) await expireUsedGrant();
      return json(model);
    } catch (error) {
      if (error instanceof SessionVerificationError) return json({ error: { code: error.code, message: error.message } },
        error.code === 'unauthenticated' ? 401 : 503);
      if (error instanceof EnvironmentConfigurationError) return json({ error: { code: 'not_configured', message: 'Calendar setup is not finished yet.' } }, 503);
      if (error instanceof CalendarOAuthPolicyError || error instanceof CalendarWeekRequestError) {
        return json({ error: { code: 'invalid_request', message: 'Calendar request could not be verified. Try again.' } }, 400);
      }
      if (error instanceof CalendarHttpError) return json({ error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof CalendarProviderError) return json({ error: { code: error.code,
        message: error.code === 'reconnect_required' ? 'Reconnect Google Calendar to continue.' : 'Calendar is temporarily unavailable. Try again.' } }, error.code === 'reconnect_required' ? 409 : 502);
      return json({ error: { code: 'calendar_unavailable', message: 'Calendar is temporarily unavailable. Try again.' } }, 502);
    }
  };
}
