import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const bundleDirectory = path.resolve("frontend", "dist");
const sensitiveNames = [
  "ORBITOS_AGENT_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_TOKEN_ENCRYPTION_KEY",
];
const sensitiveValues = sensitiveNames
  .map((name) => process.env[name])
  .filter((value) => typeof value === "string" && value.length >= 8);
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map"]);
const secretKeyPattern = /sb_secret_[a-z0-9_-]{4,}/gi;
const jwtPattern = /[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+/gi;

function decodeJwtRole(value) {
  const payload = value.split(".")[1];
  if (!payload) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && typeof parsed.role === "string"
      ? parsed.role
      : null;
  } catch {
    return null;
  }
}

function isPrivilegedSupabaseKey(value) {
  if (typeof value !== "string" || value.trim() === "") return false;

  const normalized = value.trim();
  if (normalized.toLowerCase().startsWith("sb_secret_")) return true;

  const role = decodeJwtRole(normalized);
  return role !== null && role !== "anon";
}

function containsPrivilegedSupabaseKey(contents) {
  secretKeyPattern.lastIndex = 0;
  if (secretKeyPattern.test(contents)) return true;

  jwtPattern.lastIndex = 0;
  return [...contents.matchAll(jwtPattern)].some((match) => isPrivilegedSupabaseKey(match[0]));
}

if (isPrivilegedSupabaseKey(process.env.VITE_SUPABASE_ANON_KEY)) {
  throw new Error("VITE_SUPABASE_ANON_KEY is privileged and cannot enter a browser build.");
}

async function listTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listTextFiles(entryPath);
      return textExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
    }),
  );

  return files.flat();
}

let files;
try {
  files = await listTextFiles(bundleDirectory);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
    throw new Error("Browser bundle is missing; run the production build first.", {
      cause: error,
    });
  }
  throw error;
}

for (const file of files) {
  const contents = await readFile(file, "utf8");
  const containsName = sensitiveNames.some((name) => contents.includes(name));
  const containsValue = sensitiveValues.some((value) => contents.includes(value));
  const containsPrivilegedKey = containsPrivilegedSupabaseKey(contents);

  if (containsName || containsValue || containsPrivilegedKey) {
    throw new Error(
      `Server-only environment material found in ${path.relative(bundleDirectory, file)}.`,
    );
  }
}

console.log(`Checked ${files.length} browser bundle files; no server-only material found.`);
