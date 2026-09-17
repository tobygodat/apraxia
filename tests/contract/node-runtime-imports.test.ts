import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import { expect, it } from "vitest";

const run = promisify(execFile);

it("loads the emitted API modules with plain Node ESM, including health", async () => {
  const root = process.cwd();
  const scratchParent = path.resolve(root, "node_modules", ".cache");
  await mkdir(scratchParent, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchParent, "apraxia-node-runtime-"));
  // Guard before the try so cleanup never throws out of `finally` and masks a real failure.
  if (path.dirname(path.resolve(scratch)) !== scratchParent) {
    throw new Error("Unexpected runtime-test artifact path");
  }
  try {
    const calendarFiles = (await readdir(path.join(root, "api", "calendar"))).filter((name) =>
      name.endsWith(".ts"),
    );
    const entries = ["api/health.ts", ...calendarFiles.map((name) => `api/calendar/${name}`)];
    // Vercel's Node builder defaults to NodeNext and keeps our package's ESM format.
    // Bundler resolution in the ordinary typecheck cannot detect missing .js suffixes.
    const program = ts.createProgram(
      entries.map((name) => path.join(root, name)),
      {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2021,
        rootDir: root,
        outDir: scratch,
        skipLibCheck: true,
        types: ["node"],
        noEmitOnError: false,
      },
    );
    program.emit();
    await writeFile(path.join(scratch, "package.json"), JSON.stringify({ type: "module" }));
    const check = `
      import { pathToFileURL } from 'node:url';
      import path from 'node:path';
      const entries = ${JSON.stringify(entries.map((name) => name.replace(/\.ts$/, ".js")))};
      for (const entry of entries) {
        const module = await import(pathToFileURL(path.resolve(entry)).href);
        if (typeof module.default?.fetch !== 'function') throw new Error('Missing fetch handler: ' + entry);
        if (entry === 'api/health.js' && module.createHealthResponse({}).status !== 503) throw new Error('Health did not execute');
      }
      console.log('API runtime imports resolved');
    `;
    const result = await run(process.execPath, ["--input-type=module", "-e", check], {
      cwd: scratch,
      timeout: 15_000,
    });
    expect(result.stdout.trim()).toBe("API runtime imports resolved");
  } finally {
    // Delete only the unique artifact directory immediately under our known cache root.
    await rm(scratch, { recursive: true, force: true });
  }
}, 30_000);
