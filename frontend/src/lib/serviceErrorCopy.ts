/** The default user-facing sentence for each service error code. */
import type { ServiceErrorCode } from "./serviceError";

export const DEFAULT_SERVICE_ERROR_COPY: Record<ServiceErrorCode, string> = {
  unavailable: "Couldn’t reach your account. Try again.",
  unauthorized: "Sign in again to continue.",
  not_found: "This item is no longer available. Refresh and try again.",
  conflict: "This changed elsewhere. Refresh before editing again.",
  invalid_input: "Check the details you entered and try again.",
  reconnect_required: "Reconnect this account in Settings to continue.",
  timeout: "That took too long to respond. Try again.",
  aborted: "The change was cancelled. Refresh to confirm its saved state.",
};
