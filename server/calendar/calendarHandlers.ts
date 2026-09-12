import { eventCommandSchema } from '../../shared/calendarEventContract.js';
import { executeEventCommand } from './calendarEventWrites.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { requireApplicationEnvironment, requireCalendarEnvironment, EnvironmentConfigurationError } from '../env/cloud.js';
import { verifySupabaseSession, SessionVerificationError } from '../auth/verifySession.js';
import { assertCalendarMutationRequest, createCalendarOAuthAttempt, createCalendarOAuthConsumeCommand,
  getCalendarOAuthRedirectUri, parseCalendarOAuthCallback, CalendarOAuthPolicyError, CALENDAR_SCOPES,
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
const WEEK_DEADLINE_MS = 25_000;
const json = (value: unknown, status = 200, diagnostics?: { requestId: string; stages: Record<string, number> }) => {
  const headers: Record<string, string> = { ...HEADERS };
  if (diagnostics) {
    headers['X-Calendar-Request-Id'] = diagnostics.requestId;
    headers['Server-Timing'] = Object.entries(diagnostics.stages)
      .map(([name, duration]) => `${name};dur=${Math.max(0, Math.round(duration))}`).join(', ');
  }
  return Response.json(value, { status, headers });
};

function elapsed(start: number): number {
  return Math.min(60_000, Math.max(0, performance.now() - start));
}

/** Each invocation derives ownership from a fresh Auth verification, never request input. */
export function createCalendarHandler(action: CalendarAction, dependencies: {
  environment?: Record<string, string | undefined>; fetch?: typeof fetch;
} = {}) {
  return async (request: Request): Promise<Response> => {
    const requestId = randomUUID();
    const stages: Record<string, number> = {};
    const startedAt = performance.now();
    let timedOut = false;
    const routeController = new AbortController();
    const abortRoute = () => routeController.abort();
    const routeTimer = action === 'events' && request.method === 'GET'
      ? setTimeout(() => { timedOut = true; routeController.abort(); }, WEEK_DEADLINE_MS) : undefined;
    request.signal.addEventListener('abort', abortRoute, { once: true });
    const signal = routeController.signal;
    const respond = (value: unknown, status = 200) => json(value, status, { requestId, stages: { ...stages, total: elapsed(startedAt) } });
    const timed = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      try { return await operation(); }
      finally { stages[name] = elapsed(start); }
    };
    try {
      const expectedMethod = (['connect', 'complete', 'disconnect'].includes(action) || (action === 'events' && request.method === 'POST')) ? 'POST' : 'GET';
      if (request.method !== expectedMethod) return respond({ error: { code: 'invalid_request', message: 'This action is unavailable.' } }, 405);
      const environment = requireApplicationEnvironment(dependencies.environment ?? process.env);
      const fetcher = dependencies.fetch ?? fetch;
      if (action === 'callback') {
        const callback = parseCalendarOAuthCallback(request.url, environment.APP_URL);
        const target = new URL('/calendar/callback', environment.APP_URL);
        target.hash = new URLSearchParams(callback.status === 'code'
          ? { state: callback.state, code: callback.code } : { state: callback.state, error: 'access_denied' }).toString();
        return new Response(null, { status: 303, headers: { ...HEADERS, Location: target.href, 'X-Calendar-Request-Id': requestId } });
      }
      if (expectedMethod === 'POST') assertCalendarMutationRequest(request, environment.APP_URL);
      const session = await timed('authentication', () => verifySupabaseSession(request, environment, { fetch: fetcher, signal }));
      const store = createCalendarStore(environment, signal, fetcher);
      const userId = session.userId;
      if (action === 'status') return respond((await timed('storage', () => store.read(userId)))?.connection ?? null);
      if (action === 'disconnect') {
        const previous = await timed('storage', () => store.read(userId));
        await timed('storage', () => store.clear(userId, 'disconnected'));
        if (previous?.envelope && previous.keyVersion === 1) {
          try {
            const configuration = requireCalendarEnvironment(dependencies.environment ?? process.env);
            const refreshToken = decryptRefreshToken(previous.envelope,
              { userId, connectionId: previous.connection.id, keyVersion: 1 }, configuration.GOOGLE_TOKEN_ENCRYPTION_KEY);
            await timed('token_refresh', () => createGoogleOAuthTransport(configuration, signal, fetcher).revoke(refreshToken));
          } catch { /* Local disconnect remains effective after Calendar configuration/key loss. */ }
        }
        return respond({ disconnected: true });
      }
      const parameters = new URL(request.url).searchParams;
      if (action === 'events' && request.method === 'GET') {
        if (parameters.getAll('monday').length !== 1 || [...parameters.keys()].some(key => key !== 'monday')) {
          throw new CalendarHttpError('invalid_request', 400);
        }
        buildCalendarWeekWindow(parameters.get('monday'), 'UTC');
      }
      const command = action === 'events' && request.method === 'POST'
        ? eventCommandSchema.safeParse(await readBoundedJson(new Response(request.body), 16 * 1024, signal)) : null;
      if (command && !command.success) throw new CalendarHttpError('invalid_event', 400);
      const calendar = requireCalendarEnvironment(dependencies.environment ?? process.env);
      const oauth = createGoogleOAuthTransport(calendar, signal, fetcher);
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
        await timed('storage', () => store.rpc('begin_calendar_oauth_attempt', { p_verified_user_id: userId, p_state_hash: transaction.stateHash,
          p_redirect_uri: transaction.redirectUri, p_expires_at: transaction.expiresAt, p_code_verifier: verifier }));
        return respond({ authorizationUrl: authorization.href });
      }
      if (action === 'complete') {
        const body = await readBoundedJson(new Response(request.body), 16 * 1024, signal);
        if (!object(body) || Object.keys(body).some(key => !['state', 'code', 'error'].includes(key)) ||
          typeof body.state !== 'string' || (typeof body.code !== 'string' && typeof body.error !== 'string')) {
          throw new CalendarHttpError('invalid_request', 400);
        }
        const callbackUrl = new URL(getCalendarOAuthRedirectUri(environment.APP_URL));
        for (const key of ['state', 'code', 'error']) if (typeof body[key] === 'string') callbackUrl.searchParams.set(key, body[key]);
        const callback = parseCalendarOAuthCallback(callbackUrl.href, environment.APP_URL);
        const previous = await timed('storage', () => store.read(userId));
        const oauthCommand = createCalendarOAuthConsumeCommand(callback, session, environment.APP_URL);
        const consumed = await timed('storage', () => store.rpc('consume_calendar_oauth_attempt', { p_verified_user_id: userId,
          p_state_hash: oauthCommand.stateHash, p_redirect_uri: oauthCommand.redirectUri }));
        if (!object(consumed) || typeof consumed.code_verifier !== 'string') throw new CalendarHttpError('invalid_request', 400);
        const codeVerifier = consumed.code_verifier;
        if (callback.status === 'denied') return respond({ connected: false, denied: true });
        if (callback.status !== 'code') throw new CalendarHttpError('invalid_request', 400);
        const tokens = await timed('token_refresh', () => oauth.exchange(callback.code, oauthCommand.redirectUri, codeVerifier));
        let refreshToken = tokens.refreshToken;
        if (!refreshToken) {
          if (!previous?.envelope) throw new CalendarHttpError('reconnect_required', 409);
          try {
            validateGrantedCalendarScopes(previous.connection.grantedScopes.join(' '));
            const existingToken = decrypt(previous);
            const verified = await timed('token_refresh', () => oauth.refresh(existingToken));
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
        if (!await timed('storage', () => store.save(userId, id, previous?.connection.updatedAt ?? null, envelope, tokens.scopes))) {
          throw new CalendarHttpError('invalid_request', 409);
        }
        return respond({ connected: true });
      }

      // Week preparation deliberately starts both reads after authentication.
      // No credential or profile value is exposed to the browser.
      const profileTimezone = async (): Promise<string> => {
        const { response, value } = await boundedFetchJson(`${environment.SUPABASE_URL}/rest/v1/profiles?select=timezone`, {
          signal, headers: { apikey: environment.SUPABASE_ANON_KEY, Authorization: request.headers.get('authorization')! },
        }, fetcher);
        if (!response.ok || !Array.isArray(value) || value.length !== 1 || !object(value[0]) || typeof value[0].timezone !== 'string') {
          throw new CalendarHttpError('calendar_unavailable');
        }
        return value[0].timezone;
      };
      const storedAndTimezone = action === 'events' && request.method === 'GET'
        ? await Promise.all([
          timed('storage', () => store.read(userId)),
          timed('storage', profileTimezone),
        ])
        : [await timed('storage', () => store.read(userId)), null] as const;
      const stored = storedAndTimezone[0];
      const timezone = storedAndTimezone[1];
      if (!stored || stored.connection.connectionState !== 'connected' || !stored.envelope) {
        throw new CalendarHttpError('reconnect_required', 409);
      }
      let accessToken: string;
      let usedEnvelope = stored.envelope;
      try {
        validateGrantedCalendarScopes(stored.connection.grantedScopes.join(' '));
        const originalRefreshToken = decrypt(stored);
        const tokens = await timed('token_refresh', () => oauth.refresh(originalRefreshToken));
        const envelope = tokens.refreshToken ? encryptRefreshToken(tokens.refreshToken,
          { userId, connectionId: stored.connection.id, keyVersion: 1 }, calendar.GOOGLE_TOKEN_ENCRYPTION_KEY) : stored.envelope;
        usedEnvelope = envelope;
        const saved = await timed('storage', () => store.save(userId, stored.connection.id, stored.connection.updatedAt, envelope, CALENDAR_SCOPES));
        if (!saved) {
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
      const discovered = await timed('discovery', () => transport.listCalendars({ signal })).catch(async (error: unknown) => {
        if (error instanceof CalendarProviderError && error.code === 'reconnect_required') await expireUsedGrant();
        throw error;
      });
      if (command?.success) return respond(await timed('event_loading', () => executeEventCommand(command.data, discovered, accessToken, signal, fetcher)));
      const preferences = await timed('preference_sync', () => store.syncPreferences(userId, discovered));
      if (action === 'calendars') return respond(preferences.map(item => ({ ...item, canEdit: discovered.find(source => source.calendarId === item.calendarId)?.canEdit ?? false })));
      const byId = new Map(preferences.map(preference => [preference.calendarId, preference]));
      buildCalendarWeekWindow(parameters.get('monday'), timezone);
      const model = await timed('event_loading', () => loadCalendarWeek({ monday: parameters.get('monday'), timezone,
        calendars: discovered.map(item => ({ ...item, isVisible: byId.get(item.calendarId)?.isVisible ?? true })) },
      transport.fetchEventPage, { signal }));
      if (model.partialErrors.some(error => error.code === 'reconnect_required')) await expireUsedGrant();
      return respond(model);
    } catch (error) {
      if (timedOut) return respond({ error: { code: 'calendar_timeout', message: 'Calendar took too long to respond. Try again.' } }, 504);
      if (error instanceof SessionVerificationError) return respond({ error: { code: error.code, message: error.message } }, error.code === 'unauthenticated' ? 401 : 503);
      if (error instanceof EnvironmentConfigurationError) return respond({ error: { code: 'not_configured', message: 'Calendar setup is not finished yet.' } }, 503);
      if (error instanceof CalendarOAuthPolicyError || error instanceof CalendarWeekRequestError) return respond({ error: { code: 'invalid_request', message: 'Calendar request could not be verified. Try again.' } }, 400);
      if (error instanceof CalendarHttpError) return respond({ error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof CalendarProviderError) return respond({ error: { code: error.code,
        message: error.code === 'reconnect_required' ? 'Reconnect Google Calendar to continue.' : 'Calendar is temporarily unavailable. Try again.' } }, error.code === 'reconnect_required' ? 409 : 502);
      return respond({ error: { code: 'calendar_unavailable', message: 'Calendar is temporarily unavailable. Try again.' } }, 502);
    } finally {
      if (routeTimer !== undefined) clearTimeout(routeTimer);
      request.signal.removeEventListener('abort', abortRoute);
    }
  };
}
