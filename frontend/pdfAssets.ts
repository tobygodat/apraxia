import { createReadStream, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

// Serve the same local decoding/font assets in development and production.
export function pdfAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const files = new Map<string, string>();
  for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
    for (const name of readdirSync(join(root, directory))) {
      files.set(`/pdf-assets/${directory}/${name}`, join(root, directory, name));
    }
  }
  return {
    name: "local-pdf-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = files.get((request.url ?? "").split("?")[0]);
        if (!path) return next();
        response.setHeader("Content-Type", path.endsWith(".wasm") ? "application/wasm" : path.endsWith(".js") ? "application/javascript" : "application/octet-stream");
        createReadStream(path).pipe(response);
      });
    },
    generateBundle() {
      for (const [url, path] of files) this.emitFile({ type: "asset", fileName: url.slice(1), source: readFileSync(path) });
    },
  };
}
