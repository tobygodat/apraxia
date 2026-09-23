import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("Supabase Data API boundary", () => {
  it("exposes only public application schemas and disables automatic grants", async () => {
    const config = await readFile(path.join(repositoryRoot, "supabase", "config.toml"), "utf8");
    const exposedSchemas = config.match(/^schemas\s*=\s*\[(.*)]$/m)?.[1] ?? "";

    expect(exposedSchemas).toContain('"public"');
    expect(exposedSchemas).toContain('"graphql_public"');
    expect(exposedSchemas).not.toContain('"private"');
    expect(exposedSchemas).not.toContain('"internal"');
    expect(config).toMatch(/^auto_expose_new_tables\s*=\s*false$/m);
  });

  it("keeps local Auth redirects on the local Vercel origin", async () => {
    const config = await readFile(path.join(repositoryRoot, "supabase", "config.toml"), "utf8");

    expect(config).toMatch(/^site_url\s*=\s*"http:\/\/127\.0\.0\.1:3000"$/m);
    expect(config).toContain('"http://127.0.0.1:3000/**"');
    expect(config).toContain('"http://localhost:3000/**"');
  });
});

describe("migration security contract", () => {
  it("keeps browser-callable RPCs invoker-only and free of user_id arguments", async () => {
    const migrationsDirectory = path.join(repositoryRoot, "supabase", "migrations");
    const migrationNames = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const sql = (
      await Promise.all(
        migrationNames.map((name) => readFile(path.join(migrationsDirectory, name), "utf8")),
      )
    ).join("\n");
    const publicRpcNames = [
      "get_today_todos_page",
      "reorder_today_todos",
      "soft_delete_record",
      "restore_record",
      "search_records",
      "import_career_prep_items",
    ];

    for (const name of publicRpcNames) {
      const functionPattern = new RegExp(
        `create function public\\.${name}\\s*\\(([^)]*)\\)([\\s\\S]*?)\\$\\$;`,
        "gi",
      );
      const definition = [...sql.matchAll(functionPattern)].at(-1);

      expect(definition, `Missing public.${name}`).not.toBeNull();
      expect(definition?.[1] ?? "").not.toMatch(/\buser_id\b/i);
      expect(definition?.[2] ?? "").toMatch(/security\s+invoker/i);
      expect(definition?.[2] ?? "").not.toMatch(/security\s+definer/i);
      expect(definition?.[2] ?? "").toMatch(/set\s+search_path\s*=\s*''/i);
    }

    expect(sql).toMatch(/create schema if not exists private/i);
    expect(sql).toMatch(/create schema if not exists internal/i);
    expect(sql).toMatch(/alter table public\.todos enable row level security/i);
    // Browser roles never hard-delete a soft-deleted record type. Rows that are
    // not soft-deleted carry their own owner-scoped DELETE policies instead:
    // classes, and non-action children hanging off a career application. Career prep now follows its canonical todo's soft delete. The
    // legacy class_assignments backup is read-only, and career_applications is
    // deliberately absent: it goes through soft_delete_record like every other
    // record.
    const browserDeleteGrants = [
      ...sql.matchAll(
        /grant\s+([^;]*?\bdelete\b[^;]*?)\s+on\s+(public\.[a-z_]+)\s+to\s+([^;]+);/gi,
      ),
    ]
      .filter((grant) => /\bauthenticated\b/i.test(grant[3] ?? ""))
      .map((grant) => grant[2]);

    expect(new Set(browserDeleteGrants)).toEqual(
      new Set([
        // Historical grants remain visible in migration text; the canonical
        // prep migration explicitly revokes this one and pgTAP checks the
        // effective privilege after all migrations.
        "public.career_prep",
        "public.career_questions",
        "public.career_resources",
        "public.career_steps",
        "public.career_stories",
        "public.career_story_uses",
        // Historical too: class_notes was dropped with the class PDF feature.
        "public.class_notes",
        "public.classes",
      ]),
    );
    expect(browserDeleteGrants).not.toContain("public.career_applications");
  });

  it("keeps the helper role compatible with managed Supabase postgres", async () => {
    const migration = await readFile(
      path.join(
        repositoryRoot,
        "supabase",
        "migrations",
        "20260902000100_initial_cloud_schema.sql",
      ),
      "utf8",
    );
    const unconditionalAlter = migration.match(/alter\s+role\s+orbitos_rpc([\s\S]*?);/i)?.[1];

    expect(unconditionalAlter).toBeDefined();
    expect(unconditionalAlter).not.toMatch(
      /\b(?:no)?(?:superuser|createdb|createrole|replication|bypassrls)\b/i,
    );
    expect(migration).toMatch(/orbitos_rpc has unsafe role attributes/i);
  });
});
