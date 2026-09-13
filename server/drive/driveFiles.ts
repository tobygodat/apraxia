import { boundedFetchJson, CalendarHttpError, object } from '../calendar/calendarHttp.js';

const FOLDER = 'application/vnd.google-apps.folder';
const PDF = 'application/pdf';
const validId = (id: string) => /^[A-Za-z0-9_-]{1,256}$/.test(id);

/** Only fixed Google endpoints and bounded projections cross the server boundary. */
export async function serveDriveFiles(action: string, request: Request, accessToken: string,
  fetcher: typeof fetch, headers: Record<string, string>): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]);
  const init = { signal, headers: { Authorization: `Bearer ${accessToken}` } };
  async function metadata(url: URL) {
    const { response, value } = await boundedFetchJson(url.href, init, fetcher, 512 * 1024);
    if (!response.ok) throw new CalendarHttpError(response.status === 401 ? 'reconnect_required' :
      response.status === 404 || response.status === 403 ? 'file_unavailable' : 'drive_unavailable', response.status === 401 ? 409 : 502);
    if (!object(value)) throw new CalendarHttpError('drive_unavailable');
    return value;
  }
  if (action === 'files') {
    if ([...query.keys()].some(key => !['folder', 'page'].includes(key)) ||
      query.getAll('folder').length > 1 || query.getAll('page').length > 1) throw new CalendarHttpError('invalid_request', 400);
    const folder = query.get('folder') ?? 'root';
    const page = query.get('page');
    if (!validId(folder) || (page !== null && (page.length > 2048 || !page.length))) throw new CalendarHttpError('invalid_request', 400);
    if (folder !== 'root') {
      const folderUrl = new URL(`https://www.googleapis.com/drive/v3/files/${folder}`);
      folderUrl.search = 'fields=mimeType,trashed&supportsAllDrives=true';
      const selected = await metadata(folderUrl);
      if (selected.mimeType !== FOLDER || selected.trashed === true) throw new CalendarHttpError('file_unavailable', 404);
    }
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.search = new URLSearchParams({ q: `'${folder}' in parents and trashed = false and (mimeType = '${PDF}' or mimeType = '${FOLDER}')`,
      fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,size)', pageSize: '100',
      orderBy: 'folder,name', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      ...(page ? { pageToken: page } : {}) }).toString();
    const value = await metadata(url);
    if (!Array.isArray(value.files) || value.incompleteSearch === true ||
      (value.nextPageToken !== undefined && (typeof value.nextPageToken !== 'string' || value.nextPageToken.length > 2048))) throw new CalendarHttpError('drive_unavailable');
    const files = value.files.map(item => {
      if (!object(item) || typeof item.id !== 'string' || !validId(item.id) || typeof item.name !== 'string' ||
        ![PDF, FOLDER].includes(String(item.mimeType))) throw new CalendarHttpError('drive_unavailable');
      return { id: item.id, name: item.name, folder: item.mimeType === FOLDER,
        modifiedTime: typeof item.modifiedTime === 'string' ? item.modifiedTime : null,
        size: typeof item.size === 'string' ? item.size : null };
    });
    return Response.json({ files, nextPage: value.nextPageToken ?? null }, { headers });
  }
  if (action !== 'pdf' || query.getAll('id').length !== 1 || [...query.keys()].some(key => key !== 'id')) throw new CalendarHttpError('invalid_request', 400);
  const id = query.get('id')!;
  if (!validId(id)) throw new CalendarHttpError('invalid_request', 400);
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${id}`);
  url.search = new URLSearchParams({ fields: 'mimeType,size,trashed,capabilities(canDownload)', supportsAllDrives: 'true' }).toString();
  const value = await metadata(url);
  if (value.mimeType !== PDF || value.trashed === true || !object(value.capabilities) || value.capabilities.canDownload !== true) throw new CalendarHttpError('file_unavailable', 403);
  url.search = 'alt=media&supportsAllDrives=true';
  const response = await fetcher(url.href, { ...init, redirect: 'error', cache: 'no-store', credentials: 'omit' });
  if (!response.ok || !response.body) throw new CalendarHttpError(response.status === 401 ? 'reconnect_required' : 'file_unavailable', response.status === 401 ? 409 : 502);
  // Pass bytes through as they arrive. Never buffer a PDF into a function payload.
  return new Response(response.body, { headers: { ...headers, 'Content-Type': PDF,
    'Content-Disposition': 'inline', 'X-Accel-Buffering': 'no' } });
}
