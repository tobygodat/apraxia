/** Static description of one Google integration; adapters bind it to routes, RPC names, and copy. */
type GoogleProviderKey = "calendar";

export interface GoogleProviderDefinition {
  /** Prefixes RPC names (`read_<key>_credentials`) and the `<key>_unavailable` error code. */
  readonly key: GoogleProviderKey;
  /** User-facing subsystem noun, e.g. "Calendar". */
  readonly noun: string;
  /** User-facing product label, e.g. "Google Calendar". */
  readonly label: string;
  readonly scopes: readonly string[];
  /** Server callback route registered with Google. */
  readonly callbackPath: string;
  /** Browser route that finishes the connection with the restored session. */
  readonly browserCallbackPath: string;
  /**
   * Whether a reconnect that omits a replacement refresh token may keep the
   * previous credential after verifying it still refreshes.
   */
  readonly reuseRefreshTokenOnReconnect: boolean;
  /** Copy for provider failures that are neither a reconnect nor an invalid request. */
  readonly providerFailureMessage: string;
}

export const unavailableCode = (definition: GoogleProviderDefinition): string =>
  `${definition.key}_unavailable`;
export const reconnectMessage = (definition: GoogleProviderDefinition): string =>
  `Reconnect ${definition.label} to continue.`;
export const invalidRequestMessage = (definition: GoogleProviderDefinition): string =>
  `${definition.noun} request could not be verified. Try again.`;
export const unavailableMessage = (definition: GoogleProviderDefinition): string =>
  `${definition.noun} is temporarily unavailable. Try again.`;
