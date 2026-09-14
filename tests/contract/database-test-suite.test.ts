import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const databaseTestsDirectory = path.join(
  process.cwd(),
  "supabase",
  "tests",
);

describe("pgTAP database suite", () => {
  it("keeps the disposable-local rewind count aligned with committed migrations", async () => {
    const migrations = (await readdir(path.join(process.cwd(), "supabase", "migrations")))
      .filter((name) => name.endsWith(".sql"));
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["db:rewind:verify"]).toBe(
      `supabase --yes migration down --local --last ${migrations.length - 1} && supabase migration up --local && npm run db:test`,
    );
  });

  it("keeps every planned assertion inside a rollback-only transaction", async () => {
    const testNames = (await readdir(databaseTestsDirectory))
      .filter((name) => name.endsWith(".test.sql"))
      .sort();

    expect(testNames).toEqual([
      "000_security_contract.test.sql",
      "010_rls_isolation.test.sql",
      "020_today_reorder.test.sql",
      "030_soft_delete_restore.test.sql",
      "040_search.test.sql",
      "050_todo_schedule_bounds.test.sql",
      "060_today_pagination.test.sql",
      "070_calendar_oauth_transactions.test.sql",
      "080_calendar_service.test.sql",
      "090_home_appearance.test.sql",
      "100_class_assignments.test.sql",
      "110_classes_notes.test.sql",
      "120_assignment_todos.test.sql",
    ]);

    for (const name of testNames) {
      const sql = await readFile(path.join(databaseTestsDirectory, name), "utf8");
      const planned = Number(sql.match(/select\s+plan\((\d+)\)/i)?.[1]);
      const assertions = sql.match(
        /select\s+(?:ok|is|isnt|lives_ok|throws_ok|bag_eq|set_eq|results_eq)\s*\(/gi,
      );

      expect(planned, `${name} must declare a plan`).toBeGreaterThan(0);
      expect(assertions?.length ?? 0, `${name} plan must match`).toBe(planned);
      expect(sql.trimStart().toLowerCase()).toMatch(/^begin\s*;/);
      expect(sql).toMatch(/select\s+\*\s+from\s+finish\(\)\s*;/i);
      expect(sql.trimEnd().toLowerCase()).toMatch(/rollback\s*;$/);
    }
  });
});
