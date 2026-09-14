import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../../types/database";
import type { Todo } from "../../types/domain";
import { asSqlDate } from "./dateDomain";
import { collectTodaySnapshot, TodaySnapshotChangedError, verifyTodayReorderReceipt } from "./todayRpcProtocol";
import type { TodoRequestOptions, TodoService } from "./todoService";
import { isDeleteUndoToken, readTodoResponse, readTodoWorkspaceSnapshot } from "./todoWorkspaceValidation";

const PAGE_SIZE = 200;
const TODO_FIELDS = "id,text,completed,completed_at,due_date,due_time,project_id,class_id,assignment_type,classes(name),today_rank,created_at,updated_at";
type TodoRow = Pick<Tables<"todos">,
  "id" | "text" | "completed" | "completed_at" | "due_date" | "due_time" |
  "project_id" | "class_id" | "assignment_type" | "today_rank" | "created_at" | "updated_at"> & { classes?: { name: string | null } | null };

function failed(): never { throw new Error("Couldn’t load or save your todos. Try again."); }

function requestSignal(options: TodoRequestOptions): AbortSignal {
  options.signal.throwIfAborted();
  return AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]);
}

function result<T>(response: { data: T | null; error: unknown }, options: TodoRequestOptions): T {
  options.signal.throwIfAborted();
  if (response.error || response.data === null) failed();
  return response.data;
}

function mapTodo(row: TodoRow): Todo {
  const todo = readTodoResponse({
    id: row.id, text: row.text, completed: row.completed, completedAt: row.completed_at,
    dueDate: row.due_date, dueTime: row.due_time, projectId: row.project_id,
    classId: row.class_id, className: row.classes?.name ?? null, assignmentType: row.assignment_type,
    todayRank: row.today_rank, createdAt: row.created_at, updatedAt: row.updated_at,
  });
  return todo ?? failed();
}

