import { Fragment, type ReactNode } from "react";
import type { AnonymousReason } from "./AuthProvider";
import { useAuth } from "./AuthProvider";
import type { AuthIdentity } from "./authPort";

export function RequireAuth({
  children,
  restoring,
  restoreError,
  cleanupError,
  anonymous,
}: {
  readonly children: (identity: AuthIdentity) => ReactNode;
  readonly restoring: ReactNode;
  readonly restoreError: ReactNode;
  readonly cleanupError: ReactNode;
  readonly anonymous: (reason: AnonymousReason) => ReactNode;
}) {
  const { state } = useAuth();

  if (state.status === "restoring") return <>{restoring}</>;
  if (state.status === "restore_error") return <>{restoreError}</>;
  if (state.status === "cleanup_error") return <>{cleanupError}</>;
  if (state.status === "anonymous") return <>{anonymous(state.reason)}</>;

  return <Fragment key={state.identity.userId}>{children(state.identity)}</Fragment>;
}
