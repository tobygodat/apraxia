import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const scannerPath = path.join(
  repositoryRoot,
  "scripts",
  "check-browser-bundle.mjs",
);

async function runScanner(
  contents: string,
  environment: Record<string, string> = {},
) {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "orbitos-browser-bundle-"),
  );
  const bundleDirectory = path.join(temporaryRoot, "frontend", "dist");

  try {
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(path.join(bundleDirectory, "index.js"), contents, "utf8");

    return spawnSync(process.execPath, [scannerPath], {
      cwd: temporaryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GOOGLE_CLIENT_SECRET: "",
        GOOGLE_TOKEN_ENCRYPTION_KEY: "",
        SUPABASE_SERVICE_ROLE_KEY: "",
        VITE_SUPABASE_ANON_KEY: "",
        ...environment,
      },
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

describe("browser bundle policy", () => {
  it("allows browser-safe Supabase key formats", async () => {
    const anonJwt = `header.${Buffer.from(
      JSON.stringify({ role: "anon" }),
    ).toString("base64url")}.signature`;
    const result = await runScanner(
      `const publishable = "sb_publishable_example"; const anon = "${anonJwt}";`,
      { VITE_SUPABASE_ANON_KEY: "sb_publishable_example" },
    );

    expect(result.status, result.stderr).toBe(0);
  });

  it.each([
    "sb_secret_do-not-bundle-this",
    `header.${Buffer.from(
      JSON.stringify({ role: "service_role" }),
    ).toString("base64url")}.signature`,
  ])("rejects an unsafe configured browser key without echoing it", async (key) => {
    const result = await runScanner("const clean = true;", {
      SUPABASE_SERVICE_ROLE_KEY: "a-different-server-secret",
      VITE_SUPABASE_ANON_KEY: key,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("VITE_SUPABASE_ANON_KEY is privileged");
    expect(result.stderr).not.toContain(key);
  });

  it.each([
    "sb_secret_embedded-canary",
    `header.${Buffer.from(
      JSON.stringify({ role: "service_role" }),
    ).toString("base64url")}.signature`,
  ])("rejects an embedded privileged key without echoing it", async (key) => {
    const result = await runScanner(`const leaked = "${key}";`);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Server-only environment material found");
    expect(result.stderr).not.toContain(key);
  });

  it("still rejects configured server-secret values", async () => {
    const secret = "server-secret-value-canary";
    const result = await runScanner(`const leaked = "${secret}";`, {
      GOOGLE_CLIENT_SECRET: secret,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain(secret);
  });
});
