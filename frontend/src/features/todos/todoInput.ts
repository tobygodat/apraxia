import { z } from "zod";

import type { NewTodoInput } from "../../types/domain";
import { isSqlDate } from "./dateDomain";

export interface TodoInputValues {
  text: string;
  dueDate?: string | null;
  dueTime?: string | null;
  projectId?: string | null;
  classId?: string | null;
  assignmentType?: string;
}

export type TodoInputField = keyof TodoInputValues;

export interface TodoInputErrors {
  fieldErrors: Partial<Record<TodoInputField, string[]>>;
  formErrors: string[];
}

export type TodoInputValidationResult =
  | {
      success: true;
      data: NewTodoInput;
    }
  | ({
      success: false;
      /** The exact values supplied by the form, retained for correction/retry. */
      values: TodoInputValues;
      error: z.ZodError;
    } & TodoInputErrors);

const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

const localDateSchema = z
  .string()
  .refine(isSqlDate, "Enter a valid date in YYYY-MM-DD format.");

const localTimeSchema = z
  .string()
  .regex(
    LOCAL_TIME_PATTERN,
    "Enter a valid time in HH:MM or HH:MM:SS format.",
  );

function optionalFormValue<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) =>
      value === "" || value === null || value === undefined ? null : value,
    z.union([schema, z.null()]),
  );
}

/**
 * Validates raw compact-Todo form values and emits only browser-safe create
 * fields. Local dates and times deliberately remain strings throughout.
 */
export const todoInputSchema = z
  .object({
    text: z.string({ error: "Enter a task." }).trim().min(1, "Enter a task."),
    dueDate: optionalFormValue(localDateSchema),
    dueTime: optionalFormValue(localTimeSchema),
    classId: optionalFormValue(z.string().trim().min(1).max(120)),
    assignmentType: z.enum(["", "Homework", "Quiz", "Reading", "Exam", "Other"]).default(""),
    projectId: optionalFormValue(
      z.string().uuid("Choose a valid project."),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.projectId && value.classId) context.addIssue({ code: "custom", path: ["classId"], message: "Choose a project or a class, not both." });
    if (value.assignmentType && !value.classId) context.addIssue({ code: "custom", path: ["assignmentType"], message: "Choose a class before an assignment type." });
    if (value.dueTime !== null && value.dueDate === null) {
      context.addIssue({
        code: "custom",
        path: ["dueTime"],
        message: "Add a due date before adding a due time.",
      });
    }
  })
  .transform((value): NewTodoInput => {
    const base = {
      text: value.text,
      projectId: value.projectId,
      ...(value.classId ? { classId: value.classId, assignmentType: value.assignmentType } : {}),
    };

    return value.dueDate === null
      ? { ...base, dueDate: null, dueTime: null }
      : { ...base, dueDate: value.dueDate, dueTime: value.dueTime };
  });

function collectErrors(error: z.ZodError): TodoInputErrors {
  const fieldErrors: TodoInputErrors["fieldErrors"] = {};
  const formErrors: string[] = [];

  for (const issue of error.issues) {
    const field = issue.path[0];

    if (
      field === "text" ||
      field === "dueDate" ||
      field === "dueTime" ||
      field === "projectId" || field === "classId" || field === "assignmentType"
    ) {
      (fieldErrors[field] ??= []).push(issue.message);
    } else {
      formErrors.push(issue.message);
    }
  }

  return { fieldErrors, formErrors };
}

export function validateTodoInput(
  values: TodoInputValues,
): TodoInputValidationResult {
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
