import type { NewTodoInput } from "../../types/domain";
import { isSqlDate } from "./dateDomain";
import { ServiceError } from "../../lib/serviceError";

export interface TodoInputValues {
  text: string;
  dueDate?: string | null;
  dueTime?: string | null;
  projectId?: string | null;
}

export type TodoInputField = keyof TodoInputValues;

interface TodoInputIssue {
  /** Stable machine code; mirrors the previous schema codes. */
  code: "invalid_type" | "too_small" | "invalid_format" | "custom" | "unrecognized_keys";
  path: (string | number)[];
  message: string;
  keys?: string[];
}

interface TodoInputError {
  issues: TodoInputIssue[];
}

export interface TodoInputErrors {
  fieldErrors: Partial<Record<TodoInputField, string[]>>;
  formErrors: string[];
}

export type TodoInputParseResult =
  { success: true; data: NewTodoInput } | { success: false; error: TodoInputError };

export type TodoInputValidationResult =
  | {
      success: true;
      data: NewTodoInput;
    }
  | ({
      success: false;
      /** The exact values supplied by the form, retained for correction/retry. */
      values: TodoInputValues;
      error: TodoInputError;
    } & TodoInputErrors);

const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

const KNOWN_FIELDS: readonly TodoInputField[] = ["text", "dueDate", "dueTime", "projectId"];

const INVALID = Symbol("invalid");

/** Empty strings from unset form controls mean "no value", not an invalid one. */
function optionalFormValue(value: unknown): string | null | typeof INVALID {
  if (value === "" || value === null || value === undefined) return null;
  return typeof value === "string" ? value : INVALID;
}

function parseTodoInput(input: unknown): TodoInputParseResult {
  const issues: TodoInputIssue[] = [];
  const values = (input ?? {}) as Record<string, unknown>;

  const unknownKeys = Object.keys(values).filter(
    (key) => !KNOWN_FIELDS.includes(key as TodoInputField),
  );
  if (unknownKeys.length > 0) {
    issues.push({
      code: "unrecognized_keys",
      keys: unknownKeys,
      path: [],
      message: `Unrecognized key${unknownKeys.length > 1 ? "s" : ""}: ${unknownKeys
        .map((key) => `"${key}"`)
        .join(", ")}`,
    });
  }

  const rawText = values.text;
  let text = "";
  if (typeof rawText !== "string") {
    issues.push({ code: "invalid_type", path: ["text"], message: "Enter a task." });
  } else {
    text = rawText.trim();
    if (text.length === 0) {
      issues.push({ code: "too_small", path: ["text"], message: "Enter a task." });
    }
  }

  const rawDueDate = optionalFormValue(values.dueDate);
  let dueDate: string | null = null;
  if (rawDueDate === INVALID || (rawDueDate !== null && !isSqlDate(rawDueDate))) {
    issues.push({
      code: "invalid_format",
      path: ["dueDate"],
      message: "Enter a valid date in YYYY-MM-DD format.",
    });
  } else {
    dueDate = rawDueDate;
  }

  const rawDueTime = optionalFormValue(values.dueTime);
  let dueTime: string | null = null;
  let dueTimeValid = true;
  if (rawDueTime === INVALID || (rawDueTime !== null && !LOCAL_TIME_PATTERN.test(rawDueTime))) {
    dueTimeValid = false;
    issues.push({
      code: "invalid_format",
      path: ["dueTime"],
      message: "Enter a valid time in HH:MM or HH:MM:SS format.",
    });
  } else {
    dueTime = rawDueTime;
  }

  const rawProjectId = optionalFormValue(values.projectId);
  let projectId: string | null = null;
  if (rawProjectId === INVALID || (rawProjectId !== null && !UUID_PATTERN.test(rawProjectId))) {
    issues.push({
      code: "invalid_format",
      path: ["projectId"],
      message: "Choose a valid project.",
    });
  } else {
    projectId = rawProjectId;
  }

  if (dueTimeValid && dueTime !== null && dueDate === null) {
    issues.push({
      code: "custom",
      path: ["dueTime"],
      message: "Add a due date before adding a due time.",
    });
  }

  if (issues.length > 0) return { success: false, error: { issues } };

  const base = { text, projectId };
  return {
    success: true,
    data:
      dueDate === null ? { ...base, dueDate: null, dueTime: null } : { ...base, dueDate, dueTime },
  };
}

/**
 * Validates raw compact-Todo form values and emits only browser-safe create
 * fields. Local dates and times deliberately remain strings throughout.
 */
export const todoInputSchema = {
  safeParse: parseTodoInput,
  parse(input: unknown): NewTodoInput {
    const result = parseTodoInput(input);
    if (!result.success) {
      throw new ServiceError(
        "invalid_input",
        result.error.issues[0]?.message ?? "Invalid task input.",
      );
    }
    return result.data;
  },
};

function collectErrors(error: TodoInputError): TodoInputErrors {
  const fieldErrors: TodoInputErrors["fieldErrors"] = {};
  const formErrors: string[] = [];

  for (const issue of error.issues) {
    const field = issue.path[0];

    if (field === "text" || field === "dueDate" || field === "dueTime" || field === "projectId") {
      (fieldErrors[field] ??= []).push(issue.message);
    } else {
      formErrors.push(issue.message);
    }
  }

  return { fieldErrors, formErrors };
}

export function validateTodoInput(values: TodoInputValues): TodoInputValidationResult {
  const result = todoInputSchema.safeParse(values);

  if (result.success) {
    return result;
  }

  return {
    success: false,
    values,
    error: result.error,
    ...collectErrors(result.error),
  };
}
