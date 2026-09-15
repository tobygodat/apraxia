import { describe, expect, expectTypeOf, it } from "vitest";

import type { NewTodoInput } from "../../types/domain";
import { todoInputSchema, validateTodoInput, type TodoInputValues } from "./todoInput";

describe("todoInputSchema", () => {
  it("trims task text and preserves valid local date/time strings", () => {
    const result = todoInputSchema.safeParse({
      text: "  Renew passport  ",
      dueDate: "2028-02-29",
      dueTime: "09:05:07",
      projectId: "87d45aa9-0012-4fea-8ee5-e394cb159bf7",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toEqual({
      text: "Renew passport",
      dueDate: "2028-02-29",
      dueTime: "09:05:07",
      projectId: "87d45aa9-0012-4fea-8ee5-e394cb159bf7",
    });
    expect(typeof result.data.dueDate).toBe("string");
    expect(typeof result.data.dueTime).toBe("string");
    expectTypeOf(result.data).toMatchTypeOf<NewTodoInput>();
  });

  it("accepts minute-precision times and normalizes empty optional controls", () => {
    expect(
      todoInputSchema.parse({
        text: "Call the dentist",
        dueDate: "2026-09-03",
        dueTime: "14:30",
      }),
    ).toEqual({
      text: "Call the dentist",
      dueDate: "2026-09-03",
      dueTime: "14:30",
      projectId: null,
    });

    expect(
      todoInputSchema.parse({
        text: "Inbox item",
        dueDate: "",
        dueTime: "",
        projectId: "",
      }),
    ).toEqual({
      text: "Inbox item",
      dueDate: null,
      dueTime: null,
      projectId: null,
    });
  });

  it("rejects blank task text and retains the exact form values", () => {
    const values: TodoInputValues = {
      text: "   ",
      dueDate: "2026-09-03",
      dueTime: "08:00",
      projectId: null,
    };
    const result = validateTodoInput(values);

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.values).toBe(values);
    expect(result.values.text).toBe("   ");
    expect(result.fieldErrors.text).toEqual(["Enter a task."]);
  });

  it.each([
    "2026-2-03",
    "2026-02-3",
    "2026-02-29",
    "2028-02-30",
    "2026-04-31",
    "2026-13-01",
    "0000-01-01",
    "2026-09-03T00:00:00Z",
  ])("rejects invalid SQL local date %s", (dueDate) => {
    const result = validateTodoInput({ text: "Task", dueDate });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.fieldErrors.dueDate).toEqual(["Enter a valid date in YYYY-MM-DD format."]);
  });

  it.each(["9:30", "24:00", "12:60", "12:30:60", "12:30:00.5"])(
    "rejects invalid local time %s",
    (dueTime) => {
      const result = validateTodoInput({
        text: "Task",
        dueDate: "2026-09-03",
        dueTime,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.fieldErrors.dueTime).toEqual([
        "Enter a valid time in HH:MM or HH:MM:SS format.",
      ]);
    },
  );

  it("rejects a due time without a due date", () => {
    const result = validateTodoInput({
      text: "Task",
      dueDate: "",
      dueTime: "08:15",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.fieldErrors.dueTime).toEqual(["Add a due date before adding a due time."]);
  });

  it("rejects a malformed project id", () => {
    const result = validateTodoInput({
      text: "Task",
      projectId: "project-123",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.fieldErrors.projectId).toEqual(["Choose a valid project."]);
  });

  it("rejects ownership and lifecycle fields instead of silently stripping them", () => {
    const result = todoInputSchema.safeParse({
      text: "Task",
      userId: "87d45aa9-0012-4fea-8ee5-e394cb159bf7",
      completed: true,
      source: "migration",
      deletedAt: "2026-09-03T12:00:00Z",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unrecognized_keys" })]),
    );
  });
});

it("rejects two parents and assignment types without a class", () => {
  expect(
    validateTodoInput({
      text: "Task",
      projectId: "87d45aa9-0012-4fea-8ee5-e394cb159bf7",
      classId: "math",
    }).success,
  ).toBe(false);
  expect(validateTodoInput({ text: "Task", assignmentType: "Quiz" }).success).toBe(false);
  expect(
    validateTodoInput({ text: "Task", classId: "math", assignmentType: "Unknown" }).success,
  ).toBe(false);
  expect(
    todoInputSchema.parse({
      text: "Quiz",
      classId: "math",
      assignmentType: "Quiz",
      dueDate: "2020-03-08",
    }),
  ).toEqual({
    text: "Quiz",
    projectId: null,
    classId: "math",
    assignmentType: "Quiz",
    dueDate: "2020-03-08",
    dueTime: null,
  });
});
