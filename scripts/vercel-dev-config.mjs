// Writes the config `vercel dev` runs with: `vercel.json`, minus the two things
// that only make sense for a deployed build.
//
// - The Content-Security-Policy. Vite's React plugin injects an inline preamble
//   and the local Supabase is an http origin, so the production policy leaves
//   the OAuth callback pages blank in development.
// - The catch-all SPA rewrite. A deployment serves built files before it
//   rewrites; `vercel dev` rewrites first, so Vite's own module and asset
//   requests came back as index.html. Only extensionless page routes fall back.
//
// The output lives in the ignored `.vercel/` folder and is rebuilt on every
// `npm run dev`, so `vercel.json` stays the single source of truth.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const config = JSON.parse(await readFile(new URL("vercel.json", root), "utf8"));

config.headers = (config.headers ?? [])
  .map((rule) => ({
    ...rule,
    headers: rule.headers.filter(({ key }) => key.toLowerCase() !== "content-security-policy"),
  }))
  .filter((rule) => rule.headers.length > 0);

config.rewrites = (config.rewrites ?? []).map((rule) =>
  rule.destination === "/index.html"
    ? { ...rule, source: "/((?!api(?:/|$)|@|node_modules/)[^.]*)" }
    : rule,
);

await mkdir(new URL(".vercel/", root), { recursive: true });
await writeFile(new URL(".vercel/dev.json", root), `${JSON.stringify(config, null, 2)}\n`);
