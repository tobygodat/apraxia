import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { Database } from "../../frontend/src/types/database";
import { createClassService } from "../../frontend/src/features/classes/classService";
const owner = "11111111-1111-4111-8111-111111111111";
const row = {
  user_id: owner,
  id: "math3012",
  name: "MATH3012",
  updated_at: "2026-09-13T00:00:00.123456+00:00",
};
const signal = () => new AbortController().signal;
function setup(responses: unknown[]) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  return {
    service: createClassService(
      createClient<Database>("https://classes.example.test", "test-key", {
        global: { fetch },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    ),
    fetch,
  };
}
it("paginates account classes and retains precise revisions", async () => {
  const { service, fetch } = setup([
    Array.from({ length: 200 }, (_, i) => ({ ...row, id: String(i) })),
    [row],
  ]);
  const rows = await service.list(owner, signal());
  expect(rows).toHaveLength(201);
  expect(rows[0]!.updatedAt).toBe(row.updated_at);
  for (const call of fetch.mock.calls as unknown as [string, RequestInit][])
    expect(new URL(call[0]).searchParams.get("user_id")).toBe(`eq.${owner}`);
  expect(
    new URL(String((fetch.mock.calls[1] as unknown as [string])[0])).searchParams.get("id"),
  ).toBe("gt.199");
});
it("renames using the exact loaded revision and refuses to overwrite a conflict", async () => {
  const { service, fetch } = setup([null, { ...row, name: "Changed elsewhere" }]);
  await expect(
    service.rename(
      owner,
      { id: row.id, name: row.name, updatedAt: row.updated_at },
      "New name",
      signal(),
    ),
  ).rejects.toThrow("changed elsewhere");
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url).searchParams.get("updated_at")).toBe(`eq.${row.updated_at}`);
  expect(JSON.parse(String(init.body))).toEqual({ name: "New name" });
});
it("uses conflict-safe creates and confirms stored data", async () => {
  const { service, fetch } = setup([null, row]);
  expect((await service.create(owner, { id: row.id, name: row.name }, signal())).id).toBe(row.id);
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(new Headers(init.headers).get("prefer")).toContain("resolution=ignore-duplicates");
});
