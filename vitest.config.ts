import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/contract/**/*.test.ts", "frontend/src/**/*.test.{ts,tsx}"],
    setupFiles: ["frontend/src/vitestSetup.ts"],
    restoreMocks: true,
  },
});
