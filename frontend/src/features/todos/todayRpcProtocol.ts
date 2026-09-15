import {
  TODAY_PAGE_SIZE,
  TODAY_RANK_STEP,
  TODAY_SNAPSHOT_RESTARTS,
  type TodayPageEnvelope,
  type TodayPageRequest,
} from "../../../../shared/todayRpcContract";
import type { LocalDate, TodayTodo, UUID } from "../../types/domain";
import { asSqlDate, compareSqlDates } from "./dateDomain";
import { assignTodayRanks, compareTodayTodos } from "./todayOrder";
import type { TodayRankUpdate, TodoRequestOptions } from "./todoService";
import { readTodoResponse } from "./todoWorkspaceValidation";
import { ServiceError } from "../../lib/serviceError";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The concrete generated-type adapter maps only SQLSTATE 40001 to this error. */
export class TodaySnapshotChangedError extends ServiceError {
  constructor() {
    super("conflict", "Today changed while loading. Try again.");
    this.name = "TodaySnapshotChangedError";
  }
}

export type FetchTodayPage = (
  request: TodayPageRequest,
  options: TodoRequestOptions,
) => Promise<unknown>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new ServiceError(
    "unavailable",
    "Today returned an incomplete or invalid response. Try again.",
  );
}

function checkActive(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Request cancelled.", "AbortError");
}

/** Cancellation settles even when a provider ignores its signal. */
function awaitActive<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(new DOMException("Request cancelled.", "AbortError"));
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
    promise.then(
      (result) => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted) cancel();
        else resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", cancel);
        reject(error);
      },
    );
  });
}

function readEnvelope(response: unknown, request: TodayPageRequest): TodayPageEnvelope {
  if (
    !record(response) ||
    response.local_date !== request.p_local_date ||
    response.offset !== request.p_offset ||
    typeof response.total_count !== "number" ||
    !Number.isSafeInteger(response.total_count) ||
    response.total_count < request.p_offset ||
    typeof response.snapshot_token !== "string" ||
    !HASH_PATTERN.test(response.snapshot_token) ||
    !Array.isArray(response.items) ||
    response.items.length !== Math.min(request.p_limit, response.total_count - request.p_offset)
  ) {
    invalidResponse();
  }
  return {
    local_date: request.p_local_date,
    offset: request.p_offset,
    total_count: response.total_count as number,
    snapshot_token: response.snapshot_token as string,
    items: response.items as unknown[],
  };
}

function readWireTodo(value: unknown, localDate: LocalDate): TodayTodo {
  if (!record(value)) invalidResponse();
  const todo = readTodoResponse({
    id: value.id,
    text: value.text,
    completed: false,
    completedAt: null,
    dueDate: value.due_date,
    dueTime: value.due_time,
    projectId: value.project_id,
    todayRank: value.today_rank,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  });
  if (
    !todo ||
    todo.dueDate === null ||
    compareSqlDates(todo.dueDate, localDate) > 0 ||
    value.is_overdue !== compareSqlDates(todo.dueDate, localDate) < 0 ||
    value.is_manually_ordered !== (todo.todayRank !== null) ||
    (value.project_title !== null && typeof value.project_title !== "string")
  ) {
    invalidResponse();
  }
  return {
    ...todo,
    completed: false,
    completedAt: null,
    dueDate: todo.dueDate,
    isOverdue: value.is_overdue as boolean,
    isManuallyOrdered: value.is_manually_ordered as boolean,
    projectTitle: todo.projectId === null ? null : (value.project_title as string | null),
  };
}

/**
 * Drain bounded pages, publishing only a complete consistent Today snapshot.
 * This is provider-neutral protocol logic, not an untyped Supabase client.
 * A generated-type adapter must make exactly one RPC per callback invocation.
 */
export async function collectTodaySnapshot(
  fetchPage: FetchTodayPage,
  localDate: LocalDate,
  options: TodoRequestOptions,
): Promise<readonly TodayTodo[]> {
  const date = asSqlDate(localDate);
  for (let attempt = 0; attempt <= TODAY_SNAPSHOT_RESTARTS; attempt += 1) {
    const todos: TodayTodo[] = [];
    const ids = new Set<string>();
    let token: string | null = null;
    let total: number | null = null;
    try {
      for (;;) {
        checkActive(options.signal);
        const request: TodayPageRequest = {
          p_local_date: date,
          p_offset: todos.length,
          p_limit: TODAY_PAGE_SIZE,
          p_snapshot_token: token,
        };
        const response = await awaitActive(fetchPage(request, options), options.signal);
        checkActive(options.signal);
        const page = readEnvelope(response, request);
        if (
          (token !== null && page.snapshot_token !== token) ||
          (total !== null && page.total_count !== total)
        ) {
          throw new TodaySnapshotChangedError();
        }
        token = page.snapshot_token;
        total = page.total_count;
        for (const candidate of page.items) {
          const todo = readWireTodo(candidate, date);
          const id = todo.id.toLowerCase();
          if (
            ids.has(id) ||
            (todos.length > 0 && compareTodayTodos(todos[todos.length - 1]!, todo) > 0)
          ) {
            invalidResponse();
          }
          ids.add(id);
          todos.push(todo);
        }
        if (todos.length === total) return todos;
      }
    } catch (error) {
      checkActive(options.signal);
      if (error instanceof TodaySnapshotChangedError && attempt < TODAY_SNAPSHOT_RESTARTS) continue;
      throw error;
    }
  }
  throw new TodaySnapshotChangedError();
}

/** Validate the single write receipt; never replay a reorder to fetch its result. */
export async function verifyTodayReorderReceipt(
  response: unknown,
  localDate: LocalDate,
  orderedTodoIds: readonly UUID[],
  options: TodoRequestOptions,
): Promise<readonly TodayRankUpdate[]> {
  const date = asSqlDate(localDate);
  checkActive(options.signal);
  const ids = Array.from(orderedTodoIds);
  if (
    ids.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id)) ||
    new Set(ids.map((id) => id.toLowerCase())).size !== ids.length ||
    !record(response) ||
    response.local_date !== date ||
    response.applied_count !== ids.length ||
    response.rank_step !== TODAY_RANK_STEP ||
    typeof response.order_fingerprint !== "string" ||
    !HASH_PATTERN.test(response.order_fingerprint)
  ) {
    invalidResponse();
  }
  const canonicalIds = ids.map((id) => id.toLowerCase());
  const digest = await awaitActive(
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalIds.join(","))),
    options.signal,
  );
  checkActive(options.signal);
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (response.order_fingerprint !== fingerprint) invalidResponse();
  const ranks = assignTodayRanks(ids);
  return ids.map((todoId) => ({ todoId, todayRank: ranks.get(todoId)! }));
}
