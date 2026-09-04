export type UserStateResetPhase = "cancel" | "clear";

/**
 * User-state cleanup must complete synchronously before another account can
 * mount. The runtime still validates the return value because TypeScript lets
 * async functions flow into callbacks whose return value would otherwise be
 * ignored.
 */
export type UserStateResetter = () => unknown;

export interface RegisterUserStateResetterOptions {
  phase?: UserStateResetPhase;
}

interface RegisteredResetter {
  active: boolean;
  reset: UserStateResetter;
}

export interface UserStateCleanupResult {
  readonly ok: boolean;
  retry(): UserStateCleanupResult;
}

const resetters: Record<UserStateResetPhase, Map<symbol, RegisteredResetter>> = {
  cancel: new Map(),
  clear: new Map(),
};

let isClearingUserState = false;

function reportResetterFailure(): void {
  try {
    console.error("Failed to clear user-scoped application state.");
  } catch {
    // Reporting must never prevent the remaining resetters from running.
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

/**
 * Registers an in-memory resetter for state owned by the signed-in user.
 *
 * Cancellation resetters run before cache and draft resetters. Within a phase,
 * resetters run in registration order. The returned unregister function is
 * safe to call more than once. Resetters must be synchronous and idempotent;
 * returning a promise or thenable makes cleanup fail closed.
 */
export function registerUserStateResetter(
  reset: UserStateResetter,
  { phase = "clear" }: RegisterUserStateResetterOptions = {},
): () => void {
  const token = Symbol("user-state-resetter");
  const registeredResetter: RegisteredResetter = {
    active: true,
    reset,
  };
  const phaseResetters = resetters[phase];

  phaseResetters.set(token, registeredResetter);

  return () => {
    if (!registeredResetter.active) return;

    registeredResetter.active = false;
    phaseResetters.delete(token);
  };
}

function successfulCleanup(): UserStateCleanupResult {
  return { ok: true, retry: successfulCleanup };
}

function runResetters(
  orderedResetters: readonly UserStateResetter[],
): UserStateCleanupResult {
  if (isClearingUserState) return successfulCleanup();

  isClearingUserState = true;
  let failed = false;

  try {
    for (const reset of orderedResetters) {
      try {
        const result = reset();
        if (isThenable(result)) {
          failed = true;
          reportResetterFailure();

          // An invalid asynchronous resetter has already started. Prevent a
          // later rejection from leaking sensitive details or becoming an
          // unhandled rejection, but never treat its eventual result as proof
          // that the synchronous account boundary was cleared.
          void Promise.resolve(result).catch(() => {});
        }
      } catch {
        failed = true;
        reportResetterFailure();
      }
    }
  } finally {
    isClearingUserState = false;
  }

  if (!failed) return successfulCleanup();

  return {
    ok: false,
    // Retry the complete snapshot, not only failed callbacks. A cancellation
    // failure can allow an in-flight request to repopulate a cache that was
    // cleared later in the first pass, so the successful retry must repeat the
    // cancel-then-clear sequence before another account mounts.
    retry: () => runResetters(orderedResetters),
  };
}

/**
 * Clears only state explicitly registered by application features.
 *
 * This deliberately does not enumerate or clear browser storage, allowing the
 * authentication provider to retain and manage its own session keys. A failed
 * result retains the exact failed callbacks in its retry closure, so component
 * unmount cannot accidentally turn a failed account boundary into success.
 */
export function clearUserScopedState(): UserStateCleanupResult {
  const orderedResetters = [
    ...[...resetters.cancel.values()]
      .filter((resetter) => resetter.active)
      .map((resetter) => resetter.reset),
    ...[...resetters.clear.values()]
      .filter((resetter) => resetter.active)
      .map((resetter) => resetter.reset),
  ];

  return runResetters(orderedResetters);
}
