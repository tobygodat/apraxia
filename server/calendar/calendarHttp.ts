/** Bounded JSON transport for private storage and OAuth, with sanitized failures. */
export class CalendarHttpError extends Error {
  constructor(readonly code: string, readonly status = 502) {
    super(code === 'reconnect_required' ? 'Reconnect Google Calendar to continue.' :
      code === 'invalid_request' ? 'Calendar request could not be verified. Try again.' :
      code === 'calendar_timeout' ? 'Calendar took too long to respond. Try again.' :
      'Calendar is temporarily unavailable. Try again.');
  }
}

function observe<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new CalendarHttpError('calendar_unavailable'));
    if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
    promise.then(value => { signal.removeEventListener('abort', cancel); if (signal.aborted) cancel(); else resolve(value); },
      () => { signal.removeEventListener('abort', cancel); reject(new CalendarHttpError('calendar_unavailable')); });
  });
}

export async function readBoundedJson(response: Response, maximum = 128 * 1024, parent?: AbortSignal): Promise<unknown> {
  const signal = AbortSignal.any([parent ?? new AbortController().signal, AbortSignal.timeout(10_000)]);
  if (!response.body) throw new CalendarHttpError('calendar_unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await observe(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maximum || chunks.length >= 4096) throw new CalendarHttpError('calendar_unavailable');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    void reader.cancel().catch(() => undefined);
    throw new CalendarHttpError('calendar_unavailable');
  } finally { reader.releaseLock(); }
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function boundedFetchJson(
  url: string, init: RequestInit, fetcher: typeof fetch, maximum?: number,
): Promise<{ response: Response; value: unknown }> {
  const signal = AbortSignal.any([init.signal ?? new AbortController().signal, AbortSignal.timeout(10_000)]);
  try {
    const response = await observe(fetcher(url, { ...init, signal, redirect: 'error', cache: 'no-store',
      credentials: 'omit', referrerPolicy: 'no-referrer' }), signal);
    const value = await readBoundedJson(response, maximum, signal);
    return { response, value };
  } catch { throw new CalendarHttpError('calendar_unavailable'); }
}
