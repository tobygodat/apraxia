/**
 * One typed error for every browser service boundary.
 *
 * Services throw `ServiceError` with a closed `code` so the UI can branch on
 * the kind of failure instead of matching user copy. The `message` stays the
 * user-facing sentence the surface already shows; `serviceErrorCopy.ts` holds
 * the per-code default used when a call site has nothing more specific to say.
 */
import { DEFAULT_SERVICE_ERROR_COPY } from "./serviceErrorCopy";

/** The kinds of failure a service boundary can report. */
export type ServiceErrorCode =
  | "unavailable"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "reconnect_required"
  | "timeout"
  | "aborted";

/** Codes worth offering a retry for; the rest need a different action first. */
const RETRYABLE: ReadonlySet<ServiceErrorCode> = new Set<ServiceErrorCode>([
  "unavailable",
  "timeout",
]);

export interface ServiceErrorOptions {
  /** Defaults from the code; set it only when a call site knows better. */
  readonly retryable?: boolean;
}

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly retryable: boolean;
  constructor(
    code: ServiceErrorCode,
    message = DEFAULT_SERVICE_ERROR_COPY[code],
    options: ServiceErrorOptions = {},
  ) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
  }
}

function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

/** True for the code, whatever error shape the caller was handed. */
export function hasServiceErrorCode(
  error: unknown,
  ...codes: readonly ServiceErrorCode[]
): boolean {
  return isServiceError(error) && codes.includes(error.code);
}

/**
 * The sentence to show for a failure: the service's own copy, then the code's
 * default, then the surface's fallback. QA fixtures throw plain `Error`s, so
 * their copy still reaches the screen through the second branch.
 */
export function serviceErrorMessage(error: unknown, fallback: string): string {
  if (isServiceError(error)) return error.message || DEFAULT_SERVICE_ERROR_COPY[error.code];
  return (error instanceof Error && error.message) || fallback;
}
