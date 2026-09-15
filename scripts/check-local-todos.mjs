// Only the fixed local API is used. CLI credentials stay in process memory.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

try {
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  if (
    !/^project_id\s*=\s*"orbitos"\s*$/m.test(config) ||
    !/^max_rows\s*=\s*1000\s*$/m.test(config)
  ) {
    throw new Error("Unexpected local project configuration.");
  }
  const status = JSON.parse(
    execFileSync(
      process.execPath,
      ["node_modules/supabase/dist/supabase.js", "status", "--output", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000, windowsHide: true },
    ),
  );
  if (
    status.API_URL !== "http://127.0.0.1:54321" ||
    new URL(status.DB_URL).hostname !== "127.0.0.1" ||
    new URL(status.DB_URL).port !== "54322" ||
    typeof status.PUBLISHABLE_KEY !== "string" ||
    typeof status.SECRET_KEY !== "string"
  ) {
    throw new Error("Local Supabase is unavailable or its addresses do not match.");
  }
  const run = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.local.config.ts"],
    {
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        ORBITOS_LOCAL_API: status.API_URL,
        ORBITOS_LOCAL_PUBLIC_KEY: status.PUBLISHABLE_KEY,
        ORBITOS_LOCAL_SECRET_KEY: status.SECRET_KEY,
      },
    },
  );
  process.exitCode = run.status ?? 1;
} catch {
  console.error(
    "Local Todo verification could not start. Start orbitos local Supabase first; no hosted target is supported.",
  );
  process.exitCode = 1;
}
