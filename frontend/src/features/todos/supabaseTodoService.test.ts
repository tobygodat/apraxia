import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../types/database";
import type { NewTodoInput, DeleteUndoToken } from "../../types/domain";
import { createSupabaseTodoService } from "./supabaseTodoService";

const id = "11111111-1111-4111-8111-111111111111";
const row = { id, text: "Test task", completed: false, completed_at: null,
  due_date: "2026-09-04", due_time: "09:30:00.123456", project_id: null,
  today_rank: null, created_at: "2026-09-04T12:00:00.123456Z", updated_at: "2026-09-04T12:00:00.123456Z" };
const options = () => ({ signal: new AbortController().signal });
function setup(responses: Response[]) {
  const fetch = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected HTTP request.");
    return response;
  });
  const client = createClient<Database>("http://127.0.0.1:54321", "test-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return { service: createSupabaseTodoService(client), fetch };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

describe("Supabase Todo boundary", () => {
  it("projects only permitted create fields and retains date/time precision", async () => {
    const { service, fetch } = setup([json(row)]);
    const todo = await service.createTodo({ text: row.text, dueDate: row.due_date,
      dueTime: row.due_time, user_id: "spoof", completed: true, today_rank: 99 } as NewTodoInput, options());
    expect(todo.dueTime).toBe(row.due_time);
    const request = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request[1].body))).toEqual({ text: row.text,
      due_date: row.due_date, due_time: row.due_time, project_id: null, class_id: null, assignment_type: "" });
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
      json({ local_date: "2026-09-04", offset: 0, total_count: 0, snapshot_token: "a".repeat(64), items: [] }),
    ]);
    expect(await service.loadToday("2026-09-04", options())).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const denied = setup([json({ code: "42501", message: "private provider detail" }, 403)]);
    await expect(denied.service.loadToday("2026-09-04", options())).rejects.toThrow("Couldn’t load or save");
    expect(denied.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch a cancelled write or retry a rejected reorder", async () => {
    const { service, fetch } = setup([]);
    const controller = new AbortController();
    controller.abort();
    await expect(service.createTodo({ text: "Cancelled" }, { signal: controller.signal })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    const rejected = setup([json({ code: "40001", message: "changed" }, 400)]);
    await expect(rejected.service.reorderToday("2026-09-04", [id], options())).rejects.toThrow();
    expect(rejected.fetch).toHaveBeenCalledTimes(1);
  });
});
