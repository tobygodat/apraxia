import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function listSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listSources(entryPath);
      return /\.(ts|tsx)$/.test(entry.name) ? [entryPath] : [];
    }),
  );
  return files.flat();
}

describe("browser environment inlining", () => {
  it("never references import.meta.env as a whole object", async () => {
    // Vite inlines every VITE_* variable when the whole object is used, including the git
    // metadata Vercel exposes at build time such as VITE_VERCEL_GIT_COMMIT_MESSAGE.
    const wholeObject = /import\.meta\.env(?![.\w])/;
    const offenders: string[] = [];
    for (const file of await listSources(path.resolve("frontend", "src"))) {
      const contents = await readFile(file, "utf8");
      if (wholeObject.test(contents)) offenders.push(path.relative(process.cwd(), file));
    }
    expect(offenders).toEqual([]);
  });
});
