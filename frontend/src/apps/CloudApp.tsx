import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth, type AnonymousReason } from "../auth/AuthProvider";
import { RequireAuth } from "../auth/RequireAuth";
import type { AuthIdentity } from "../auth/authPort";
import { createSupabaseAuthPort } from "../auth/supabaseAuthPort";
import {
  createGoogleSignInPort,
  GOOGLE_SIGN_IN_ERROR,
  type GoogleSignInPort,
} from "../auth/googleSignIn";
import { BrowserEnvironmentError } from "../config/browserEnv";
import { getBrowserSupabaseClient } from "../lib/supabase";
import type { Database } from "../types/database";
import type { TodoService } from "../features/todos/todoService";
import { createSupabaseTodoService } from "../features/todos/supabaseTodoService";
import { WorkspaceRuntime } from "./WorkspaceRuntime";
import { createWorkspaceData } from "./workspaceData";
import { createDriveService } from "../features/classes/driveService";
import { createCollectionService } from "../features/collections/collectionService";
import { createCalendarService } from "../features/calendar/calendarService";

const DriveCallback = lazy(() =>
  import("./DriveCallback").then((m) => ({ default: m.DriveCallback })),
);
const CalendarCallback = lazy(() =>
  import("./CalendarCallback").then((m) => ({ default: m.CalendarCallback })),
);

function AuthFrame({
  eyebrow,
  title,
  children,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-card-title">
        <p className="auth-card__eyebrow">{eyebrow}</p>
        <h1 id="auth-card-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}

function RestoringSession() {
  return (
    <main className="auth-screen" aria-busy="true">
      <p className="auth-status" role="status">
        Restoring your apraxia session…
      </p>
    </main>
  );
}

function RestoreError() {
  const { retryRestore } = useAuth();
  return (
    <AuthFrame eyebrow="Session check" title="apraxia could not verify your session">
      <p className="auth-card__copy" role="alert">
        Your data has not been loaded. Check the connection and try again.
      </p>
      <button className="auth-card__button" type="button" onClick={retryRestore}>
        Try again
      </button>
    </AuthFrame>
  );
}

function CleanupError() {
  const { retryCleanup } = useAuth();
  return (
    <AuthFrame eyebrow="Account boundary" title="The previous workspace could not close safely">
      <p className="auth-card__copy" role="alert">
        apraxia has kept every private workspace closed because local user state could not be
        cleared. Try the cleanup again before continuing.
      </p>
      <button className="auth-card__button" type="button" onClick={retryCleanup}>
        Retry secure cleanup
      </button>
    </AuthFrame>
  );
}

function SignedOut({
  reason,
  signInPort,
}: {
  readonly reason: AnonymousReason;
  readonly signInPort: GoogleSignInPort;
}) {
  const [signInStatus, setSignInStatus] = useState<"idle" | "pending" | "error">("idle");
  const attemptRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSignInStatus("idle");
    const resumePage = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // Back from Google may restore this exact screen from the browser's
      // page cache instead of mounting it again. Allow a fresh attempt.
      attemptRef.current?.abort();
      attemptRef.current = null;
      setSignInStatus("idle");
    };
    globalThis.addEventListener("pageshow", resumePage);
    return () => {
      globalThis.removeEventListener("pageshow", resumePage);
      attemptRef.current?.abort();
      attemptRef.current = null;
    };
  }, [signInPort]);

  async function signIn() {
    // A synchronous latch covers repeated clicks before React rerenders.
    if (attemptRef.current) return;
    const attempt = new AbortController();
    attemptRef.current = attempt;
    setSignInStatus("pending");

    try {
      await signInPort.start(attempt.signal);
      // Keep the control disabled while the browser leaves for Google.
    } catch {
      if (attempt.signal.aborted || attemptRef.current !== attempt) return;
      attemptRef.current = null;
      setSignInStatus("error");
    }
  }

  const title =
    reason === "expired"
      ? "Your session ended"
      : reason === "signed_out"
        ? "You’re signed out"
        : "Sign in to apraxia";
  const copy =
    reason === "expired"
      ? "Sign in again to reopen your private workspace."
      : reason === "signed_out"
        ? "Your private workspace is closed on this device."
        : "Use your Google account to open your private workspace.";

  return (
    <AuthFrame eyebrow="Private workspace" title={title}>
      <p className="auth-card__copy">{copy}</p>
      <button
        className="auth-card__button"
        type="button"
        disabled={signInStatus === "pending"}
        aria-busy={signInStatus === "pending"}
        aria-describedby={signInStatus === "pending" ? "sign-in-progress" : undefined}
        onClick={() => void signIn()}
      >
        {signInStatus === "pending" ? "Opening Google…" : "Continue with Google"}
      </button>
      <p className="auth-live-region" id="sign-in-progress" role="status">
        {signInStatus === "pending" ? "Opening Google to sign in securely." : ""}
      </p>
      {signInStatus === "error" ? (
        <p className="auth-card__error" role="alert">
          {GOOGLE_SIGN_IN_ERROR}
        </p>
      ) : null}
      <p className="auth-card__note">
        Calendar access is separate; signing in does not connect it. No personal records are loaded
        while signed out.
      </p>
    </AuthFrame>
  );
}

