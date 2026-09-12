import type { ApplicationEnvironment } from "../env/cloud.js";
import {
  normalizeBrowserSafeSupabaseKey,
  normalizeSecureHttpOrigin,
} from "../../shared/supabaseEnvironment.js";

export interface VerifiedSession {
  readonly userId: string;
}

export class SessionVerificationError extends Error {
  constructor(readonly code: "unauthenticated" | "auth_unavailable") {
    super(code === "unauthenticated" ? "Sign in to continue." : "Sign-in verification is temporarily unavailable.");
    this.name = "SessionVerificationError";
  }
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BEARER_LENGTH = 16 * 1024;
const DEADLINE_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unavailable(): SessionVerificationError {
  return new SessionVerificationError("auth_unavailable");
}

function cancelled(): DOMException {
  return new DOMException("Session verification cancelled.", "AbortError");
}

function checkActive(signal: AbortSignal): void {
  if (signal.aborted) throw unavailable();
}

function discardResponse(response: Response): void {
  // Cleanup must not wait for an uncooperative provider's cancellation promise.
  if (response.body !== null && !response.body.locked) {
    void response.body.cancel().catch(() => undefined);
  }
}

/** Bound both fetch and individual stream reads, even if they ignore signals. */
function whileActive<T>(
  operation: Promise<T>, signal: AbortSignal, discardLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(unavailable());
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    operation.then((value) => {
      signal.removeEventListener("abort", abort);
      if (settled || signal.aborted) {
        abort();
        try { discardLate?.(value); } catch { /* Never expose cleanup errors. */ }
        return;
      }
      settled = true;
      resolve(value);
    }, () => {
      signal.removeEventListener("abort", abort);
      if (settled) return;
      settled = true;
      reject(unavailable());
    });
  });
}

async function readUser(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (contentType === null ||
    !/^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?\s*$/i.test(contentType) ||
    response.body === null) throw unavailable();
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) throw unavailable();

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let reads = 0;
  let text = "";
  let complete = false;
  try {
    while (true) {
      checkActive(signal);
      // Bound empty-chunk loops as well as bytes; immediate promises alone
      // must not starve the timer indefinitely.
      if (++reads > MAX_BODY_BYTES + 1) throw unavailable();
      const part = await whileActive(reader.read(), signal);
      checkActive(signal);
      if (part.done) { complete = true; break; }
      if (!(part.value instanceof Uint8Array)) throw unavailable();
      bytes += part.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw unavailable();
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    // A cancelled pending read settles without waiting for underlying cleanup.
    try { reader.releaseLock(); } catch { /* Nothing sensitive is retained. */ }
  }
}

function verifiedProjection(value: unknown): VerifiedSession {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const user = value as Record<string, unknown>;
  if (typeof user.id !== "string" || !UUID.test(user.id) ||
    user.id === "00000000-0000-0000-0000-000000000000" ||
    typeof user.role !== "string" || typeof user.is_anonymous !== "boolean") throw unavailable();

  // Current Supabase User JSON always includes is_anonymous. Missing fields
  // are not evidence of a permanent account or a compatibility fallback.
  if (user.role !== "authenticated" || user.is_anonymous ||
    (user.deleted_at !== undefined && user.deleted_at !== null)) {
    throw new SessionVerificationError("unauthenticated");
  }
  return Object.freeze({ userId: user.id.toLowerCase() });
}

/**
 * Ask the configured Auth server for the current user. JWT contents, cookies,
 * request bodies, query parameters, and caller-supplied user IDs never grant
 * authority. This function does not refresh sessions or retain credentials.
 */
export async function verifySupabaseSession(
  request: Request,
  configuration: Pick<ApplicationEnvironment, "SUPABASE_URL" | "SUPABASE_ANON_KEY">,
  options: { fetch?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<VerifiedSession> {
  const parentSignal = options.signal ?? request.signal;
  if (parentSignal.aborted) throw cancelled();
  let response: Response | undefined;
  const scope = new AbortController();
  const abort = () => scope.abort();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const credential = request.headers.get("authorization");
    // Fetch Headers combines duplicates with commas, excluded by this grammar.
    // Accept the case-insensitive scheme, exactly one separator, and one token.
    if (credential === null || credential.length > MAX_BEARER_LENGTH ||
      !/^Bearer [A-Za-z0-9._~+\/-]+=*$/i.test(credential)) {
      throw new SessionVerificationError("unauthenticated");
    }
    const origin = normalizeSecureHttpOrigin(configuration.SUPABASE_URL);
    const publicKey = normalizeBrowserSafeSupabaseKey(configuration.SUPABASE_ANON_KEY);
    const timeoutMs = options.timeoutMs ?? DEADLINE_MS;
    if (origin === null || publicKey === null || /[^\x21-\x7e]/.test(publicKey) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEADLINE_MS) throw unavailable();

    const endpoint = `${origin}/auth/v1/user`;
    parentSignal.addEventListener("abort", abort, { once: true });
    if (parentSignal.aborted) abort();
    deadline = setTimeout(abort, timeoutMs);
    const transport = options.fetch ?? globalThis.fetch;
    const pendingResponse = Promise.resolve().then(() => {
      checkActive(scope.signal);
      return transport(endpoint, {
        method: "GET",
        headers: { apikey: publicKey, Authorization: credential, Accept: "application/json" },
        redirect: "error", cache: "no-store", credentials: "omit", signal: scope.signal,
      });
    });
    response = await whileActive(pendingResponse, scope.signal, discardResponse);
    checkActive(scope.signal);
    if (!(response instanceof Response) || response.redirected ||
      (response.url !== "" && response.url !== endpoint)) throw unavailable();
    if (response.status === 401 || response.status === 403) {
      throw new SessionVerificationError("unauthenticated");
    }
    if (response.status !== 200) throw unavailable();
    const user = await readUser(response, scope.signal);
    checkActive(scope.signal);
    return verifiedProjection(user);
  } catch (error) {
    if (parentSignal.aborted) throw cancelled();
    if (error instanceof SessionVerificationError) throw new SessionVerificationError(error.code);
    throw unavailable();
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
    parentSignal.removeEventListener("abort", abort);
    if (response instanceof Response) discardResponse(response);
  }
}
