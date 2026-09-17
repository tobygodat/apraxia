import { lazy, Suspense } from "react";
import { resolveRuntimeMode } from "./config/runtime";
// Cloud is the only production runtime, so it ships in the entry chunk rather
// than behind a second round trip. Vite inlines VITE_ORBITOS_RUNTIME at build
// time (see vite.config.ts), so the legacy tree and its stylesheet are still
// dropped from cloud bundles entirely. The recovery-only legacy build carries
// the cloud modules without rendering them; that direction is not optimized.
import CloudApp from "./apps/CloudApp";

const LegacyApp =
  import.meta.env.VITE_ORBITOS_RUNTIME === "legacy" ? lazy(() => import("./apps/LegacyApp")) : null;

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
    const message = error instanceof Error ? error.message : "Check VITE_ORBITOS_RUNTIME.";
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
      {runtime === "legacy" && LegacyApp ? <LegacyApp /> : <CloudApp />}
    </Suspense>
  );
}
