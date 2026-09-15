import { TODAY_RANK_STEP } from "../../../../shared/todayRpcContract";
import type { TodayTodo } from "../../types/domain";
import { compareSqlDates, isSqlDate, parseSqlDate } from "./dateDomain";

export type TodayOrderableTodo = Pick<
  TodayTodo,
  "id" | "dueDate" | "dueTime" | "todayRank" | "createdAt"
>;

export type MoveDirection = "up" | "down";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/;
const RFC_3339_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?(Z|([+-])([01]\d|2[0-3]):([0-5]\d))$/;
const MICROSECONDS_PER_SECOND = 1_000_000n;

function compareNullableTime(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
}

function timestampToEpochMicroseconds(value: string): bigint {
  const match = RFC_3339_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    throw new RangeError("Today todos require valid RFC 3339 created-at timestamps.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fractionalMicroseconds = BigInt((match[7] ?? "").padEnd(6, "0") || "0");

  parseSqlDate(`${match[1]}-${match[2]}-${match[3]}`);

  const wallClock = new Date(0);
  wallClock.setUTCHours(0, 0, 0, 0);
  wallClock.setUTCFullYear(year, month - 1, day);
  wallClock.setUTCHours(hour, minute, second, 0);

  let offsetMinutes = 0;
  if (match[8] !== "Z") {
    const direction = match[9] === "+" ? 1 : -1;
    offsetMinutes = direction * (Number(match[10]) * 60 + Number(match[11]));
  }

  const epochSeconds = BigInt(wallClock.getTime() / 1000 - offsetMinutes * 60);
  return epochSeconds * MICROSECONDS_PER_SECOND + fractionalMicroseconds;
}

function compareTimestamp(left: string, right: string): number {
  const leftTime = timestampToEpochMicroseconds(left);
  const rightTime = timestampToEpochMicroseconds(right);

  if (leftTime < rightTime) return -1;
  if (leftTime > rightTime) return 1;
  return 0;
}

function assertTodayOrderableTodo(todo: TodayOrderableTodo): void {
  if (!todo.id || !isSqlDate(todo.dueDate)) {
    throw new RangeError("Today todos require valid IDs and due dates.");
  }
  if (todo.dueTime !== null && !LOCAL_TIME_PATTERN.test(todo.dueTime)) {
    throw new RangeError("Today todos require valid due times.");
  }
  if (todo.todayRank !== null && (!Number.isSafeInteger(todo.todayRank) || todo.todayRank <= 0)) {
    throw new RangeError("Today todos require valid manual ranks.");
  }
  timestampToEpochMicroseconds(todo.createdAt);
}

function compareId(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Mirrors the database Today order for optimistic UI and deterministic tests.
 * Existing manual ranks stay ahead of newly eligible, unranked todos.
 */
export function compareTodayTodos(left: TodayOrderableTodo, right: TodayOrderableTodo): number {
  assertTodayOrderableTodo(left);
  assertTodayOrderableTodo(right);

  const leftIsRanked = left.todayRank !== null;
  const rightIsRanked = right.todayRank !== null;
  if (leftIsRanked !== rightIsRanked) return leftIsRanked ? -1 : 1;

  if (left.todayRank !== null && right.todayRank !== null && left.todayRank !== right.todayRank) {
    return left.todayRank - right.todayRank;
  }

  const dueDateComparison = compareSqlDates(left.dueDate, right.dueDate);
  if (dueDateComparison !== 0) return dueDateComparison;

  const dueTimeComparison = compareNullableTime(left.dueTime, right.dueTime);
  if (dueTimeComparison !== 0) return dueTimeComparison;

  const createdAtComparison = compareTimestamp(left.createdAt, right.createdAt);
  if (createdAtComparison !== 0) return createdAtComparison;

  return compareId(left.id, right.id);
}

export function sortTodayTodos<T extends TodayOrderableTodo>(todos: readonly T[]): T[] {
  for (const todo of todos) assertTodayOrderableTodo(todo);
  return [...todos].sort(compareTodayTodos);
}

function assertSafeRankCount(count: number): void {
  // This is a numeric representation bound, not a product/list-size cap.
  // Checking the final rank also proves every preceding 1024-spaced rank is
  // exactly representable by the browser's number-based domain contract.
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(count * TODAY_RANK_STEP)) {
    throw new RangeError("Today order requires safe integer ranks.");
  }
}

function assertUniqueIds(ids: readonly string[]): void {
  // Helpers remain generic for in-memory callers; real UUID payloads must not
  // contain two spellings of the same PostgreSQL UUID. Preserve original keys.
  const identities = ids.map((id) => (UUID_PATTERN.test(id) ? id.toLowerCase() : id));
  if (new Set(identities).size !== ids.length) {
    throw new RangeError("Today cannot contain duplicate todo IDs.");
  }
}

/** Matches the rank spacing assigned by the reorder_today_todos RPC. */
export function assignTodayRanks(orderedTodoIds: readonly string[]): ReadonlyMap<string, number> {
  assertSafeRankCount(orderedTodoIds.length);
  assertUniqueIds(orderedTodoIds);

  return new Map(orderedTodoIds.map((todoId, index) => [todoId, (index + 1) * TODAY_RANK_STEP]));
}
