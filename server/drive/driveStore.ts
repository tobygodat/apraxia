import type { ApplicationEnvironment } from '../env/cloud.js';
import type { GoogleCalendarConnectionStatus } from '../../frontend/src/types/domain.js';

import { boundedFetchJson, CalendarHttpError, object } from '../calendar/calendarHttp.js';

const diagnosticCodes = new Set(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST202', 'PGRST301', 'PGRST302',
  'PGRST303', '42501', '42883', '42P01', '42703', '22023', '23503', '23505', '57014', '53300']);

export interface StoredDriveCredentials {
  connection: GoogleCalendarConnectionStatus;
  envelope: string | null;
  keyVersion: number | null;
}

export function connectionStatus(value: unknown): GoogleCalendarConnectionStatus {
  if (!object(value) || typeof value.id !== 'string' || typeof value.updated_at !== 'string' ||
    typeof value.created_at !== 'string' || !Array.isArray(value.granted_scopes) ||
    !['connected', 'disconnected', 'reconnect_required'].includes(String(value.connection_state))) {
    throw new CalendarHttpError('calendar_unavailable');
  }
  return { id: value.id, googleAccountId: typeof value.google_account_id === 'string' ? value.google_account_id : null,
    displayEmail: typeof value.display_email === 'string' ? value.display_email : null,
    connectionState: value.connection_state as GoogleCalendarConnectionStatus['connectionState'],
    grantedScopes: value.granted_scopes.filter((item): item is string => typeof item === 'string'),
    lastSuccessfulRefreshAt: typeof value.last_successful_refresh_at === 'string' ? value.last_successful_refresh_at : null,
    createdAt: value.created_at, updatedAt: value.updated_at };
}

export function createDriveStore(environment: ApplicationEnvironment, signal: AbortSignal, fetcher = fetch) {
  async function rpc(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    const key = environment.SUPABASE_SERVICE_ROLE_KEY;
    // Modern secret keys authenticate through apikey; they are not JWT bearer tokens.
    // Retain the Authorization fallback only for legacy service-role JWT keys.
    const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
    if (!key.startsWith('sb_secret_') && !key.startsWith('sb_publishable_')) headers.Authorization = `Bearer ${key}`;
    const { response, value } = await boundedFetchJson(`${environment.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', signal, headers,
      body: JSON.stringify(arguments_),
    }, fetcher, 4 * 1024 * 1024);
    if (!response.ok) {
      // Operational diagnostics contain no provider messages, arguments, owners, or credentials.
      // Only recognized SQLSTATE/PostgREST identifiers may leave the provider response.
      const providerCode = object(value) && typeof value.code === 'string' &&
        diagnosticCodes.has(value.code) ? value.code : undefined;
      console.warn('Drive storage request failed.', { operation: name, status: response.status,
        ...(providerCode === undefined ? {} : { code: providerCode }) });
      throw new CalendarHttpError(
        name.includes('oauth') ? 'invalid_request' : 'calendar_unavailable', name.includes('oauth') ? 400 : 502);
    }
    return value;
  }
  return {
    rpc,
    async read(userId: string): Promise<StoredDriveCredentials | null> {
      const value = await rpc('read_drive_credentials', { p_verified_user_id: userId });
      if (value === null) return null;
      if (!object(value)) throw new CalendarHttpError('calendar_unavailable');
      return { connection: connectionStatus(value.connection), envelope: typeof value.envelope === 'string' ? value.envelope : null,
        keyVersion: typeof value.key_version === 'number' ? value.key_version : null };
    },
    async clear(userId: string, state: 'disconnected' | 'reconnect_required', expected?: string): Promise<boolean> {
      return await rpc('clear_drive_credentials', { p_verified_user_id: userId, p_state: state,
        p_expected_updated_at: expected ?? null }) === true;
    },
    async save(userId: string, connectionId: string, expected: string | null, envelope: string, scopes: readonly string[]): Promise<boolean> {
      return await rpc('save_drive_credentials', { p_verified_user_id: userId, p_connection_id: connectionId,
        p_expected_updated_at: expected, p_envelope: envelope, p_key_version: 1, p_scopes: scopes }) === true;
    },
  };
}
