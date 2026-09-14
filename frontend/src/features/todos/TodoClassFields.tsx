import type { RefObject } from "react";
import type { ClassSummary } from "../../types/domain";
import type { TodoInputErrors, TodoInputField, TodoInputValues } from "./todoInput";

export function TodoClassFields({ baseId, classes, values, disabled, onChange, classRef, typeRef, errors }: {
  baseId: string; classes: readonly ClassSummary[]; values: TodoInputValues; disabled: boolean;
  onChange(field: TodoInputField, value: string): void;
  classRef: RefObject<HTMLSelectElement>; typeRef: RefObject<HTMLSelectElement>; errors: TodoInputErrors;
}) {
  const missing = values.classId && !classes.some(course => course.id === values.classId);
  return <div className="todo-dialog__details">
    <div className="todo-dialog__field">
      <label htmlFor={`${baseId}-class`}>Class</label>
      <select id={`${baseId}-class`} ref={classRef} disabled={disabled} value={values.classId ?? ""}
        aria-invalid={Boolean(errors.fieldErrors.classId)} aria-describedby={errors.fieldErrors.classId ? `${baseId}-classId-error` : undefined}
        onChange={event => onChange("classId", event.target.value)}>
        <option value="">No class</option>
        {missing && <option value={values.classId ?? ""} disabled>Current class (unavailable)</option>}
        {classes.map(course => <option key={course.id} value={course.id}>{course.name ?? course.id}</option>)}
      </select>
      {errors.fieldErrors.classId && <p className="todo-dialog__field-error" id={`${baseId}-classId-error`}>{errors.fieldErrors.classId[0]}</p>}
    </div>
    {values.classId && <div className="todo-dialog__field">
      <label htmlFor={`${baseId}-assignment-type`}>Assignment type</label>
      <select id={`${baseId}-assignment-type`} ref={typeRef} disabled={disabled} value={values.assignmentType ?? ""}
        aria-invalid={Boolean(errors.fieldErrors.assignmentType)} aria-describedby={errors.fieldErrors.assignmentType ? `${baseId}-assignmentType-error` : undefined}
        onChange={event => onChange("assignmentType", event.target.value)}>
        <option value="">No type</option>
        {["Homework", "Quiz", "Reading", "Exam", "Other"].map(type => <option key={type}>{type}</option>)}
      </select>
      {errors.fieldErrors.assignmentType && <p className="todo-dialog__field-error" id={`${baseId}-assignmentType-error`}>{errors.fieldErrors.assignmentType[0]}</p>}
    </div>}
  </div>;
}
