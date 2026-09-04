import type { AuthChangeEvent } from "@supabase/supabase-js";

/**
 * The only authenticated-user data that may cross into application state.
 * `expiresAt` is the session expiry as Unix time in seconds.
 */
export interface AuthIdentity {
  readonly userId: string;
  readonly email: string | null;
  readonly expiresAt: number | null;
}

export type AuthChangeReason = AuthChangeEvent | "no_session";

export interface AuthStateChange {
  readonly identity: AuthIdentity | null;
  readonly reason: AuthChangeReason;
}

export type AuthStateListener = (change: AuthStateChange) => void;
export type UnsubscribeAuthState = () => void;

export interface AuthPort {
  restore(): Promise<AuthStateChange>;
  subscribe(listener: AuthStateListener): UnsubscribeAuthState;
  signOut(): Promise<void>;
}
