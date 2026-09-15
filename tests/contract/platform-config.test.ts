import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("Vercel platform configuration", () => {
  it("builds the frontend and keeps API paths out of the SPA fallback", async () => {
    const contents = await readFile(path.join(repositoryRoot, "vercel.json"), "utf8");
    const config = JSON.parse(contents) as {
      framework: string;
      buildCommand: string;
      devCommand: string;
      outputDirectory: string;
      functions: Record<string, { maxDuration: number }>;
      rewrites: Array<{ source: string; destination: string }>;
    };

    expect(config).toMatchObject({
      framework: "vite",
      buildCommand: "npm run build && npm run check:bundle",
      devCommand: "npm run dev:web",
      outputDirectory: "frontend/dist",
    });
    // Explicit budgets: both function groups outlive their internal timeouts
    // (20 s calendar load, 120 s Drive PDF stream) instead of the plan default.
    expect(config.functions["api/calendar/**"]?.maxDuration).toBeGreaterThan(20);
    expect(config.functions["api/drive/**"]?.maxDuration).toBeGreaterThan(120);
    expect(config.rewrites).toEqual([
      {
        source: "/((?!api(?:/|$)).*)",
        destination: "/index.html",
      },
    ]);

    const spaFallback = /^\/((?!api(?:\/|$)).*)$/;
    expect(spaFallback.test("/todos")).toBe(true);
    expect(spaFallback.test("/projects/example")).toBe(true);
    expect(spaFallback.test("/api/health")).toBe(false);
    expect(spaFallback.test("/api/missing")).toBe(false);
  });

  it("keeps every populated environment file out of deployment uploads", async () => {
    const rules = (await readFile(path.join(repositoryRoot, ".vercelignore"), "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const envRule = rules.indexOf(".env");
    const envVariantsRule = rules.indexOf(".env.*");
    const legacyTemplateException = rules.indexOf("!.env.legacy.example");
    const cloudTemplateException = rules.indexOf("!.env.cloud.example");

    expect(envRule).toBeGreaterThanOrEqual(0);
    expect(envVariantsRule).toBeGreaterThan(envRule);
    expect(legacyTemplateException).toBeGreaterThan(envVariantsRule);
    expect(cloudTemplateException).toBeGreaterThan(envVariantsRule);
  });

  it("pins matching app and proxy modes in both development commands", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["dev:web"]).toContain(
      "ORBITOS_CLOUD_DEV=1 VITE_ORBITOS_RUNTIME=cloud",
    );
    expect(packageJson.scripts["dev:legacy-web"]).toContain(
      "ORBITOS_CLOUD_DEV=0 VITE_ORBITOS_RUNTIME=legacy",
    );
  });
});

describe("browser/server environment boundary", () => {
  it("keeps server-only variable names out of frontend source", async () => {
    const sensitiveNames = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_TOKEN_ENCRYPTION_KEY",
    ];
    const frontendFiles = ["frontend/src", "frontend/vite.config.ts", "frontend/index.html"];

    async function collectFiles(target: string): Promise<string[]> {
      const absoluteTarget = path.join(repositoryRoot, target);
      const stats = await stat(absoluteTarget);
      if (stats.isFile()) return [absoluteTarget];

      const entries = await readdir(absoluteTarget, { withFileTypes: true });
      const nested = await Promise.all(
        entries.map((entry) => collectFiles(path.join(target, entry.name))),
      );
      return nested.flat();
    }

    const files = (await Promise.all(frontendFiles.map(collectFiles))).flat();
    for (const file of files) {
      const contents = await readFile(file, "utf8");
      for (const name of sensitiveNames) {
        expect(contents, `${name} appeared in ${file}`).not.toContain(name);
      }
    }
  });
});

it("allows restricted Google embeds to identify the app origin without revealing paths or queries", async () => {
  const config = JSON.parse(await readFile(path.join(repositoryRoot, "vercel.json"), "utf8"));
  const globalHeaders = config.headers.find(
    (entry: { source: string }) => entry.source === "/(.*)",
  ).headers;
  expect(globalHeaders).toContainEqual({ key: "Referrer-Policy", value: "strict-origin" });
  const html = await readFile(path.join(repositoryRoot, "frontend/index.html"), "utf8");
  expect(html).toContain('<meta name="referrer" content="strict-origin"');
  expect(html).not.toContain('name="referrer" content="no-referrer"');
});
