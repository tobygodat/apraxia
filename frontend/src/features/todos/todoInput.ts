import type { NewTodoInput, TodoRecurrence } from "../../types/domain";
import { isSqlDate } from "./dateDomain";
import { isRecurrenceFreq, MAX_RECURRENCE_INTERVAL } from "./todoRecurrence";
import { ServiceError } from "../../lib/serviceError";

export interface TodoInputValues {
  text: string;
  dueDate?: string | null;
  dueTime?: string | null;
  projectId?: string | null;
  classId?: string | null;
  assignmentType?: string;
  /** Empty means "does not repeat"; the other two are then ignored. */
  recurrenceFreq?: string | null;
  recurrenceInterval?: string | null;
  recurrenceUntil?: string | null;
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

const KNOWN_FIELDS: readonly TodoInputField[] = [
  "text",
  "dueDate",
  "dueTime",
  "projectId",
  "classId",
  "assignmentType",
  "recurrenceFreq",
  "recurrenceInterval",
  "recurrenceUntil",
];
const INTERVAL_PATTERN = /^\d{1,2}$/;
const ASSIGNMENT_TYPES = ["", "Homework", "Quiz", "Reading", "Exam", "Other"];

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

  const rawClassId = optionalFormValue(values.classId);
  let classId: string | null = null;
  if (
    rawClassId === INVALID ||
    (rawClassId !== null && (rawClassId.trim().length === 0 || rawClassId.length > 120))
  ) {
    issues.push({ code: "invalid_format", path: ["classId"], message: "Choose a valid class." });
  } else {
    classId = rawClassId?.trim() ?? null;
  }

  const rawAssignmentType = values.assignmentType ?? "";
  let assignmentType = "";
  if (typeof rawAssignmentType !== "string" || !ASSIGNMENT_TYPES.includes(rawAssignmentType)) {
    issues.push({
      code: "invalid_format",
      path: ["assignmentType"],
      message: "Choose an assignment type from the list.",
    });
  } else {
    assignmentType = rawAssignmentType;
  }

  if (projectId !== null && classId !== null) {
    issues.push({
      code: "custom",
      path: ["classId"],
      message: "Choose a project or a class, not both.",
    });
  }
  if (assignmentType !== "" && classId === null) {
    issues.push({
      code: "custom",
      path: ["assignmentType"],
      message: "Choose a class before an assignment type.",
    });
  }

  const rawFreq = optionalFormValue(values.recurrenceFreq);
  let recurrence: TodoRecurrence | null = null;
  if (rawFreq === INVALID || (rawFreq !== null && !isRecurrenceFreq(rawFreq))) {
    issues.push({
      code: "invalid_format",
      path: ["recurrenceFreq"],
      message: "Choose how often this task repeats.",
    });
  } else if (rawFreq !== null) {
    const rawInterval = optionalFormValue(values.recurrenceInterval);
    // An unset control means "every one", which is what the menu already says.
    const interval = rawInterval === INVALID || rawInterval === null ? 1 : Number(rawInterval);
    if (
      rawInterval === INVALID ||
      (rawInterval !== null &&
        (!INTERVAL_PATTERN.test(rawInterval) || interval < 1 || interval > MAX_RECURRENCE_INTERVAL))
    ) {
      issues.push({
        code: "invalid_format",
        path: ["recurrenceInterval"],
        message: `Repeat every 1 to ${MAX_RECURRENCE_INTERVAL} periods.`,
      });
    }

    const rawUntil = optionalFormValue(values.recurrenceUntil);
    let until: string | null = null;
    if (rawUntil === INVALID || (rawUntil !== null && !isSqlDate(rawUntil))) {
      issues.push({
        code: "invalid_format",
        path: ["recurrenceUntil"],
        message: "Enter a valid date in YYYY-MM-DD format.",
      });
    } else if (rawUntil !== null && dueDate !== null && rawUntil < dueDate) {
      issues.push({
        code: "custom",
        path: ["recurrenceUntil"],
        message: "End the repeat on or after the due date.",
      });
    } else {
      until = rawUntil;
    }

    if (dueDate === null) {
      issues.push({
        code: "custom",
        path: ["recurrenceFreq"],
        message: "Add a due date before setting a repeat.",
      });
    }

    recurrence = { freq: rawFreq, interval, until };
  }

  if (dueTimeValid && dueTime !== null && dueDate === null) {
    issues.push({
      code: "custom",
      path: ["dueTime"],
      message: "Add a due date before adding a due time.",
    });
  }

  if (issues.length > 0) return { success: false, error: { issues } };

  // Class fields are emitted only for a class task, so ordinary creates stay unchanged.
  const base = { text, projectId, ...(classId !== null ? { classId, assignmentType } : {}) };
  // Like the class fields, a repeat is emitted only when one is set, so an
  // ordinary create carries exactly the fields it did before.
  return {
    success: true,
    data:
      dueDate === null
        ? { ...base, dueDate: null, dueTime: null }
        : { ...base, dueDate, dueTime, ...(recurrence !== null && { recurrence }) },
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

    if (KNOWN_FIELDS.includes(field as TodoInputField)) {
      (fieldErrors[field as TodoInputField] ??= []).push(issue.message);
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
