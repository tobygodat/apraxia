import type {
  ClassSummary,
  DeleteUndoToken,
  Profile,
  ProjectSummary,
  Todo,
} from "../../types/domain";
import { isSqlDate } from "./dateDomain";
import type { TodoWorkspaceSnapshot, UpdateTodoDetailsInput } from "./todoService";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,6}))?)?$/;
const ASSIGNMENT_TYPES = ["", "Homework", "Quiz", "Reading", "Exam", "Other"];
const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && UUID_PATTERN.test(value);
}

function isNonemptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = TIMESTAMP_PATTERN.exec(value);
  return match !== null && match[0] === value && isSqlDate(match[1]);
}

function isLocalDate(value: unknown): value is string {
  return typeof value === "string" && value.length === 10 && isSqlDate(value);
}

function isTimezone(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(value)
  ) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Canonical comparison form only; persisted time strings are not rewritten. */
export function canonicalLocalTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = LOCAL_TIME_PATTERN.exec(value);
  if (!match || match[0] !== value) return null;
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}.${(match[4] ?? "").padEnd(6, "0")}`;
}

/** Validate precision and syntax without parsing or rounding the exact token. */
export function isDeleteUndoToken(value: unknown): value is DeleteUndoToken {
  return isTimestamp(value);
}

function readProfile(value: unknown): Profile | null {
  if (
    !isRecord(value) ||
    !isUuid(value.userId) ||
    !isTimezone(value.timezone) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt)
  ) {
    return null;
  }
  return {
    userId: value.userId,
    timezone: value.timezone,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function readProjectSummary(value: unknown): ProjectSummary | null {
  if (!isRecord(value) || !isUuid(value.id) || !isNonemptyText(value.title)) {
    return null;
  }
  return { id: value.id, title: value.title };
}

/** Project the complete browser domain shape; unknown provider fields stay out. */
export function readTodoResponse(value: unknown): Todo | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isNonemptyText(value.text) ||
    typeof value.completed !== "boolean" ||
    (value.completed ? !isTimestamp(value.completedAt) : value.completedAt !== null) ||
    (value.dueDate !== null && !isLocalDate(value.dueDate)) ||
    (value.dueTime !== null && canonicalLocalTime(value.dueTime) === null) ||
    (value.dueDate === null && value.dueTime !== null) ||
    (value.projectId !== null && !isUuid(value.projectId)) ||
    (value.classId != null && (!isNonemptyText(value.classId) || value.projectId !== null)) ||
    (value.className != null && typeof value.className !== "string") ||
    (value.assignmentType !== undefined &&
      (!ASSIGNMENT_TYPES.includes(value.assignmentType as string) ||
        (value.assignmentType !== "" && value.classId == null))) ||
    (value.todayRank !== null &&
      (typeof value.todayRank !== "number" ||
        !Number.isSafeInteger(value.todayRank) ||
        value.todayRank <= 0)) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt)
  ) {
    return null;
  }
  return {
    id: value.id,
    text: value.text,
    completed: value.completed,
    completedAt: value.completedAt as string | null,
    dueDate: value.dueDate as string | null,
    dueTime: value.dueTime as string | null,
    projectId: value.projectId as string | null,
    ...(value.classId !== undefined && { classId: value.classId as string | null }),
    ...(value.className !== undefined && { className: value.className as string | null }),
    ...(value.assignmentType !== undefined && {
      assignmentType: value.assignmentType as string,
    }),
    todayRank: value.todayRank as number | null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function readClassSummary(value: unknown): ClassSummary | null {
  if (
    !isRecord(value) ||
    !isNonemptyText(value.id) ||
    (value.name !== null && typeof value.name !== "string")
  ) {
    return null;
  }
  return { id: value.id, name: value.name };
}

export function readTodoWorkspaceSnapshot(value: unknown): TodoWorkspaceSnapshot | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.classes) ||
    !Array.isArray(value.todos)
  ) {
    return null;
  }
  // Class IDs are case-sensitive text, unlike the UUID collections below.
  const classes = Array.from(value.classes, readClassSummary);
  if (
    classes.some((course) => course === null) ||
    new Set(classes.map((course) => course!.id)).size !== classes.length
  ) {
    return null;
  }
  const profile = readProfile(value.profile);
  const projects = Array.from(value.projects, readProjectSummary);
  const todos = Array.from(value.todos, readTodoResponse);
  if (
    !profile ||
    projects.some((project) => project === null) ||
    todos.some((todo) => todo === null)
  ) {
    return null;
  }

  const validProjects = projects as ProjectSummary[];
  const validTodos = todos as Todo[];
  if (
    new Set(validProjects.map((project) => project.id.toLowerCase())).size !==
      validProjects.length ||
    new Set(validTodos.map((todo) => todo.id.toLowerCase())).size !== validTodos.length
  ) {
    return null;
  }
  return {
    profile,
    projects: validProjects,
    classes: classes as ClassSummary[],
    todos: validTodos,
  };
}

export function todoMatchesDetails(todo: Todo, input: UpdateTodoDetailsInput): boolean {
  return (
    (input.text === undefined || todo.text === input.text) &&
    (input.classId === undefined || (todo.classId ?? null) === input.classId) &&
    (input.assignmentType === undefined || (todo.assignmentType ?? "") === input.assignmentType) &&
    (input.projectId === undefined || todo.projectId === input.projectId) &&
    (input.dueDate === undefined || todo.dueDate === input.dueDate) &&
    (input.dueTime === undefined ||
      (input.dueTime === null
        ? todo.dueTime === null
        : todo.dueTime !== null &&
          canonicalLocalTime(todo.dueTime) !== null &&
          canonicalLocalTime(todo.dueTime) === canonicalLocalTime(input.dueTime)))
  );
}
