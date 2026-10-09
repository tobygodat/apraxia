import {
  invalidRequestMessage,
  reconnectMessage,
  unavailableCode,
  type GoogleProviderDefinition,
} from "./provider.js";

/** Bounded JSON transport for private storage and OAuth, with sanitized, subsystem-labelled failures. */
export class GoogleHttpError extends Error {
  constructor(
    readonly provider: GoogleProviderDefinition,
    readonly code: string,
    readonly status = 502,
  ) {
    super(
      code === "reconnect_required"
        ? reconnectMessage(provider)
        : code === "invalid_request"
          ? invalidRequestMessage(provider)
          : provider.providerFailureMessage,
    );
  }
}

export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface GoogleHttp {
  readonly definition: GoogleProviderDefinition;
  readonly unavailableCode: string;
  error(code: string, status?: number): GoogleHttpError;
  readBoundedJson(response: Response, maximum?: number, parent?: AbortSignal): Promise<unknown>;
  boundedFetchJson(
    url: string,
    init: RequestInit,
    fetcher: typeof fetch,
    maximum?: number,
  ): Promise<{ response: Response; value: unknown }>;
}

/** Binds the transport helpers to one provider's error class so failures name the right subsystem. */
export function createGoogleHttp(
  definition: GoogleProviderDefinition,
  error: (code: string, status?: number) => GoogleHttpError,
): GoogleHttp {
  const unavailable = unavailableCode(definition);
  const fail = () => error(unavailable);

  function observe<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const cancel = () => reject(fail());
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", cancel);
          if (signal.aborted) cancel();
          else resolve(value);
        },
        () => {
          signal.removeEventListener("abort", cancel);
          reject(fail());
        },
      );
    });
  }

  async function readBoundedJson(
    response: Response,
    maximum = 128 * 1024,
    parent?: AbortSignal,
  ): Promise<unknown> {
    const signal = AbortSignal.any([
      parent ?? new AbortController().signal,
      AbortSignal.timeout(10_000),
    ]);
    if (!response.body) throw fail();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await observe(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > maximum || chunks.length >= 4096) throw fail();
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      void reader.cancel().catch(() => undefined);
      throw fail();
    } finally {
      reader.releaseLock();
    }
  }

  async function boundedFetchJson(
    url: string,
    init: RequestInit,
    fetcher: typeof fetch,
    maximum?: number,
  ): Promise<{ response: Response; value: unknown }> {
    const signal = AbortSignal.any([
      init.signal ?? new AbortController().signal,
      AbortSignal.timeout(10_000),
    ]);
    try {
      const response = await observe(
        fetcher(url, {
          ...init,
          signal,
          // Workers reject redirect: "error"; a redirect is never followed and fails here instead.
          redirect: "manual",
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
        }),
        signal,
      );
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))
        throw fail();
      const value = await readBoundedJson(response, maximum, signal);
      return { response, value };
    } catch {
      throw fail();
    }
  }

  return { definition, unavailableCode: unavailable, error, readBoundedJson, boundedFetchJson };
}
