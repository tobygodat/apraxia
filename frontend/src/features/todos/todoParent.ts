import type { TodoInputField, TodoInputValues } from "./todoInput";

export function changeTodoField(
  current: TodoInputValues,
  field: TodoInputField,
  value: string,
): TodoInputValues {
  return {
    ...current,
    [field]: value,
    ...(field === "projectId" && value ? { classId: "", assignmentType: "" } : {}),
    ...(field === "classId" ? (value ? { projectId: "" } : { assignmentType: "" }) : {}),
  };
}
