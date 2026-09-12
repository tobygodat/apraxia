import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../../types/database";
import type { Todo } from "../../types/domain";
import { addSqlDateDays, asSqlDate, localToday, startOfWeekMonday, visibleTodoWeekDates } from "./dateDomain";
import { collectTodaySnapshot, TodaySnapshotChangedError, verifyTodayReorderReceipt } from "./todayRpcProtocol";
import type { TodoRequestOptions, TodoService } from "./todoService";
import { isDeleteUndoToken, readTodoResponse, readTodoWorkspaceSnapshot } from "./todoWorkspaceValidation";
import { draftId, expectedUpdatedAt } from "../../lib/writeIntent";

const PAGE_SIZE = 200;
const BOARD_PAGE_SIZE = 100;
const TODO_FIELDS = "id,text,completed,completed_at,due_date,due_time,project_id,today_rank,created_at,updated_at";
type TodoRow = Pick<Tables<"todos">,
  "id" | "text" | "completed" | "completed_at" | "due_date" | "due_time" |
  "project_id" | "today_rank" | "created_at" | "updated_at">;
type ProfileRow = Pick<Tables<"profiles">, "user_id" | "timezone" | "created_at" | "updated_at">;

export class TodoConflictError extends Error {
  readonly code = "todo_conflict";
  constructor(message = "This todo changed in another tab. Reload the latest version before saving.") { super(message); this.name = "TodoConflictError"; }
}
export class TodoUnavailableError extends Error {
  readonly code = "todo_unavailable";
  constructor(message = "Couldn’t load or save your todos. Try again.") { super(message); this.name = "TodoUnavailableError"; }
}
function failed(): never { throw new TodoUnavailableError("Couldn’t load or save your todos. Try again."); }

function requestSignal(options: TodoRequestOptions): AbortSignal {
  options.signal.throwIfAborted();
  return AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]);
}

function result<T>(response: { data: T | null; error: unknown }, options: TodoRequestOptions): T {
  options.signal.throwIfAborted();
  if (response.error || response.data === null) {
    const code = response.error && typeof response.error === "object" && "code" in response.error ? String(response.error.code) : "";
    if (code === "PGRST116" || code === "23505") throw new TodoConflictError();
    throw new TodoUnavailableError();
  }
  return response.data;
}

function mapTodo(row: TodoRow): Todo {
  const todo = readTodoResponse({
    id: row.id, text: row.text, completed: row.completed, completedAt: row.completed_at,
    dueDate: row.due_date, dueTime: row.due_time, projectId: row.project_id,
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
  async function reconcileCreate(id: string, options: TodoRequestOptions): Promise<Todo | null> {
    const response = await client.from("todos").select(TODO_FIELDS).eq("id", id).is("deleted_at", null)
      .abortSignal(requestSignal(options)).maybeSingle();
    if (response.error && response.error.code !== "PGRST116") return null;
    return response.data ? mapTodo(response.data) : null;
  }
  async function loadBoardRows(today: string, options: TodoRequestOptions): Promise<Todo[]> {
    const dates = visibleTodoWeekDates(startOfWeekMonday(today), today);
    const filters = [
      (q: any) => q.is("due_date", null),
      (q: any) => q.eq("completed", false).lte("due_date", today),
      ...dates.map((date) => (q: any) => q.eq("due_date", date)),
    ];
    const pages = await Promise.all(filters.map(async (apply) => {
      let query = client.from("todos").select(TODO_FIELDS).is("deleted_at", null)
        .order("created_at").order("id").limit(BOARD_PAGE_SIZE).abortSignal(requestSignal(options));
      query = apply(query);
      const response = await query;
      return result<TodoRow[]>(response, options).map(mapTodo);
    }));
    return Array.from(new Map(pages.flat().map(todo => [todo.id, todo])).values());
  }
  return {
    async loadWorkspace(options) {
      const signal = requestSignal(options);
      const profileResponse = await client.from("profiles").select("user_id,timezone,created_at,updated_at").abortSignal(signal).single();
      const profile = result<ProfileRow>(profileResponse, options);
      const today = localToday(profile.timezone);
      const [projectsResponse, todos] = await Promise.all([
        client.from("projects").select("id,title").is("deleted_at", null).order("title").order("id").limit(BOARD_PAGE_SIZE).abortSignal(signal),
        loadBoardRows(today, options),
      ]);
      const projects = result<Array<{ id: string; title: string }>>(projectsResponse, options);
      return readTodoWorkspaceSnapshot({
        profile: { userId: profile.user_id, timezone: profile.timezone,
          createdAt: profile.created_at, updatedAt: profile.updated_at },
        projects, todos,
      }) ?? failed();
    },
    async createTodo(input, options) {
      const id = draftId(input);
      if (id) {
        const existing = await reconcileCreate(id, options);
        if (existing) return existing;
      }
      try {
        const response = await client.from("todos").insert({
          ...(id ? { id } : {}), text: input.text, due_date: input.dueDate ?? null,
          due_time: input.dueTime ?? null, project_id: input.projectId ?? null,
        }).select(TODO_FIELDS).abortSignal(requestSignal(options)).single();
        return mapTodo(result(response, options));
      } catch (error) {
        if (id) {
          const existing = await reconcileCreate(id, options);
          if (existing) return existing;
        }
        throw error;
      }
    },
    async updateTodoDetails(id, input, options) {
      const update: Database["public"]["Tables"]["todos"]["Update"] = {};
      if (input.text !== undefined) update.text = input.text;
      if (input.projectId !== undefined) update.project_id = input.projectId;
      if (input.dueDate !== undefined) update.due_date = input.dueDate;
      if (input.dueTime !== undefined) update.due_time = input.dueTime;
      if (input.dueDate === null) update.due_time = null;
      if (Object.keys(update).length === 0) failed();
      let query = client.from("todos").update(update).eq("id", id).is("deleted_at", null);
      const version = options.expectedUpdatedAt ?? expectedUpdatedAt(input);
      if (version !== undefined) query = query.eq("updated_at", version);
      const response = await query.select(TODO_FIELDS).abortSignal(requestSignal(options)).maybeSingle();
      if (version !== undefined && !response.data && !response.error) throw new TodoConflictError();
      return mapTodo(result(response, options));
    },
    async setTodoCompleted(id, completed, options) {
      // The database trigger owns completed_at and resets stale Today ranks.
      const response = await client.from("todos").update({ completed }).eq("id", id)
        .is("deleted_at", null).select(TODO_FIELDS).abortSignal(requestSignal(options)).single();
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
