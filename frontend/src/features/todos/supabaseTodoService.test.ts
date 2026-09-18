import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../types/database";
import type { NewTodoInput, DeleteUndoToken } from "../../types/domain";
import { createSupabaseTodoService } from "./supabaseTodoService";

const id = "11111111-1111-4111-8111-111111111111";
const row = {
  id,
  text: "Test task",
  completed: false,
  completed_at: null,
  due_date: "2026-09-04",
  due_time: "09:30:00.123456",
  project_id: null,
  class_id: null,
  assignment_type: "",
  classes: null,
  today_rank: null,
  created_at: "2026-09-04T12:00:00.123456Z",
  updated_at: "2026-09-04T12:00:00.123456Z",
};
const options = () => ({ signal: new AbortController().signal });
function setup(responses: Response[]) {
  const fetch = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected HTTP request.");
    return response;
  });
  const client = createClient<Database>("http://127.0.0.1:54321", "test-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return { service: createSupabaseTodoService(client), fetch };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("Supabase Todo boundary", () => {
  it("projects only permitted create fields and retains date/time precision", async () => {
    const { service, fetch } = setup([json(row)]);
    const todo = await service.createTodo(
      {
        text: row.text,
        dueDate: row.due_date,
        dueTime: row.due_time,
        user_id: "spoof",
        completed: true,
        today_rank: 99,
      } as NewTodoInput,
      options(),
    );
    expect(todo.dueTime).toBe(row.due_time);
    const request = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request[1].body))).toEqual({
      text: row.text,
      due_date: row.due_date,
      due_time: row.due_time,
      project_id: null,
      class_id: null,
      assignment_type: "",
    });
  });

  it("names the occurrence a completion created, or the one it withdrew", async () => {
    const successor = {
      ...row,
      id: "22222222-2222-4222-8222-222222222222",
      due_date: "2026-09-11",
    };
    const done = { ...row, completed: true, completed_at: "2026-09-04T13:00:00.123456Z" };
    const spawn = setup([
      json({ ...done, recurrence_spawned_id: successor.id }),
      json([successor]),
    ]);
    expect(await spawn.service.setTodoCompleted(id, true, options())).toMatchObject({
      todo: { id, completed: true },
      spawned: { id: successor.id, dueDate: successor.due_date },
      withdrawn: null,
    });
    // The link is read back, never written; the update names completion alone.
    const write = spawn.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(write[1].body))).toEqual({ completed: true });
    const read = spawn.fetch.mock.calls[1] as unknown as [string];
    expect(new URL(String(read[0])).searchParams.get("id")).toBe(`eq.${successor.id}`);

    // A link whose occurrence is no longer active is one the undo withdrew.
    const undo = setup([json({ ...row, recurrence_spawned_id: successor.id }), json([])]);
    expect(await undo.service.setTodoCompleted(id, false, options())).toMatchObject({
      spawned: null,
      withdrawn: successor.id,
    });

    // An ordinary task carries no link and costs no second request.
    const plain = setup([json({ ...done, recurrence_spawned_id: null })]);
    expect(await plain.service.setTodoCompleted(id, true, options())).toMatchObject({
      spawned: null,
      withdrawn: null,
    });
    expect(plain.fetch).toHaveBeenCalledTimes(1);
  });

  it("passes an exact Undo token and preserves a false restore result", async () => {
    const token = "2026-09-04T12:00:00.123456+00:00" as DeleteUndoToken;
    const { service, fetch } = setup([json(token), json(false)]);
    expect(await service.softDeleteTodo(id, options())).toBe(token);
    expect(await service.restoreTodo(id, token, options())).toBe(false);
    const request = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request[1].body)).p_deleted_at).toBe(token);
  });

  it("restarts a changed Today snapshot only for SQLSTATE 40001", async () => {
    const { service, fetch } = setup([
      json({ code: "40001", message: "private provider detail" }, 400),
      json({
        local_date: "2026-09-04",
        offset: 0,
        total_count: 0,
        snapshot_token: "a".repeat(64),
        items: [],
      }),
    ]);
    expect(await service.loadToday("2026-09-04", options())).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const denied = setup([json({ code: "42501", message: "private provider detail" }, 403)]);
    await expect(denied.service.loadToday("2026-09-04", options())).rejects.toThrow(
      "Couldn’t load or save",
    );
    expect(denied.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch a cancelled write or retry a rejected reorder", async () => {
    const { service, fetch } = setup([]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.createTodo({ text: "Cancelled" }, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const rejected = setup([json({ code: "40001", message: "changed" }, 400)]);
    await expect(rejected.service.reorderToday("2026-09-04", [id], options())).rejects.toThrow();
    expect(rejected.fetch).toHaveBeenCalledTimes(1);
  });
});

it("loads paginated class summaries alongside todos and projects through the browser client", async () => {
  const classes = Array.from({ length: 200 }, (_, index) => ({
    id: `class-${String(index).padStart(3, "0")}`,
    name: `Class ${index}`,
  }));
  const fetch = vi.fn(async (url: RequestInfo | URL) => {
    const request = new URL(String(url));
    const table = request.pathname.split("/").pop();
    const body =
      table === "profiles"
        ? {
            user_id: id,
            timezone: "America/New_York",
            created_at: row.created_at,
            updated_at: row.updated_at,
          }
        : table === "classes"
          ? request.searchParams.has("id")
            ? [{ id: "class-200", name: null }]
            : classes
          : [];
    return new Response(JSON.stringify(body), {
      headers: {
        "Content-Type": "application/json",
        "Content-Range": `0-0/${Array.isArray(body) ? body.length : 1}`,
      },
    });
  });
  const client = createClient<Database>("https://example.invalid", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  const snapshot = await createSupabaseTodoService(client).loadWorkspace(options());
  expect(snapshot.classes).toHaveLength(201);
  expect(snapshot.classes[200]).toEqual({ id: "class-200", name: null });
  const classRequests = fetch.mock.calls
    .map(([url]) => new URL(String(url)))
    .filter((url) => url.pathname.endsWith("/classes"));
  expect(classRequests[1].searchParams.get("id")).toBe("gt.class-199");
  expect(classRequests[0].searchParams.get("select")).toBe("id,name");
});

it("sends class reassignment and clears the other parent in one update", async () => {
  const { service, fetch } = setup([
    json({ ...row, class_id: "math", assignment_type: "Quiz", project_id: null }),
  ]);
  await service.updateTodoDetails(
    id,
    { text: row.text, classId: "math", projectId: null, assignmentType: "Quiz" },
    options(),
  );
  const request = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(request[1].body))).toEqual({
    text: row.text,
    class_id: "math",
    project_id: null,
    assignment_type: "Quiz",
  });
});