function CloudConfigurationError({ error }: { readonly error: unknown }) {
  const environmentError = error instanceof BrowserEnvironmentError;
  const title = environmentError
    ? "Cloud configuration is incomplete"
    : "The secure session could not start";

  return (
    <AuthFrame eyebrow="Cloud setup" title={title}>
      <p className="auth-card__copy" role="alert">
        {environmentError
          ? "Configure " + error.variables.join(" and ") + ", then restart the app."
          : "Check this browser’s storage access, then reload the app."}{" "}
        No personal records were requested.
      </p>
    </AuthFrame>
  );
}

function CloudWorkspace({
  identity,
  service,
  client,
}: {
  readonly identity: AuthIdentity;
  readonly service: TodoService;
  readonly client: SupabaseClient<Database>;
}) {
  const { state, signOut } = useAuth();
  const collectionService = useMemo(() => createCollectionService(client), [client]);
  const calendarService = useMemo(() => createCalendarService(client), [client]);
  const driveService = useMemo(() => createDriveService(client), [client]);
  const workspaceData = useMemo(() => createWorkspaceData(client), [client]);
  const signOutStatus = state.status === "authenticated" ? state.signOutStatus : "idle";
  return (
    <Suspense fallback={<RestoringSession />}>
      <Routes>
        <Route
          path="/drive/callback"
          element={<DriveCallback client={client} userId={identity.userId} />}
        />
        <Route
          path="/calendar/callback"
          element={<CalendarCallback client={client} userId={identity.userId} />}
        />
        <Route
          path="/*"
          element={
            <WorkspaceRuntime
              identity={identity}
              signOutStatus={signOutStatus}
              onSignOut={signOut}
              todoService={service}
              collectionService={collectionService}
              calendarService={calendarService}
              driveService={driveService}
              workspaceData={workspaceData}
            />
          }
        />
      </Routes>
    </Suspense>
  );
}
export function ConfiguredCloudApp({
  client,
  googleSignInPort,
}: {
  readonly client: SupabaseClient<Database>;
  readonly googleSignInPort?: GoogleSignInPort;
}) {
  const port = useMemo(() => createSupabaseAuthPort(client), [client]);
  const service = useMemo(() => createSupabaseTodoService(client), [client]);
  const signInPort = useMemo(
    () => googleSignInPort ?? createGoogleSignInPort(client),
    [client, googleSignInPort],
  );

  return (
    <AuthProvider port={port}>
      <RequireAuth
        restoring={<RestoringSession />}
        restoreError={<RestoreError />}
        cleanupError={<CleanupError />}
        anonymous={(reason) => <SignedOut reason={reason} signInPort={signInPort} />}
      >
        {(identity) => (
          <CloudWorkspace
            key={identity.userId}
            identity={identity}
            service={service}
            client={client}
          />
        )}
      </RequireAuth>
    </AuthProvider>
  );
}

export default function CloudApp() {
  try {
    const client = getBrowserSupabaseClient();
    return <ConfiguredCloudApp client={client} />;
  } catch (error) {
    return <CloudConfigurationError error={error} />;
  }
}
