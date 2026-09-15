import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { Database } from "../../frontend/src/types/database";
import { createAssignmentService } from "../../frontend/src/features/classes/assignmentService";
const owner = "11111111-1111-4111-8111-111111111111";
const id = "33333333-3333-4333-8333-333333333333";
const now = "2026-09-14T12:00:00.123456Z";
const row = {
  id,
  text: "Worksheet",
  class_id: "math3012",
  classes: { name: "Math" },
  assignment_type: "Homework",
  due_date: "2020-03-08",
  due_time: null,
  completed: false,
  completed_at: null,
  project_id: null,
  today_rank: null,
  created_at: now,
  updated_at: now,
};
const profile = { user_id: owner, timezone: "America/New_York", created_at: now, updated_at: now };
const isProfileBody = (value: unknown) =>
  !!value && !Array.isArray(value) && typeof value === "object" && "user_id" in value;
function setup(responses: unknown[]) {
  const fetch = vi.fn(async (url: RequestInfo | URL) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/classes"))
      return new Response(JSON.stringify([{ id: "math3012", name: "Math" }]), {
        headers: { "Content-Type": "application/json", "Content-Range": "0-0/1" },
      });
    // Workspace reads run in parallel; serve the profile body to the profile request.
    const isProfile = pathname.endsWith("/profiles");
    const index = responses.findIndex((value) => isProfile === isProfileBody(value));
    const body = responses.splice(index < 0 ? 0 : index, 1)[0];
    const count = Array.isArray(body) ? body.length : 1;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Range": `0-${Math.max(count - 1, 0)}/${count}`,
      },
    });
  });
  const client = createClient<Database>("https://assignments.example.test", "public-test-key", {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { service: createAssignmentService(client), fetch };
}
const signal = () => new AbortController().signal;
const request = (fetch: ReturnType<typeof setup>["fetch"], index = 0) =>
  fetch.mock.calls[index] as unknown as [string, RequestInit];
it("paginates todo assignments with a class filter and active-row scope", async () => {
  const { service, fetch } = setup([
    profile,
    [],
    Array.from({ length: 200 }, (_, i) => ({
      ...row,
      id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
    })),
    [{ ...row, id: "33333333-3333-4333-8333-000000000200" }],
  ]);
  expect(await service.list(owner, "math3012", signal())).toHaveLength(201);
  const todoRequests = fetch.mock.calls
    .map(([url]) => new URL(String(url)))
    .filter((url) => url.pathname === "/rest/v1/todos");
  expect(todoRequests).toHaveLength(2);
  for (const url of todoRequests) {
    expect(url.searchParams.get("class_id")).toBe("eq.math3012");
    expect(url.searchParams.get("deleted_at")).toBe("is.null");
  }
  expect(todoRequests[1]!.searchParams.get("id")).toBe("gt.33333333-3333-4333-8333-000000000199");
});
it("sends only edited fields and preserves original date-only dates", async () => {
  const { service, fetch } = setup([{ ...row, text: "Renamed" }]);
  expect(
    await service.update(owner, "math3012", id, { title: " Renamed " }, signal()),
  ).toMatchObject({ id, title: "Renamed", due: "2020-03-08", dueTime: "", done: false });
  expect(JSON.parse(String(request(fetch)[1].body))).toEqual({ text: "Renamed" });
  expect(new URL(request(fetch)[0]).searchParams.get("class_id")).toBe("eq.math3012");
});
it("retains the draft UUID on retry without overwriting a stored assignment", async () => {
  const { service, fetch } = setup([null, row]);
  await service.create(
    owner,
    "math3012",
    { id, title: "Worksheet", due: "2020-03-08", type: "Homework", done: false },
    signal(),
  );
  expect(new Headers(request(fetch)[1].headers).get("prefer")).toContain(
    "resolution=ignore-duplicates",
  );
  expect(JSON.parse(String(request(fetch)[1].body))).toMatchObject({
    id,
    class_id: "math3012",
    due_date: "2020-03-08",
    due_time: null,
    assignment_type: "Homework",
  });
});
it("uses the todo completion path and atomically clears time with date", async () => {
  const { service, fetch } = setup([
    { ...row, completed: true, completed_at: now },
    { ...row, due_date: null },
  ]);
  await service.update(owner, "math3012", id, { done: true }, signal());
  await service.update(owner, "math3012", id, { due: "" }, signal());
  expect(JSON.parse(String(request(fetch)[1].body))).toEqual({ completed: true });
  expect(JSON.parse(String(request(fetch, 1)[1].body))).toEqual({
    due_date: null,
    due_time: null,
  });
});
it("soft deletes through the existing RPC and preserves the exact Undo token", async () => {
  const { service, fetch } = setup([profile, [], [row], now, true]);
  const token = await service.remove(owner, "math3012", id, signal());
  expect(token).toBe(now);
  expect(await service.restore(owner, "math3012", id, token, signal())).toBe(true);
  const restore = fetch.mock.calls.findIndex(([url]) => String(url).endsWith("/restore_record"));
  expect(JSON.parse(String(request(fetch, restore)[1].body))).toEqual({
    p_record_type: "todo",
    p_record_id: id,
    p_deleted_at: now,
  });
});
it("rejects wrong account snapshots, invalid dates, types, and time without date", async () => {
  const { service } = setup([
    { ...profile, user_id: "22222222-2222-4222-8222-222222222222" },
    [],
    [row],
  ]);
  await expect(service.list(owner, "math3012", signal())).rejects.toThrow();
  await expect(
    service.update(owner, "math3012", id, { due: "2026-02-30" }, signal()),
  ).rejects.toThrow("valid date");
  await expect(
    service.update(owner, "math3012", id, { type: "Unknown" }, signal()),
  ).rejects.toThrow("assignment type");
  await expect(
    service.update(owner, "math3012", id, { dueTime: "15:00" }, signal()),
  ).rejects.toThrow("date for the time");
});
