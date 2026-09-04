import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { beforeAll, describe, expect, it } from "vitest";

interface IgnoreMatcher {
  add(patterns: string): IgnoreMatcher;
  ignores(filePath: string): boolean;
}

interface CommonJsModule {
  exports: unknown;
}

type ModuleInitializer = (exports: unknown, module: CommonJsModule) => void;
type IgnoreFactory = () => IgnoreMatcher;

const repositoryRoot = process.cwd();
const require = createRequire(import.meta.url);
const IGNORE_VERSION = "4.0.6";
const MODULE_MARKER =
  `// ../../node_modules/.pnpm/ignore@${IGNORE_VERSION}/node_modules/ignore/index.js`;
const MODULE_DECLARATION = "var require_ignore = __commonJS({";

/**
 * Exercise the upload parser, not a hand-written approximation of gitignore.
 * Vercel currently bundles this dependency instead of exposing it as a package.
 * Its build-utils helper is not usable in this installed release: it calls
 * `.test()` on ignore@4, which exposes `.ignores()` instead.
 *
 * Read the locked CLI artifact, but execute ONLY the precise versioned ignore
 * module. No CLI entrypoint, deployment helper, filesystem API, network API,
 * environment secrets, or other bundled module is loaded into this context.
 * A bundle-layout/version change intentionally requires this test to be reviewed.
 */
async function loadInstalledUploadIgnore(): Promise<IgnoreFactory> {
  const cliRoot = path.dirname(require.resolve("vercel/package.json"));
  const chunksRoot = path.join(cliRoot, "dist", "chunks");
  const chunkNames = (await readdir(chunksRoot))
    .filter((name) => name.endsWith(".js"))
    .sort();

  let moduleSource: string | null = null;
  for (const chunkName of chunkNames) {
    const source = await readFile(path.join(chunksRoot, chunkName), "utf8");
    const markerIndex = source.indexOf(MODULE_MARKER);
    if (markerIndex < 0) continue;

    const declarationIndex = source.indexOf(MODULE_DECLARATION, markerIndex);
    const nextModuleIndex = source.indexOf("\n// ", markerIndex + MODULE_MARKER.length);
    if (
      declarationIndex < 0 ||
      nextModuleIndex < 0 ||
      declarationIndex >= nextModuleIndex ||
      source.slice(markerIndex + MODULE_MARKER.length, declarationIndex).trim() !== ""
    ) {
      throw new Error("Vercel's bundled ignore module layout changed; re-audit the upload parser.");
    }
    moduleSource = source.slice(declarationIndex, nextModuleIndex).trim();
    if (!moduleSource.endsWith("});") || moduleSource.includes("\nvar require_", MODULE_DECLARATION.length)) {
      throw new Error("The extracted Vercel ignore source is not one isolated CommonJS module.");
    }
    break;
  }

  if (moduleSource === null) {
    throw new Error(`Vercel no longer bundles ignore@${IGNORE_VERSION}; re-audit the upload parser.`);
  }

  const sandbox: {
    process: { platform: string; env: Record<string, never> };
    __commonJS: (initializers: Record<string, ModuleInitializer>) => () => unknown;
    createIgnore?: IgnoreFactory;
  } = {
    process: { platform: process.platform, env: {} },
    __commonJS(initializers) {
      const entries = Object.entries(initializers);
      if (entries.length !== 1 || !entries[0]?.[0].includes(`/ignore@${IGNORE_VERSION}/`)) {
        throw new Error("Unexpected module supplied to the isolated ignore loader.");
      }
      const initialize = entries[0][1];
      let module: CommonJsModule | undefined;
      return () => {
        if (module === undefined) {
          module = { exports: {} };
          initialize(module.exports, module);
        }
        return module.exports;
      };
    },
  };

  runInNewContext(`${moduleSource}\nthis.createIgnore = require_ignore();`, sandbox, {
    timeout: 1_000,
    contextCodeGeneration: { strings: false, wasm: false },
  });
  if (typeof sandbox.createIgnore !== "function") {
    throw new Error("Vercel's isolated ignore dependency did not export its parser.");
  }
  return sandbox.createIgnore;
}

describe("Vercel upload ignore semantics", () => {
  let matcher: IgnoreMatcher;

  beforeAll(async () => {
    const createIgnore = await loadInstalledUploadIgnore();
    // This is the same normalization performed by Vercel's upload helper.
    const rules = (await readFile(path.join(repositoryRoot, ".vercelignore"), "utf8"))
      .replace(/(\n|^)\.\//g, "$1");
    matcher = createIgnore().add(rules);
  });

  it.each([
    "src/orbitos/main.py",
    "deploy/orbitos.service",
    ".venv/Lib/site-packages/example.py",
    ".pytest_cache/v/cache/nodeids",
    ".ruff_cache/example",
    "tests/test_api.py",
    "tests/__pycache__/test_api.pyc",
    "frontend/qa/todos-workspace.html",
    "frontend/src/qa/todosWorkspaceFixture.tsx",
    "frontend/src/qa/todosWorkspaceFixture.css",
    ".env",
    ".env.production",
    "frontend/.env",
    "frontend/.env.local",
    "server/.env.production.local",
    "data/orbitos.db",
    "data/orbitos.db-wal",
    "data/orbitos.db-shm",
    "data/orbitos.sqlite",
    "data/orbitos.sqlite3",
  ])("excludes %s", (filePath) => {
    expect(matcher.ignores(filePath), filePath).toBe(true);
  });

  it.each([
    "frontend/src/main.tsx",
    "frontend/src/App.tsx",
    "frontend/src/config/runtime.ts",
    "frontend/src/features/todos/TodosWorkspace.tsx",
    "frontend/src/types/domain.ts",
    "frontend/index.html",
    "frontend/vite.config.ts",
    "frontend/tsconfig.json",
    "frontend/package.json",
    "api/health.ts",
    "server/env/cloud.ts",
    "shared/supabaseEnvironment.ts",
    "tests/contract/platform-config.test.ts",
    "tests/contract/vercelignore.test.ts",
    "package.json",
    "package-lock.json",
    ".env.example",
    ".env.cloud.example",
    // Synthetic near-matches catch accidental unanchored directory rules.
    "frontend/src/quality.ts",
    "frontend/deploy/theme.ts",
    "packages/example/src/index.ts",
    "frontend/qa-support.ts",
  ])("preserves %s", (filePath) => {
    expect(matcher.ignores(filePath), filePath).toBe(false);
  });
});
