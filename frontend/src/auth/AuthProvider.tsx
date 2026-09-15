import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthIdentity, AuthPort, AuthStateChange } from "./authPort";
import { clearUserScopedState, type UserStateCleanupResult } from "./userState";

export type AnonymousReason = "no_session" | "signed_out" | "expired";
export type SignOutStatus = "idle" | "pending" | "error";

export type AuthState =
  | { readonly status: "restoring" }
  | { readonly status: "restore_error" }
  | { readonly status: "cleanup_error" }
  | {
      readonly status: "anonymous";
      readonly reason: AnonymousReason;
    }
  | {
      readonly status: "authenticated";
      readonly identity: AuthIdentity;
      readonly signOutStatus: SignOutStatus;
    };

interface AuthContextValue {
  readonly state: AuthState;
  retryRestore(): void;
  retryCleanup(): void;
  signOut(): Promise<void>;
}

interface AuthLifecycle {
  active: boolean;
  eventRevision: number;
  restoreRevision: number;
  restore(): void;
}

interface PendingCleanup {
  change: AuthStateChange;
  result: UserStateCleanupResult;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function anonymousReason(
  change: AuthStateChange,
  hadIdentity: boolean,
  explicitSignOut: boolean,
): AnonymousReason {
  if (explicitSignOut) return "signed_out";
  if (change.reason === "no_session" || change.reason === "INITIAL_SESSION") {
    return "no_session";
  }
  return hadIdentity ? "expired" : "no_session";
}

export function AuthProvider({
  port,
  children,
}: {
  readonly port: AuthPort;
  readonly children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>({ status: "restoring" });
  const sessionIdentityRef = useRef<AuthIdentity | null>(null);
  const scopedUserIdRef = useRef<string | null>(null);
  const pendingCleanupRef = useRef<PendingCleanup | null>(null);
  const lifecycleRef = useRef<AuthLifecycle | null>(null);
  const explicitSignOutRef = useRef(false);

  const commitChange = useCallback(
    (change: AuthStateChange, hadIdentityBeforeCleanup = scopedUserIdRef.current !== null) => {
      const previousUserId = scopedUserIdRef.current;
      const nextIdentity = change.identity;

      if (!nextIdentity) {
        const reason = anonymousReason(
          change,
          hadIdentityBeforeCleanup,
          explicitSignOutRef.current,
        );
        scopedUserIdRef.current = null;
        explicitSignOutRef.current = false;
        setState((previousState) =>
          previousUserId === null && previousState.status === "anonymous"
            ? previousState
            : { status: "anonymous", reason },
        );
        return;
      }

      const sameUser = previousUserId === nextIdentity.userId;
      scopedUserIdRef.current = nextIdentity.userId;
      if (!sameUser) explicitSignOutRef.current = false;
      setState((previousState) => ({
        status: "authenticated",
        identity: nextIdentity,
        signOutStatus:
          sameUser && previousState.status === "authenticated"
            ? previousState.signOutStatus
            : "idle",
      }));
    },
    [],
  );

  const applyChange = useCallback(
    (change: AuthStateChange) => {
      sessionIdentityRef.current = change.identity;

      if (pendingCleanupRef.current) {
        pendingCleanupRef.current.change = change;
        setState({ status: "cleanup_error" });
        return;
      }

      const scopedUserId = scopedUserIdRef.current;
      const nextIdentity = change.identity;
      const userChanged =
        scopedUserId !== null && (nextIdentity === null || nextIdentity.userId !== scopedUserId);

      if (userChanged) {
        const cleanupResult = clearUserScopedState();
        if (!cleanupResult.ok) {
          pendingCleanupRef.current = { change, result: cleanupResult };
          setState({ status: "cleanup_error" });
          return;
        }

        scopedUserIdRef.current = null;
      }

      commitChange(change, userChanged);
    },
    [commitChange],
  );

  useEffect(() => {
    const lifecycle: AuthLifecycle = {
      active: true,
      eventRevision: 0,
      restoreRevision: 0,
      restore: () => {},
    };
    lifecycleRef.current = lifecycle;

    const unsubscribe = port.subscribe((change) => {
      if (!lifecycle.active) return;
      lifecycle.eventRevision += 1;
      applyChange(change);
    });

    lifecycle.restore = () => {
      const restoreRevision = lifecycle.restoreRevision + 1;
      lifecycle.restoreRevision = restoreRevision;
      const eventRevision = lifecycle.eventRevision;
      setState({ status: "restoring" });

      void port
        .restore()
        .then((change) => {
          if (
            !lifecycle.active ||
            lifecycle.restoreRevision !== restoreRevision ||
            lifecycle.eventRevision !== eventRevision
          ) {
            return;
          }
          applyChange(change);
        })
        .catch(() => {
          if (
            !lifecycle.active ||
            lifecycle.restoreRevision !== restoreRevision ||
            lifecycle.eventRevision !== eventRevision
          ) {
            return;
          }
          setState({ status: "restore_error" });
        });
    };

    lifecycle.restore();

    return () => {
      lifecycle.active = false;
      lifecycle.restoreRevision += 1;
      explicitSignOutRef.current = false;
      unsubscribe();
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
    };
  }, [applyChange, port]);

  const retryRestore = useCallback(() => {
    lifecycleRef.current?.restore();
  }, []);

  const retryCleanup = useCallback(() => {
    const pendingCleanup = pendingCleanupRef.current;
    if (!pendingCleanup) return;

    const cleanupResult = pendingCleanup.result.retry();
    if (!cleanupResult.ok) {
      pendingCleanup.result = cleanupResult;
      setState({ status: "cleanup_error" });
      return;
    }

    pendingCleanupRef.current = null;
    scopedUserIdRef.current = null;
    commitChange(pendingCleanup.change, true);
  }, [commitChange]);

  const signOut = useCallback(async () => {
    const lifecycleAtStart = lifecycleRef.current;
    if (!lifecycleAtStart?.active) {
      return;
    }

    // A cleanup failure is a hard account boundary. Never let a retained
    // callback or future out-of-boundary control replace cleanup_error with an
    // authenticated state while the previous user's state is still present.
    if (pendingCleanupRef.current) {
      setState({ status: "cleanup_error" });
      return;
    }

    const identityAtStart = sessionIdentityRef.current;
    if (
      !identityAtStart ||
      scopedUserIdRef.current !== identityAtStart.userId ||
      explicitSignOutRef.current
    ) {
      return;
    }

    explicitSignOutRef.current = true;
    setState({
      status: "authenticated",
      identity: identityAtStart,
      signOutStatus: "pending",
    });

    try {
      await port.signOut();

      if (!lifecycleAtStart.active || lifecycleRef.current !== lifecycleAtStart) {
        return;
      }

      // Supabase normally emits SIGNED_OUT first. This fallback keeps cleanup
      // and UI deterministic for adapters or interrupted event delivery.
      if (sessionIdentityRef.current?.userId === identityAtStart.userId) {
        applyChange({ identity: null, reason: "SIGNED_OUT" });
      }
    } catch {
      if (!lifecycleAtStart.active || lifecycleRef.current !== lifecycleAtStart) {
        return;
      }
      const currentIdentity = sessionIdentityRef.current;
      if (!pendingCleanupRef.current && currentIdentity?.userId === identityAtStart.userId) {
        explicitSignOutRef.current = false;
        setState({
          status: "authenticated",
          identity: currentIdentity,
          signOutStatus: "error",
        });
      }
    }
  }, [applyChange, port]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, retryRestore, retryCleanup, signOut }),
    [retryCleanup, retryRestore, signOut, state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be rendered inside AuthProvider");
  return context;
}
