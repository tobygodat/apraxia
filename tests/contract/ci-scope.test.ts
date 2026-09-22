import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const script = path.join(repositoryRoot, "scripts", "ci-scope.mjs");
const cacheRoot = path.join(repositoryRoot, "node_modules", ".cache");
let scratch: string;
let version = 0;

function git(...args: string[]) {
  return execFileSync("git", args, { cwd: scratch, encoding: "utf8" }).trim();
}

function commitFiles(files: string[], content?: string) {
  const base = git("rev-parse", "HEAD");
  for (const file of files) {
    const target = path.join(scratch, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${content ?? "fixture"} ${version++}\n`);
  }
  git("add", "--", ...files);
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  return { base, head: git("rev-parse", "HEAD") };
}

function scope(job: string, eventName: string, base: string, head: string, eventText?: string) {
  const eventFile = path.join(scratch, "event.json");
  const outputFile = path.join(scratch, "output.txt");
  const summaryFile = path.join(scratch, "summary.md");
  writeFileSync(
    eventFile,
    eventText ?? JSON.stringify({ before: base, pull_request: { base: { sha: base } } }),
  );
  writeFileSync(outputFile, "");
  writeFileSync(summaryFile, "");
  const result = spawnSync(process.execPath, [script, job], {
    cwd: scratch,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: eventName,
      GITHUB_EVENT_PATH: eventFile,
      GITHUB_SHA: head,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
    },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(summaryFile, "utf8")).toContain(result.stdout.trim());
  return readFileSync(outputFile, "utf8").trim();
}

beforeAll(() => {
  mkdirSync(cacheRoot, { recursive: true });
  scratch = mkdtempSync(path.join(cacheRoot, "apraxia-ci-scope-"));
  if (path.dirname(path.resolve(scratch)) !== cacheRoot) throw new Error("Unexpected fixture path");
  git("init", "-q");
  git("config", "core.hooksPath", path.join(scratch, "no-hooks"));
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "initial",
  );
});

afterAll(() => {
  if (scratch && path.dirname(path.resolve(scratch)) === cacheRoot) {
    rmSync(scratch, { recursive: true, force: true });
  }
});

describe("database CI scope", () => {
  it.each(["pull_request", "push"])("skips only documented docs/style paths on %s", (event) => {
    const { base, head } = commitFiles([
      "AGENTS.md",
      "README.md",
      "PRODUCT.md",
      "DESIGN.md",
      "docs/a guide.md",
      "frontend/src/features/calendar/calendar.css",
      ".impeccable/design.json",
    ]);
    expect(scope("database", event, base, head)).toBe("required=false");
  });

  it("skips presentational components and tests the database job never runs", () => {
    const { base, head } = commitFiles([
      "frontend/src/components/Button.tsx",
      "frontend/src/features/todos/TodoRow.test.tsx",
      "frontend/src/features/todos/dateDomain.test.ts",
      "frontend/src/qa/workspaceFixture.tsx",
      "frontend/qa/workspace.html",
      "tests/contract/search.test.ts",
    ]);
    expect(scope("database", "pull_request", base, head)).toBe("required=false");
  });

  it.each([
    'import { supabase } from "../lib/supabaseClient";',
    'import type { Database } from "../types/database";',
  ])("runs for a component containing %s", (content) => {
    const { base, head } = commitFiles(["frontend/src/apps/CloudApp.tsx"], content);
    expect(scope("database", "pull_request", base, head)).toBe("required=true");
  });

  it("runs when a component stops naming Supabase or is deleted while naming it", () => {
    const file = "frontend/src/auth/SessionGate.tsx";
    commitFiles([file], "createClient from supabase");
    const cleaned = commitFiles([file]);
    expect(scope("database", "pull_request", cleaned.base, cleaned.head)).toBe("required=true");

    commitFiles([file], "createClient from supabase");
    const base = git("rev-parse", "HEAD");
    git("rm", "-q", file);
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "rm",
    );
    expect(scope("database", "pull_request", base, git("rev-parse", "HEAD"))).toBe("required=true");
  });

  it.each([
    "supabase/migrations/change.sql",
    "frontend/src/auth/session.ts",
    "frontend/src/features/todos/service.ts",
    "frontend/src/lib/usePhoneLayout.ts",
    "frontend/tests/local/todos-ui.test.tsx",
    "tests/local/todos.test.ts",
    "server/calendar/calendarStore.ts",
    "package-lock.json",
    "vercel.json",
    ".github/workflows/ci.yml",
    "scripts/ci-scope.mjs",
    "docs/executable.js",
    "unknown/file.md",
  ])("runs for mixed documentation and %s changes", (file) => {
    const { base, head } = commitFiles(["README.md", file]);
    expect(scope("database", "pull_request", base, head)).toBe("required=true");
  });

  it("counts the old path when code is renamed to a documentation path", () => {
    commitFiles(["server/rename-me.ts"]);
    const base = git("rev-parse", "HEAD");
    git("mv", "server/rename-me.ts", "docs/renamed.md");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "rename",
    );
    expect(scope("database", "pull_request", base, git("rev-parse", "HEAD"))).toBe("required=true");
  });

  it.each(["pull_request", "push"])(
    "checks the whole %s range, including earlier code commits",
    (event) => {
      const { base } = commitFiles(["server/earlier.ts"]);
      const { head } = commitFiles(["README.md"]);
      expect(scope("database", event, base, head)).toBe("required=true");
    },
  );

  it("runs for manual dispatch, unknown events, and empty diffs", () => {
    const { base, head } = commitFiles(["README.md"]);
    expect(scope("database", "workflow_dispatch", base, head)).toBe("required=true");
    expect(scope("database", "unknown", base, head)).toBe("required=true");
    expect(scope("database", "push", head, head)).toBe("required=true");
  });

  it("runs when history or event data cannot establish the diff", () => {
    const head = git("rev-parse", "HEAD");
    expect(scope("database", "push", "0".repeat(40), head)).toBe("required=true");
    expect(scope("database", "push", "f".repeat(40), head)).toBe("required=true");
    expect(scope("database", "pull_request", "--invalid-ref", head)).toBe("required=true");
    expect(scope("database", "pull_request", head, head, "invalid JSON")).toBe("required=true");
    expect(scope("database", "pull_request", head, head, "{}")).toBe("required=true");
  });
});

describe("contract CI scope", () => {
  it("skips documentation, styles, and suites the contract job never runs", () => {
    const { base, head } = commitFiles([
      "README.md",
      "docs/a guide.md",
      ".impeccable/design.json",
      "frontend/src/features/calendar/calendar.css",
      "frontend/src/features/todos/TodoRow.test.tsx",
      "frontend/src/features/todos/dateDomain.test.ts",
      "frontend/src/qa/workspaceFixture.tsx",
      "frontend/qa/workspace.html",
      "frontend/tests/local/todos-ui.test.tsx",
      "tests/local/todos.test.ts",
      "supabase/tests/170_career_prep.test.sql",
    ]);
    expect(scope("contract", "pull_request", base, head)).toBe("required=false");
  });

  it.each([
    "tests/contract/search.test.ts",
    "tests/helpers/storageHarness.ts",
    "supabase/migrations/change.sql",
    "server/calendar/calendarStore.ts",
    "api/health.ts",
    "frontend/src/features/todos/service.ts",
    // A .ts module can import a .tsx one, so a component is not inert here.
    "frontend/src/apps/workspaceStore.tsx",
    "package-lock.json",
    "scripts/ci-scope.mjs",
    ".github/workflows/ci.yml",
  ])("runs for mixed documentation and %s changes", (file) => {
    const { base, head } = commitFiles(["README.md", file]);
    expect(scope("contract", "pull_request", base, head)).toBe("required=true");
  });
});

describe("frontend CI scope", () => {
  it("skips documentation, styles, and everything outside frontend/src", () => {
    const { base, head } = commitFiles([
      "README.md",
      "docs/a guide.md",
      ".impeccable/design.json",
      "frontend/src/features/calendar/calendar.css",
      "tests/contract/search.test.ts",
      "tests/local/todos.test.ts",
      "api/health.ts",
      "supabase/migrations/change.sql",
      "supabase/tests/170_career_prep.test.sql",
      "frontend/tests/local/todos-ui.test.tsx",
    ]);
    expect(scope("frontend", "pull_request", base, head)).toBe("required=false");
  });

  it("skips only paths that no frontend/src module imports", () => {
    const skipped = /^(tests|frontend\/tests|api|supabase)\//;
    const sourceRoot = path.join(repositoryRoot, "frontend", "src");
    const escapes: string[] = [];
    for (const entry of readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })) {
      if (!/\.(tsx?|mts)$/.test(entry)) continue;
      const file = path.join(sourceRoot, entry);
      for (const match of readFileSync(file, "utf8").matchAll(
        /(?:from|import\(|glob[^(]*\()\s*["'`](\.[^"'`]+)["'`]/g,
      )) {
        const target = path
          .relative(repositoryRoot, path.resolve(path.dirname(file), match[1]!))
          .split(path.sep)
          .join("/");
        if (skipped.test(target)) escapes.push(`${entry} -> ${target}`);
      }
    }
    expect(escapes).toEqual([]);
  });

  it.each([
    // The QA calendar fixture, which the frontend job tests, imports server code.
    "server/calendar/normalizeGoogleEvent.ts",
    "frontend/src/features/todos/TodoRow.test.tsx",
    "frontend/src/features/todos/service.ts",
    "frontend/src/apps/workspaceStore.tsx",
    // The frontend job runs the fixture's own test, so a fixture is not inert.
    "frontend/src/qa/workspaceFixture.tsx",
    "vitest.config.ts",
    "package-lock.json",
    ".github/workflows/ci.yml",
  ])("runs for mixed documentation and %s changes", (file) => {
    const { base, head } = commitFiles(["README.md", file]);
    expect(scope("frontend", "pull_request", base, head)).toBe("required=true");
  });
});

describe("scope job names", () => {
  it("refuses a job it does not know", () => {
    const result = spawnSync(process.execPath, [script, "typecheck"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("database|contract|frontend");
  });
});
