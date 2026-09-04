import { lazy, Suspense } from "react";
import { resolveRuntimeMode } from "./config/runtime";

const CloudApp = lazy(() => import("./apps/CloudApp"));
const LegacyApp = lazy(() => import("./apps/LegacyApp"));

function RuntimeConfigurationError({ message }: { message: string }) {
  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="runtime-error-title">
        <p className="auth-card__eyebrow">orbitOS setup</p>
        <h1 id="runtime-error-title">The app runtime is not configured</h1>
        <p className="auth-card__copy" role="alert">
          {message}
        </p>
      </section>
    </main>
  );
}

export default function App() {
  let runtime;

  try {
    runtime = resolveRuntimeMode(import.meta.env.VITE_ORBITOS_RUNTIME);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Check VITE_ORBITOS_RUNTIME.";
    return <RuntimeConfigurationError message={message} />;
  }

  return (
    <Suspense
      fallback={
        <main className="auth-screen" aria-busy="true">
          <p className="auth-status" role="status">
            Opening orbitOS…
          </p>
        </main>
      }
    >
      {runtime === "legacy" ? <LegacyApp /> : <CloudApp />}
    </Suspense>
  );
}
