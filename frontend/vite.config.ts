import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { resolveRuntimeMode } from "./src/config/runtime.ts";

type ViteEnvironment = Record<string, string | undefined>;

export function createViteConfig(environment: ViteEnvironment) {
  const runtimeMode = resolveRuntimeMode(environment.VITE_APRAXIA_RUNTIME);
  const cloudDev = environment.APRAXIA_CLOUD_DEV === "1";

  if (cloudDev && runtimeMode === "legacy") {
    throw new Error("APRAXIA_CLOUD_DEV=1 cannot be combined with VITE_APRAXIA_RUNTIME=legacy.");
  }

  const cloudRuntime = cloudDev || runtimeMode === "cloud";
  const requestedPort = Number.parseInt(environment.PORT ?? "", 10);

  return {
    plugins: [react()],
    // A literal lets Rollup drop the legacy runtime branch in App.tsx.
    define: { "import.meta.env.VITE_APRAXIA_RUNTIME": JSON.stringify(runtimeMode) },
    server: {
      port: Number.isNaN(requestedPort) ? 5173 : requestedPort,
      strictPort: true,
      proxy: cloudRuntime
        ? undefined
        : {
            "/api": "http://127.0.0.1:8000",
          },
    },
  };
}

// Cloud is the safe default. The FastAPI proxy exists only behind the explicit
// legacy runtime command while the old application remains recoverable.
export default defineConfig(() => createViteConfig(process.env));
