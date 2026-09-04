import type {
  AuthChangeEvent,
  Session,
  SupabaseClient,
} from "@supabase/supabase-js";

import type {
  AuthIdentity,
  AuthPort,
  AuthStateChange,
  AuthStateListener,
  UnsubscribeAuthState,
} from "./authPort";

type GetSessionResult = ReturnType<SupabaseClient["auth"]["getSession"]>;
type SignOutOptions = Parameters<SupabaseClient["auth"]["signOut"]>[0];
type SignOutResult = ReturnType<SupabaseClient["auth"]["signOut"]>;
type AuthSubscription = ReturnType<
  SupabaseClient["auth"]["onAuthStateChange"]
>;

/** The minimal Supabase surface needed by the auth adapter. */
export interface SupabaseAuthClient {
  readonly auth: {
    getSession(): GetSessionResult;
    onAuthStateChange(
      callback: (event: AuthChangeEvent, session: Session | null) => void,
    ): AuthSubscription;
    signOut(options?: SignOutOptions): SignOutResult;
  };
}

function sanitizeIdentity(session: Session | null): AuthIdentity | null {
  if (!session) return null;

  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    expiresAt: session.expires_at ?? null,
  };
}

function toAuthStateChange(
  reason: AuthChangeEvent,
  session: Session | null,
): AuthStateChange {
  return {
    identity: sanitizeIdentity(session),
    reason,
  };
}

export function createSupabaseAuthPort(client: SupabaseAuthClient): AuthPort {
  return {
    async restore(): Promise<AuthStateChange> {
      const { data, error } = await client.auth.getSession();

      if (error) throw error;

      if (!data.session) {
        return { identity: null, reason: "no_session" };
      }

      return toAuthStateChange("INITIAL_SESSION", data.session);
    },

    subscribe(listener: AuthStateListener): UnsubscribeAuthState {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        listener(toAuthStateChange(event, session));
      });
      let subscribed = true;

      return () => {
        if (!subscribed) return;

        subscribed = false;
        data.subscription.unsubscribe();
      };
    },

    async signOut(): Promise<void> {
      const { error } = await client.auth.signOut({ scope: "local" });

      if (error) throw error;
    },
  };
}
