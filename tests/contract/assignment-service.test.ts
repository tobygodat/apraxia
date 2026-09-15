import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { Database } from "../../frontend/src/types/database";
import { createAssignmentService } from "../../frontend/src/features/classes/assignmentService";
const owner = "11111111-1111-4111-8111-111111111111";
const id = "33333333-3333-4333-8333-333333333333";
const row = {
  id,
  user_id: owner,
  course_id: "math3012",
  title: "Worksheet",
  assignment_type: "Homework",
  due_date: "2020-03-08",
  completed: false,
};
function setup(responses: unknown[]) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  const client = createClient<Database>("https://assignments.example.test", "public-test-key", {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { service: createAssignmentService(client), fetch };
}
const signal = () => new AbortController().signal;
it("paginates all assignments and scopes every page to the signed-in account and class", async () => {
  const { service, fetch } = setup([
    Array.from({ length: 200 }, (_, i) => ({ ...row, id: String(i) })),
    [{ ...row, id: "last" }],
  ]);
  const items = await service.list(owner, "math3012", signal());
  expect(items).toHaveLength(201);
  for (const call of fetch.mock.calls as unknown as [string, RequestInit][]) {
    const url = new URL(call[0]);
    expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
    expect(url.searchParams.get("course_id")).toBe("eq.math3012");
  }
  expect(
    new URL(String((fetch.mock.calls[1] as unknown as [string])[0])).searchParams.get("id"),
  ).toBe("gt.199");
});
it("sends only changed fields and preserves date-only strings", async () => {
  const { service, fetch } = setup([{ ...row, title: "Renamed" }]);
  expect(await service.update(owner, "math3012", id, { title: " Renamed " }, signal())).toEqual({
    id,
    title: "Renamed",
    type: "Homework",
    due: "2020-03-08",
    done: false,
  });
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toEqual({ title: "Renamed" });
});
it("uses the draft UUID for conflict-safe retries and confirms the stored row", async () => {
  const { service, fetch } = setup([null, row]);
  await service.create(
    owner,
    "math3012",
    { id, title: "Worksheet", due: "2020-03-08", type: "Homework", done: false },
    signal(),
  );
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(new Headers(init.headers).get("prefer")).toContain("resolution=ignore-duplicates");
  expect(JSON.parse(String(init.body))).toMatchObject({
    id,
    user_id: owner,
    course_id: "math3012",
    due_date: "2020-03-08",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("rejects unexpected owners, malformed dates, and unsupported types", async () => {
  const { service, fetch } = setup([[{ ...row, user_id: "another-user" }]]);
  await expect(service.list(owner, "math3012", signal())).rejects.toThrow();
  await expect(
    service.update(owner, "math3012", id, { due: "2026-02-30" }, signal()),
  ).rejects.toThrow("valid date");
  await expect(
    service.update(owner, "math3012", id, { type: "Unknown" }, signal()),
  ).rejects.toThrow("assignment type");
  expect(fetch).toHaveBeenCalledTimes(1);
});