/** Keyset pages avoid the Data API row cap and offset skips after deletions. */
async function collectRows<T extends { id: string }>(
  fetchPage: (afterId: string | null) => PromiseLike<{
    data: T[] | null; error: unknown; count: number | null;
  }>,
  options: TodoRequestOptions,
): Promise<T[]> {
  const rows: T[] = [];
  let afterId: string | null = null;
  for (;;) {
    options.signal.throwIfAborted();
    const response = await fetchPage(afterId);
    const page = result(response, options);
    if (response.count === null || page.length !== Math.min(PAGE_SIZE, response.count)) failed();
    for (const row of page) {
      if (typeof row.id !== "string" || (afterId !== null && row.id <= afterId)) failed();
      rows.push(row);
      afterId = row.id;
    }
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** Ordinary CRUD uses the browser JWT and RLS. Ownership is never an input. */
export function createSupabaseTodoService(client: SupabaseClient<Database>): TodoService {
  return {
    async loadWorkspace(options) {
      const signal = requestSignal(options);
      const [profileResponse, projects, todos, classes] = await Promise.all([
        client.from("profiles").select("user_id,timezone,created_at,updated_at").abortSignal(signal).single(),
        collectRows((afterId) => {
          const query = client.from("projects").select("id,title", { count: "exact" })
            .is("deleted_at", null).order("id").limit(PAGE_SIZE).abortSignal(signal);
          return afterId === null ? query : query.gt("id", afterId);
        }, options),
        collectRows((afterId) => {
          const query = client.from("todos").select(TODO_FIELDS, { count: "exact" })
            .is("deleted_at", null).order("id").limit(PAGE_SIZE).abortSignal(signal);
          if (options.classId !== undefined) query.eq("class_id", options.classId);
          return afterId === null ? query : query.gt("id", afterId);
        }, options),
        collectRows((afterId) => {
          const query = client.from("classes").select("id,name", { count: "exact" })
            .order("id").limit(PAGE_SIZE).abortSignal(signal);
          return afterId === null ? query : query.gt("id", afterId);
        }, options),
      ]);
      const profile = result(profileResponse, options);
      return readTodoWorkspaceSnapshot({
        profile: { userId: profile.user_id, timezone: profile.timezone,
          createdAt: profile.created_at, updatedAt: profile.updated_at },
        projects, classes, todos: todos.map(mapTodo),
      }) ?? failed();
    },
    async createTodo(input, options) {
      const values = {
        ...(input.id !== undefined && { id: input.id }),
        text: input.text, due_date: input.dueDate ?? null,
        due_time: input.dueTime ?? null, project_id: input.projectId ?? null,
        class_id: input.classId ?? null, assignment_type: input.assignmentType ?? "",
      };
      if (input.id !== undefined) {
        const write = await client.from("todos").upsert(values, { onConflict: "id", ignoreDuplicates: true })
          .abortSignal(requestSignal(options));
        if (write.error) failed();
        const query = client.from("todos").select(TODO_FIELDS).eq("id", input.id).is("deleted_at", null);
        if (options.classId !== undefined) query.eq("class_id", options.classId);
        return mapTodo(result(await query.abortSignal(requestSignal(options)).single(), options));
      }
      const response = await client.from("todos").insert(values).select(TODO_FIELDS)
        .abortSignal(requestSignal(options)).single();
      return mapTodo(result(response, options));
    },
    async updateTodoDetails(id, input, options) {
      const update: Database["public"]["Tables"]["todos"]["Update"] = {};
      if (input.assignmentType !== undefined) update.assignment_type = input.assignmentType;
      if (input.text !== undefined) update.text = input.text;
      if (input.classId !== undefined) update.class_id = input.classId;
      if (input.projectId !== undefined) update.project_id = input.projectId;
      if (input.dueDate !== undefined) update.due_date = input.dueDate;
      if (input.dueTime !== undefined) update.due_time = input.dueTime;
      if (input.dueDate === null) update.due_time = null;
      if (Object.keys(update).length === 0) failed();
      const query = client.from("todos").update(update).eq("id", id).is("deleted_at", null);
      if (options.classId !== undefined) query.eq("class_id", options.classId);
      const response = await query.select(TODO_FIELDS).abortSignal(requestSignal(options)).single();
      return mapTodo(result(response, options));
    },
    async setTodoCompleted(id, completed, options) {
      // The database trigger owns completed_at and resets stale Today ranks.
      const query = client.from("todos").update({ completed }).eq("id", id).is("deleted_at", null);
      if (options.classId !== undefined) query.eq("class_id", options.classId);
      const response = await query.select(TODO_FIELDS).abortSignal(requestSignal(options)).single();
      return mapTodo(result(response, options));
    },
    async softDeleteTodo(id, options) {
      const response = await client.rpc("soft_delete_record", {
        p_record_type: "todo", p_record_id: id,
      }).abortSignal(requestSignal(options));
      const token = result(response, options);
      if (!isDeleteUndoToken(token)) failed();
      return token;
    },
    async restoreTodo(id, token, options) {
      if (!isDeleteUndoToken(token)) failed();
      const response = await client.rpc("restore_record", {
        p_record_type: "todo", p_record_id: id, p_deleted_at: token,
      }).abortSignal(requestSignal(options));
      const restored = result(response, options);
      if (typeof restored !== "boolean") failed();
      return restored;
    },
    loadToday(localDate, options) {
      return collectTodaySnapshot(async (page, pageOptions) => {
        const response = await client.rpc("get_today_todos_page", {
          p_local_date: page.p_local_date, p_offset: page.p_offset, p_limit: page.p_limit,
          // Omission uses SQL's null default; generated optional args exclude null.
          ...(page.p_snapshot_token === null ? {} : { p_snapshot_token: page.p_snapshot_token }),
        }).abortSignal(requestSignal(pageOptions));
        pageOptions.signal.throwIfAborted();
        if (response.error?.code === "40001") throw new TodaySnapshotChangedError();
        return result(response, pageOptions);
      }, localDate, options);
    },
    async reorderToday(localDate, ids, options) {
      const response = await client.rpc("reorder_today_todos", {
        p_local_date: asSqlDate(localDate), p_todo_ids: [...ids],
      }).abortSignal(requestSignal(options));
      return verifyTodayReorderReceipt(result(response, options), localDate, ids, options);
    },
  };
}
