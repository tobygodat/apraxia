// Rewinds the local database to the initial schema migration and reapplies it.
// The Supabase CLI requires at least one migration to remain, so the rewind
// count is always the migration count minus one; deriving it here keeps the
// check correct when migrations are added.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const directory = path.resolve("supabase", "migrations");
const migrations = readdirSync(directory).filter((name) => name.endsWith(".sql"));

if (migrations.length < 2) {
  console.error(`Expected at least two migrations in ${directory}; found ${migrations.length}.`);
  process.exit(1);
}

const last = migrations.length - 1;
const result = spawnSync(
  "supabase",
  ["--yes", "migration", "down", "--local", "--last", String(last)],
  { stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
