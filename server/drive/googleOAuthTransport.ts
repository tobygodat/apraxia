import type { CalendarEnvironment } from '../env/cloud.js';
import { boundedFetchJson, CalendarHttpError, object } from '../calendar/calendarHttp.js';
import { DRIVE_SCOPES, validateGrantedDriveScopes } from './oauthPolicy.js';

export interface GoogleTokens { accessToken: string; refreshToken: string | null; scopes: readonly string[] }

export function createGoogleOAuthTransport(configuration: CalendarEnvironment, signal: AbortSignal, fetcher = fetch) {
  async function token(parameters: Record<string, string>, refreshing: boolean): Promise<GoogleTokens> {
    const { response, value } = await boundedFetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...parameters, client_id: configuration.GOOGLE_CLIENT_ID,
        client_secret: configuration.GOOGLE_CLIENT_SECRET }).toString(),
    }, fetcher);
    if (!response.ok) {
      if (object(value) && value.error === 'invalid_grant') throw new CalendarHttpError('reconnect_required', 409);
      throw new CalendarHttpError('drive_unavailable');
    }
    if (!object(value) || typeof value.access_token !== 'string' || value.access_token.length > 4096 ||
      !/^[A-Za-z0-9._~+\/-]+=*$/.test(value.access_token) ||
      typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer' ||
      (value.refresh_token !== undefined && (typeof value.refresh_token !== 'string' ||
        value.refresh_token.length > 16_384 || !/^[\x21-\x7e]+$/.test(value.refresh_token)))) {
      throw new CalendarHttpError('drive_unavailable');
    }
    // A refresh response may omit scope: it retains the previously verified grant.
    const scopes = refreshing && value.scope === undefined ? DRIVE_SCOPES : validateGrantedDriveScopes(value.scope);
    return { accessToken: value.access_token, refreshToken: typeof value.refresh_token === 'string' ? value.refresh_token : null, scopes };
  }
  return {
    exchange(code: string, redirectUri: string, verifier: string) {
      return token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }, false);
    },
    refresh(refreshToken: string) { return token({ grant_type: 'refresh_token', refresh_token: refreshToken }, true); },
  };
}
