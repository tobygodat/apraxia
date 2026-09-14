import { changeTodoField } from "./todoParent";
import { TodoClassFields } from "./TodoClassFields";
import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { ClassSummary, ProjectSummary, Todo } from "../../types/domain";
import {
  type TodoInputErrors,
  type TodoInputField,
  type TodoInputValues,
  validateTodoInput,
} from "./todoInput";
import type { UpdateTodoDetailsInput } from "./todoService";
import "./TodoEditDialog.css";

export interface TodoEditDialogProps {
  readonly todo: Todo | null;
  readonly mode?: "edit" | "reschedule";
  readonly projects: readonly ProjectSummary[];
  readonly classes?: readonly ClassSummary[];
  readonly onSave: (
    todoId: string,
    input: UpdateTodoDetailsInput,
    options: { readonly signal: AbortSignal },
  ) => Promise<void>;
  readonly onClose: () => void;
  /** Used when saving moves the original invoking control out of the view. */
  readonly fallbackFocusRef?: RefObject<HTMLElement | null>;
}

const EMPTY_ERRORS: TodoInputErrors = { fieldErrors: {}, formErrors: [] };
const PRECISE_TIME_PATTERN = /^((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)\.\d{1,6}$/;
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function valuesForTodo(todo: Todo | null): TodoInputValues {
  return {
    text: todo?.text ?? "",
    dueDate: todo?.dueDate ?? "",
    // Native time controls cannot reliably represent SQL microseconds. The
    // exact value is retained separately until the user edits this field.
    dueTime: todo?.dueTime?.replace(PRECISE_TIME_PATTERN, "$1") ?? "",
    projectId: todo?.projectId ?? "",
    classId: todo?.classId ?? "",
    assignmentType: todo?.assignmentType ?? "",
  };
}

function isDocumentFocus(element: Element | null): boolean {
  return element === null || element === document.body || element === document.documentElement;
}

/** The edit state inherits the compact Todo form's existing visual system. */
export function TodoEditDialog({
  todo,
  mode = "edit",
  projects,
  classes = [],
  onSave,
  onClose,
  fallbackFocusRef,
}: TodoEditDialogProps) {
  const baseId = useId();
  const todoId = todo?.id ?? null;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const submitErrorId = `${baseId}-submit-error`;
  const saveStatusId = `${baseId}-save-status`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const classRef = useRef<HTMLSelectElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const projectRef = useRef<HTMLSelectElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const submittingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const focusGenerationRef = useRef(0);
  const dialogOwnsFocusRef = useRef(false);
  const latestFallbackRef = useRef(fallbackFocusRef);
  latestFallbackRef.current = fallbackFocusRef;
  const [values, setValues] = useState<TodoInputValues>(() => valuesForTodo(todo));
  const [retainedDueTime, setRetainedDueTime] = useState(todo?.dueTime ?? null);
  const [errors, setErrors] = useState<TodoInputErrors>(EMPTY_ERRORS);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusAfterValidation, setFocusAfterValidation] = useState<TodoInputField | null>(null);

  useLayoutEffect(() => {
    if (todoId === null) return;

    const activeElement = document.activeElement;
    const previouslyFocused = activeElement instanceof HTMLElement && !isDocumentFocus(activeElement)
      ? activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    requestGenerationRef.current += 1;
    focusGenerationRef.current += 1;
    submittingRef.current = false;
    dialogOwnsFocusRef.current = true;
    setValues(valuesForTodo(todo));
    setRetainedDueTime(todo?.dueTime ?? null);
    setErrors(EMPTY_ERRORS);
    setSubmitError(null);
    setIsSubmitting(false);
    setFocusAfterValidation(mode === "reschedule" ? "dueDate" : "text");
    document.body.style.overflow = "hidden";

    const trackFocusOwnership = (event: FocusEvent) => {
      if (event.target === document.body || event.target === document.documentElement) return;
      dialogOwnsFocusRef.current = event.target instanceof Node &&
        Boolean(dialogRef.current?.contains(event.target));
    };
    document.addEventListener("focusin", trackFocusOwnership);

    return () => {
      const activeAtClose = document.activeElement;
      const mayReturnFocus = dialogOwnsFocusRef.current && (
        isDocumentFocus(activeAtClose) || Boolean(dialogRef.current?.contains(activeAtClose))
      );
      const focusGeneration = ++focusGenerationRef.current;
      requestGenerationRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      submittingRef.current = false;
      document.removeEventListener("focusin", trackFocusOwnership);
      document.body.style.overflow = previousOverflow;

      // Wait for the commit that may remove a rescheduled task's opener. A new
      // dialog or a newer focused control wins over this queued restoration.
      queueMicrotask(() => {
        if (!mayReturnFocus || focusGenerationRef.current !== focusGeneration) return;
        const activeNow = document.activeElement;
        if (!isDocumentFocus(activeNow) && activeNow !== previouslyFocused) return;
        const target = previouslyFocused?.isConnected
          ? previouslyFocused
          : latestFallbackRef.current?.current;
        if (target?.isConnected) target.focus();
      });
    };
    // A same-record refresh must not overwrite a draft already being edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoId, mode]);

  useLayoutEffect(() => {
    if (todoId === null || focusAfterValidation === null) return;
    // Opening another record may replace a disabled pending form. Focus only
    // after its enabled fields (or new validation descriptions) are committed.
    const refs: Record<TodoInputField, RefObject<HTMLElement>> = {
      text: textRef,
      dueDate: dateRef,
      dueTime: timeRef,
      projectId: projectRef,
      classId: classRef,
      assignmentType: typeRef,
    };
    refs[focusAfterValidation].current?.focus();
    setFocusAfterValidation(null);
  }, [errors, focusAfterValidation, todoId]);

  if (todoId === null) return null;

  function fieldError(field: TodoInputField): string | undefined {
    return errors.fieldErrors[field]?.[0];
  }

  function fieldErrorId(field: TodoInputField): string {
    return `${baseId}-${field}-error`;
  }

  function renderFieldError(field: TodoInputField) {
    const message = fieldError(field);
    return message ? (
      <p className="todo-dialog__field-error" id={fieldErrorId(field)}>{message}</p>
    ) : null;
  }

  function updateValue(field: TodoInputField, value: string) {
    if (submittingRef.current) return;
    if (field === "dueTime" || (field === "dueDate" && value === "")) {
      setRetainedDueTime(null);
    }
    setValues((current) => ({
      ...changeTodoField(current, field, value),
      ...(field === "dueDate" && value === "" ? { dueTime: "" } : {}),
    }));
    setErrors((current) => {
      const fieldErrors = { ...current.fieldErrors, [field]: undefined };
      if (field === "dueDate") fieldErrors.dueTime = undefined;
      return { ...current, fieldErrors };
    });
    setSubmitError(null);
  }

  function closeDialog() {
    if (submittingRef.current) return;
    requestGenerationRef.current += 1;
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || todoId === null) return;
    const validation = validateTodoInput(values);
    if (!validation.success) {
      setErrors({ fieldErrors: validation.fieldErrors, formErrors: validation.formErrors });
      setSubmitError(null);
      setFocusAfterValidation(
        (["text", "dueDate", "dueTime", "projectId", "classId", "assignmentType"] as const).find(
          (field) => validation.fieldErrors[field]?.length,
        ) ?? null,
      );
      return;
    }

    const dueDate = validation.data.dueDate ?? null;
    const details = mode === "reschedule" ? {} : {
      text: validation.data.text,
      projectId: validation.data.projectId ?? null,
      ...((todo?.classId || values.classId) ? { classId: validation.data.classId ?? null, assignmentType: validation.data.assignmentType ?? "" } : {}),
    };
    const input: UpdateTodoDetailsInput = dueDate === null
      ? { ...details, dueDate: null, dueTime: null }
      : { ...details, dueDate, dueTime: retainedDueTime ?? validation.data.dueTime ?? null };
    const requestGeneration = ++requestGenerationRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    submittingRef.current = true;
    // Enter may submit from an input that is about to become disabled. Keep a
    // focusable control inside the modal before locking the fields.
    saveButtonRef.current?.focus();
    setIsSubmitting(true);
    setErrors(EMPTY_ERRORS);
    setFocusAfterValidation(null);
    setSubmitError(null);

    try {
      await onSave(todoId, input, { signal: controller.signal });
      if (requestGeneration !== requestGenerationRef.current || controller.signal.aborted) return;
      abortControllerRef.current = null;
      submittingRef.current = false;
      setIsSubmitting(false);
      closeDialog();
    } catch {
      if (requestGeneration !== requestGenerationRef.current || controller.signal.aborted) return;
      abortControllerRef.current = null;
      submittingRef.current = false;
      setIsSubmitting(false);
      setSubmitError("We couldn’t save this task. Your details are still here—try again.");
    }
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => !element.hidden);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const missingCurrentProject = Boolean(values.projectId) &&
    !projects.some((project) => project.id === values.projectId);
  const preciseStoredTime = retainedDueTime !== null && PRECISE_TIME_PATTERN.test(retainedDueTime)
    ? retainedDueTime
    : null;

  return createPortal(
    <div className="todo-dialog-backdrop">
      <div
        aria-busy={isSubmitting}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="todo-dialog todo-edit-dialog"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="todo-dialog__header">
          <h2 id={titleId}>{mode === "reschedule" ? "Reschedule task" : "Edit task"}</h2>
          <p id={descriptionId}>{mode === "reschedule"
            ? "Change the schedule. Clear the date to move this task to Inbox."
            : "Task is required. The schedule, project, and class are optional."}</p>
        </header>
        <form className="todo-dialog__form" noValidate onSubmit={handleSubmit}>
          {mode === "reschedule" ? <p className="todo-edit-dialog__task">{values.text}</p> : <div className="todo-dialog__field">
            <label htmlFor={`${baseId}-text`}>Task</label>
            <input
              aria-describedby={fieldError("text") ? fieldErrorId("text") : undefined}
              aria-invalid={Boolean(fieldError("text"))}
              autoComplete="off"
              disabled={isSubmitting}
              id={`${baseId}-text`}
              onChange={(event) => updateValue("text", event.target.value)}
              ref={textRef}
              required
              type="text"
              value={values.text}
            />
            {renderFieldError("text")}
          </div>}
          <div className="todo-dialog__details">
            <div className="todo-dialog__field">
              <label htmlFor={`${baseId}-date`}>Due date</label>
              <input
                aria-describedby={fieldError("dueDate") ? fieldErrorId("dueDate") : undefined}
                aria-invalid={Boolean(fieldError("dueDate"))}
                disabled={isSubmitting}
                id={`${baseId}-date`}
                onChange={(event) => updateValue("dueDate", event.target.value)}
                ref={dateRef}
                type="date"
                value={values.dueDate ?? ""}
              />
              {renderFieldError("dueDate")}
            </div>
            <div className="todo-dialog__field">
              <label htmlFor={`${baseId}-time`}>Due time</label>
              <input
                aria-describedby={fieldError("dueTime") ? fieldErrorId("dueTime") : `${baseId}-time-hint`}
                aria-invalid={Boolean(fieldError("dueTime"))}
                disabled={isSubmitting}
                id={`${baseId}-time`}
                onChange={(event) => updateValue("dueTime", event.target.value)}
                ref={timeRef}
                step="1"
                type="time"
                value={values.dueTime ?? ""}
              />
              {fieldError("dueTime") ? renderFieldError("dueTime") : (
                <p className="todo-dialog__hint" id={`${baseId}-time-hint`}>
                  {preciseStoredTime
                    ? `Saved time: ${preciseStoredTime}. Kept exactly unless you change this field.`
                    : "Requires a due date."}
                </p>
              )}
            </div>
          </div>
          {mode === "edit" ? <div className="todo-dialog__field">
            <label htmlFor={`${baseId}-project`}>Project</label>
            <select
              aria-describedby={fieldError("projectId") ? fieldErrorId("projectId") : undefined}
              aria-invalid={Boolean(fieldError("projectId"))}
              disabled={isSubmitting}
              id={`${baseId}-project`}
              onChange={(event) => updateValue("projectId", event.target.value)}
              ref={projectRef}
              value={values.projectId ?? ""}
            >
              <option value="">No project</option>
              {missingCurrentProject ? (
                <option value={values.projectId ?? ""} disabled>Current project (unavailable)</option>
              ) : null}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
            {renderFieldError("projectId")}
          </div> : null}
          {mode === "edit" && <TodoClassFields baseId={baseId} classes={classes} values={values} disabled={isSubmitting} onChange={updateValue} classRef={classRef} typeRef={typeRef} errors={errors} />}
          {errors.formErrors.length > 0 ? (
            <p className="todo-dialog__submit-error" role="alert">Review the form and try again.</p>
          ) : null}
          {submitError ? (
            <p className="todo-dialog__submit-error" id={submitErrorId} role="alert">{submitError}</p>
          ) : null}
          <footer className="todo-dialog__actions">
            <button
              className="todo-dialog__button todo-dialog__button--quiet"
              disabled={isSubmitting}
              onClick={closeDialog}
              type="button"
            >
              Cancel
            </button>
            <button
              aria-disabled={isSubmitting}
              aria-describedby={isSubmitting ? saveStatusId : submitError ? submitErrorId : undefined}
              className="todo-dialog__button todo-dialog__button--primary"
              ref={saveButtonRef}
              type="submit"
            >
              {isSubmitting ? "Saving…" : "Save changes"}
            </button>
          </footer>
        </form>
      </div>
      <p className="todo-edit-dialog__status" id={saveStatusId} role="status" aria-live="polite">
        {isSubmitting ? "Saving this task. Please wait before closing the form." : ""}
      </p>
    </div>,
    document.body,
  );
}

export default TodoEditDialog;
