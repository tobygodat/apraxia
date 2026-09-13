import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';

export interface DriveFile { id: string; name: string; folder: boolean; modifiedTime: string | null; size: string | null }
export interface DrivePage { files: DriveFile[]; nextPage: string | null }
export interface DriveService {
  status(signal?: AbortSignal): Promise<{ connectionState: string } | null>;
  connect(signal?: AbortSignal): Promise<string>;
  disconnect(signal?: AbortSignal): Promise<void>;
  files(folder: string, page?: string, signal?: AbortSignal): Promise<DrivePage>;
  pickPdf(signal?: AbortSignal, parent?: string): Promise<DriveFile | null>;
  pdf(file: DriveFile, signal?: AbortSignal): Promise<File>;
}
export function createDriveService(client: SupabaseClient<Database>): DriveService {
  async function request(path: string, method = 'GET', signal?: AbortSignal) {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw new Error('Sign in again to use Google Drive.');
    const response = await fetch(`/api/drive/${path}`, { method, cache: 'no-store',
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(path.startsWith('pdf?') ? 120_000 : 30_000)]),
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: '{}' } : {}) });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const messages: Record<string, string> = {
        reconnect_required: 'Reconnect Google Drive to continue.',
        not_configured: 'Google Drive setup is not finished yet.',
        file_unavailable: 'This file or folder is unavailable. Check its permissions in Google Drive.',
      };
      throw new Error(messages[body?.error?.code] ?? 'Google Drive could not load. Try again.');
    }
    return response;
  }
  return {
    status: async signal => (await request('status', 'GET', signal)).json(),
    connect: async signal => (await (await request('connect', 'POST', signal)).json()).authorizationUrl,
    disconnect: async signal => { await request('disconnect', 'POST', signal); },
    files: async (folder, page, signal) => (await request(`files?${new URLSearchParams({ folder, ...(page ? { page } : {}) })}`, 'GET', signal)).json(),
    pickPdf: async (signal, parent) => {
      const { pickGooglePdf } = await import('./googlePicker');
      const grant = await (await request('picker', 'POST', signal)).json();
      if (typeof grant.accessToken !== 'string' || typeof grant.developerKey !== 'string' || typeof grant.appId !== 'string') {
        throw new Error('Google’s file picker is not configured yet.');
      }
      return pickGooglePdf(grant, signal, parent);
    },
    pdf: async (file, signal) => new File([await (await request(`pdf?id=${encodeURIComponent(file.id)}`, 'GET', signal)).blob()], file.name, { type: 'application/pdf' }),
  };
}
