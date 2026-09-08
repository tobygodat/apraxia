import {
  type FormEvent,
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { NewTodoInput, ProjectSummary } from "../../types/domain";
import {
  type TodoInputErrors,
  type TodoInputField,
  type TodoInputValues,
  validateTodoInput,
} from "./todoInput";
import "./TodoComposerDialog.css";

export interface TodoComposerDialogProps {
  open: boolean;
  initialDueDate?: string | null;
  initialProjectId?: string | null;
  projects: readonly ProjectSummary[];
  onCreate: (
    input: NewTodoInput,
    /**
     * The signal only abandons client work if the dialog is removed by its
     * owner. It is not a promise that an already-started database write rolled
     * back, so the dialog prevents user dismissal while creation is pending.
     */
    options: { readonly signal: AbortSignal },
  ) => Promise<void>;
  onClose: () => void;
}

const EMPTY_ERRORS: TodoInputErrors = {
  fieldErrors: {},
  formErrors: [],
};

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function fieldErrorId(baseId: string, field: TodoInputField) {
  return `${baseId}-${field}-error`;
}

export function TodoComposerDialog({
  open,
  initialDueDate = null,
  initialProjectId = null,
  projects,
  onCreate,
  onClose,
}: TodoComposerDialogProps) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const submitErrorId = `${baseId}-submit-error`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLSelectElement>(null);
  const submittingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const [values, setValues] = useState<TodoInputValues>({
    text: "",
    dueDate: initialDueDate ?? "",
    dueTime: "",
    projectId: initialProjectId ?? "",
  });
  const [errors, setErrors] = useState<TodoInputErrors>(EMPTY_ERRORS);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusAfterValidation, setFocusAfterValidation] =
    useState<TodoInputField | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      requestGenerationRef.current += 1;
      submittingRef.current = false;
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;

    requestGenerationRef.current += 1;
    submittingRef.current = false;
    setIsSubmitting(false);
    setValues({
      text: "",
      dueDate: initialDueDate ?? "",
      dueTime: "",
      projectId: initialProjectId ?? "",
    });
    setErrors(EMPTY_ERRORS);
    setSubmitError(null);
    setFocusAfterValidation(null);
    document.body.style.overflow = "hidden";
    textRef.current?.focus();

    return () => {
      // An abandoned provider may still resolve after abort. Invalidate its
      // continuation before aborting so unmount cannot later call onClose.
      requestGenerationRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      submittingRef.current = false;
      document.body.style.overflow = previousOverflow;

      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
    // An updated initial date applies the next time the dialog opens; it should
    // never overwrite work already in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open || focusAfterValidation === null) {
      return;
    }

    // Wait until React has committed the error element and aria-describedby
    // relationship before moving focus, so assistive technology receives the
    // field and its new validation message together.
    focusField(focusAfterValidation);
    setFocusAfterValidation(null);
  }, [errors, focusAfterValidation, open]);

  if (!open) {
    return null;
  }

  function clearFieldErrors(fields: readonly TodoInputField[]) {
    if (!fields.some((field) => errors.fieldErrors[field])) {
      return;
    }

    setErrors((current) => {
      const fieldErrors = { ...current.fieldErrors };
      for (const field of fields) {
        fieldErrors[field] = undefined;
      }

      return { ...current, fieldErrors };
    });
  }

  function updateValue(field: TodoInputField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    // dueTime's cross-field error becomes stale as soon as dueDate changes.
    clearFieldErrors(field === "dueDate" ? [field, "dueTime"] : [field]);
    setSubmitError(null);
  }

  function closeDialog() {
    if (submittingRef.current) {
      return;
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    requestGenerationRef.current += 1;
    submittingRef.current = false;
    setIsSubmitting(false);
    onClose();
  }

  function focusField(field: TodoInputField) {
    const refs: Record<TodoInputField, React.RefObject<HTMLElement>> = {
      text: textRef,
      dueDate: dateRef,
      dueTime: timeRef,
      projectId: projectRef,
    };

    refs[field].current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    const validation = validateTodoInput(values);

    if (!validation.success) {
      setErrors({
        fieldErrors: validation.fieldErrors,
        formErrors: validation.formErrors,
      });
      setSubmitError(null);

      const firstInvalidField = (
        ["text", "dueDate", "dueTime", "projectId"] as const
      ).find((field) => validation.fieldErrors[field]?.length);

      if (firstInvalidField) {
        setFocusAfterValidation(firstInvalidField);
      }

      return;
    }

    const requestGeneration = ++requestGenerationRef.current;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    submittingRef.current = true;
    setIsSubmitting(true);
    setErrors(EMPTY_ERRORS);
    setFocusAfterValidation(null);
    setSubmitError(null);

    try {
      await onCreate(validation.data, { signal: abortController.signal });

      if (requestGeneration === requestGenerationRef.current) {
        abortControllerRef.current = null;
        submittingRef.current = false;
        setIsSubmitting(false);
        closeDialog();
      }
    } catch {
      if (requestGeneration === requestGenerationRef.current) {
        abortControllerRef.current = null;
        submittingRef.current = false;
        setIsSubmitting(false);
        setSubmitError(
          "We couldn’t add this task. Your details are still here—try again.",
        );
      }
    }
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (submittingRef.current) {
        return;
      }
      closeDialog();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((element) => !element.hidden);

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const textError = errors.fieldErrors.text?.[0];
  const dateError = errors.fieldErrors.dueDate?.[0];
  const timeError = errors.fieldErrors.dueTime?.[0];
  const projectError = errors.fieldErrors.projectId?.[0];

  return createPortal(
    <div className="todo-dialog-backdrop">
      <div
        aria-busy={isSubmitting}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="todo-dialog"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="todo-dialog__header">
          <h2 id={titleId}>Add a task</h2>
          <p id={descriptionId}>Capture the task now. Add details only if they help.</p>
        </header>

        <form className="todo-dialog__form" noValidate onSubmit={handleSubmit}>
          <div className="todo-dialog__field todo-dialog__field--task">
            <label htmlFor={`${baseId}-text`}>Task</label>
            <input
              aria-describedby={textError ? fieldErrorId(baseId, "text") : undefined}
              aria-invalid={Boolean(textError)}
              autoComplete="off"
              disabled={isSubmitting}
              id={`${baseId}-text`}
              onChange={(event) => updateValue("text", event.target.value)}
              placeholder="What needs doing?"
              ref={textRef}
              type="text"
              value={values.text}
            />
            {textError && (
              <p
                className="todo-dialog__field-error"
                id={fieldErrorId(baseId, "text")}
              >
                {textError}
              </p>
            )}
          </div>

          <div className="todo-dialog__details">
            <div className="todo-dialog__field">
              <label htmlFor={`${baseId}-date`}>Due date</label>
              <input
                aria-describedby={dateError ? fieldErrorId(baseId, "dueDate") : undefined}
                aria-invalid={Boolean(dateError)}
                disabled={isSubmitting}
                id={`${baseId}-date`}
                onChange={(event) => updateValue("dueDate", event.target.value)}
                ref={dateRef}
                type="date"
                value={values.dueDate ?? ""}
              />
              {dateError && (
                <p
                  className="todo-dialog__field-error"
                  id={fieldErrorId(baseId, "dueDate")}
                >
                  {dateError}
                </p>
              )}
            </div>

            <div className="todo-dialog__field">
              <label htmlFor={`${baseId}-time`}>Due time</label>
              <input
                aria-describedby={timeError ? fieldErrorId(baseId, "dueTime") : `${baseId}-time-hint`}
                aria-invalid={Boolean(timeError)}
                disabled={isSubmitting}
                id={`${baseId}-time`}
                onChange={(event) => updateValue("dueTime", event.target.value)}
                ref={timeRef}
                type="time"
                value={values.dueTime ?? ""}
              />
              {timeError ? (
                <p
                  className="todo-dialog__field-error"
                  id={fieldErrorId(baseId, "dueTime")}
                >
                  {timeError}
                </p>
              ) : (
                <p className="todo-dialog__hint" id={`${baseId}-time-hint`}>
                  Requires a due date.
                </p>
              )}
            </div>
          </div>

          <div className="todo-dialog__field">
            <label htmlFor={`${baseId}-project`}>Project</label>
            <select
              aria-describedby={projectError ? fieldErrorId(baseId, "projectId") : undefined}
              aria-invalid={Boolean(projectError)}
              disabled={isSubmitting}
              id={`${baseId}-project`}
              onChange={(event) => updateValue("projectId", event.target.value)}
              ref={projectRef}
              value={values.projectId ?? ""}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
            {projectError && (
              <p
                className="todo-dialog__field-error"
                id={fieldErrorId(baseId, "projectId")}
              >
                {projectError}
              </p>
            )}
          </div>

          {errors.formErrors.length > 0 && (
            <p className="todo-dialog__submit-error" role="alert">
              Review the form and try again.
            </p>
          )}

          {submitError && (
            <p
              className="todo-dialog__submit-error"
              id={submitErrorId}
              role="alert"
            >
              {submitError}
            </p>
          )}

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
              aria-describedby={submitError ? submitErrorId : undefined}
              className="todo-dialog__button todo-dialog__button--primary"
              type="submit"
            >
              {isSubmitting ? "Adding…" : "Add task"}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
