import {
  type FormEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ClassSummary, NewTodoInput, ProjectSummary, Todo } from "../../types/domain";
import { Dialog } from "../../components/dialog/Dialog";
import { TodoClassFields } from "./TodoClassFields";
import { changeTodoField } from "./todoParent";
import {
  isRecurrenceFreq,
  MAX_RECURRENCE_INTERVAL,
  RECURRENCE_FREQS,
  recurrenceFreqLabel,
  recurrencePeriodLabel,
} from "./todoRecurrence";
import {
  type TodoInputErrors,
  type TodoInputField,
  type TodoInputValues,
  validateTodoInput,
} from "./todoInput";
import type { UpdateTodoDetailsInput } from "./todoService";
import "./TodoFormDialog.css";
import "./todosPaper.css";

type TodoFormMode = "create" | "edit" | "reschedule";

type TodoFormSubmission =
  | { readonly mode: "create"; readonly input: NewTodoInput }
  | {
      readonly mode: "edit" | "reschedule";
      readonly todoId: string;
      readonly input: UpdateTodoDetailsInput;
    };

export interface TodoFormDialogProps {
  readonly mode: TodoFormMode;
  readonly open: boolean;
  /** Required for edit and reschedule; its id keys the draft. */
  readonly todo?: Todo | null;
  readonly initialDueDate?: string | null;
  readonly initialProjectId?: string | null;
  readonly projects: readonly ProjectSummary[];
  readonly classes?: readonly ClassSummary[];
  /**
   * The signal only abandons client work if the dialog is removed by its owner.
   * It is not a promise that a started write rolled back, so the dialog blocks
   * dismissal while a save is pending.
   */
  readonly onSubmit: (
    submission: TodoFormSubmission,
    options: { readonly signal: AbortSignal },
  ) => Promise<void>;
  readonly onClose: () => void;
  /** Used when saving moves the original invoking control out of the view. */
  readonly fallbackFocusRef?: RefObject<HTMLElement | null>;
}

const EMPTY_ERRORS: TodoInputErrors = { fieldErrors: {}, formErrors: [] };
// Validation focus follows the reading order of the form, not the payload.
const FIELDS = [
  "text",
  "dueDate",
  "dueTime",
  "recurrenceFreq",
  "recurrenceInterval",
  "recurrenceUntil",
  "projectId",
  "classId",
  "assignmentType",
] as const;
const PRECISE_TIME_PATTERN = /^((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)\.\d{1,6}$/;

const COPY = {
  create: {
    title: "Add a task",
    description: "Capture the task now. Add details only if they help.",
    submit: "Add task",
    pending: "Adding…",
    failed: "We couldn’t add this task. Your details are still here—try again.",
  },
  edit: {
    title: "Edit task",
    description: "Task is required. The schedule, project, and class are optional.",
    submit: "Save changes",
    pending: "Saving…",
    failed: "We couldn’t save this task. Your details are still here—try again.",
  },
  reschedule: {
    title: "Reschedule task",
    description: "Change the schedule. Clear the date to move this task to Inbox.",
    submit: "Save changes",
    pending: "Saving…",
    failed: "We couldn’t save this task. Your details are still here—try again.",
  },
} as const;

/** One compact task form; create and edit differ only in copy, initial values, and payload. */
export function TodoFormDialog({ open, todo = null, mode, ...props }: TodoFormDialogProps) {
  if (!open || (mode !== "create" && !todo)) return null;
  // Remount per record so a fresh draft never overwrites one already being edited.
  return <TodoForm key={todo?.id ?? "new"} mode={mode} todo={todo} {...props} />;
}

function TodoForm({
  mode,
  todo,
  initialDueDate = null,
  initialProjectId = null,
  projects,
  classes = [],
  onSubmit,
  onClose,
  fallbackFocusRef,
}: Omit<TodoFormDialogProps, "open" | "todo"> & { readonly todo: Todo | null }) {
  const baseId = useId();
  const ids = {
    title: `${baseId}-title`,
    description: `${baseId}-description`,
    submitError: `${baseId}-submit-error`,
    saveStatus: `${baseId}-save-status`,
    timeHint: `${baseId}-time-hint`,
    repeatUnit: `${baseId}-repeat-unit`,
    repeatHint: `${baseId}-repeat-hint`,
    field: (field: TodoInputField) => `${baseId}-${field}`,
    error: (field: TodoInputField) => `${baseId}-${field}-error`,
  };
  const refs: Record<TodoInputField, RefObject<HTMLElement | null>> = {
    text: useRef<HTMLInputElement>(null),
    dueDate: useRef<HTMLInputElement>(null),
    dueTime: useRef<HTMLInputElement>(null),
    projectId: useRef<HTMLSelectElement>(null),
    classId: useRef<HTMLSelectElement>(null),
    assignmentType: useRef<HTMLSelectElement>(null),
    recurrenceFreq: useRef<HTMLSelectElement>(null),
    recurrenceInterval: useRef<HTMLInputElement>(null),
    recurrenceUntil: useRef<HTMLInputElement>(null),
  };
  const submitRef = useRef<HTMLButtonElement>(null);
  const submittingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const [values, setValues] = useState<TodoInputValues>(() => ({
    text: todo?.text ?? "",
    dueDate: todo?.dueDate ?? initialDueDate ?? "",
    // Native time controls cannot show SQL microseconds; the exact stored value
    // is retained separately until the user edits this field.
    dueTime: todo?.dueTime?.replace(PRECISE_TIME_PATTERN, "$1") ?? "",
    projectId: todo?.projectId ?? initialProjectId ?? "",
    classId: todo?.classId ?? "",
    assignmentType: todo?.assignmentType ?? "",
    // Reschedule moves one date and never shows the repeat fields, so it must
    // not carry a rule that its own form could not correct.
    ...(mode === "reschedule"
      ? { recurrenceFreq: "", recurrenceInterval: "", recurrenceUntil: "" }
      : {
          recurrenceFreq: todo?.recurrence?.freq ?? "",
          recurrenceInterval: todo?.recurrence ? String(todo.recurrence.interval) : "",
          recurrenceUntil: todo?.recurrence?.until ?? "",
        }),
  }));
  const [retainedDueTime, setRetainedDueTime] = useState(todo?.dueTime ?? null);
  const [errors, setErrors] = useState<TodoInputErrors>(EMPTY_ERRORS);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusAfterValidation, setFocusAfterValidation] = useState<TodoInputField | null>(null);
  const copy = COPY[mode];

  // An abandoned provider may still resolve after abort. Invalidate its
  // continuation before aborting so unmount cannot later call onClose.
  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRef.current?.abort();
    },
    [],
  );

  useLayoutEffect(() => {
    if (focusAfterValidation === null) return;
    // Move focus only after the error element and aria-describedby are committed.
    refs[focusAfterValidation].current?.focus();
    setFocusAfterValidation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors, focusAfterValidation]);

  function fieldError(field: TodoInputField): string | undefined {
    return errors.fieldErrors[field]?.[0];
  }

  function updateValue(field: TodoInputField, value: string) {
    if (submittingRef.current) return;
    if (field === "dueTime" || (field === "dueDate" && value === "")) setRetainedDueTime(null);
    setValues((current) => ({
      // A task has one parent: choosing a project or class clears the other.
      ...changeTodoField(current, field, value),
      // A repeat is anchored on the date, so clearing the date clears its time
      // and its rule together, matching the atomic provider rule.
      ...(field === "dueDate" && value === ""
        ? { dueTime: "", recurrenceFreq: "", recurrenceInterval: "", recurrenceUntil: "" }
        : {}),
      ...(field === "recurrenceFreq" && value === ""
        ? { recurrenceInterval: "", recurrenceUntil: "" }
        : {}),
    }));
    setErrors((current) => {
      const fieldErrors = { ...current.fieldErrors, [field]: undefined };
      if (field === "dueDate") fieldErrors.dueTime = undefined;
      if (field === "dueDate" || field === "recurrenceFreq") {
        fieldErrors.recurrenceFreq = undefined;
        fieldErrors.recurrenceInterval = undefined;
        fieldErrors.recurrenceUntil = undefined;
      }
      return { ...current, fieldErrors };
    });
    setSubmitError(null);
  }

  function closeDialog() {
    if (submittingRef.current) return;
    generationRef.current += 1;
    onClose();
  }

  function submission(data: NewTodoInput): TodoFormSubmission {
    if (mode === "create") return { mode, input: data };
    const dueDate = data.dueDate ?? null;
    const details =
      mode === "reschedule"
        ? {}
        : {
            text: data.text,
            projectId: data.projectId ?? null,
            // Send class fields only when the class changed or was set, so an
            // ordinary edit never rewrites assignment metadata it did not show.
            ...(todo?.classId || values.classId
              ? { classId: data.classId ?? null, assignmentType: data.assignmentType ?? "" }
              : {}),
          };
    const input: UpdateTodoDetailsInput =
      dueDate === null
        ? { ...details, dueDate: null, dueTime: null }
        : {
            ...details,
            dueDate,
            dueTime: retainedDueTime ?? data.dueTime ?? null,
            // Reschedule leaves the key off entirely, so an existing rule is
            // carried over untouched rather than rewritten from a hidden field.
            ...(mode === "edit" ? { recurrence: data.recurrence ?? null } : {}),
          };
    return { mode, todoId: todo!.id, input };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    const validation = validateTodoInput(values);
    if (!validation.success) {
      setErrors({ fieldErrors: validation.fieldErrors, formErrors: validation.formErrors });
      setSubmitError(null);
      setFocusAfterValidation(
        FIELDS.find((field) => validation.fieldErrors[field]?.length) ?? null,
      );
      return;
    }
    const generation = ++generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    submittingRef.current = true;
    // Enter may submit from an input about to become disabled. Keep a focusable
    // control inside the modal before locking the fields.
    submitRef.current?.focus();
    setIsSubmitting(true);
    setErrors(EMPTY_ERRORS);
    setFocusAfterValidation(null);
    setSubmitError(null);
    try {
      await onSubmit(submission(validation.data), { signal: controller.signal });
      if (generation !== generationRef.current || controller.signal.aborted) return;
      abortRef.current = null;
      submittingRef.current = false;
      setIsSubmitting(false);
      closeDialog();
    } catch {
      if (generation !== generationRef.current || controller.signal.aborted) return;
      abortRef.current = null;
      submittingRef.current = false;
      setIsSubmitting(false);
      setSubmitError(copy.failed);
    }
  }

  function renderFieldError(field: TodoInputField) {
    const message = fieldError(field);
    return message ? (
      <p className="todo-dialog__field-error" id={ids.error(field)}>
        {message}
      </p>
    ) : null;
  }

  const missingCurrentProject =
    Boolean(values.projectId) && !projects.some((project) => project.id === values.projectId);
  const preciseStoredTime =
    retainedDueTime !== null && PRECISE_TIME_PATTERN.test(retainedDueTime) ? retainedDueTime : null;
  const repeatFreq = isRecurrenceFreq(values.recurrenceFreq) ? values.recurrenceFreq : null;
  // Only say something the person cannot already see: what a rule will do, or
  // why the menu will not hold one yet.
  const repeatHint = repeatFreq
    ? "Finishing this task creates the next one."
    : values.dueDate
      ? null
      : "Requires a due date.";

  return (
    <Dialog
      labelledBy={ids.title}
      describedBy={ids.description}
      busy={isSubmitting}
      closeLocked={isSubmitting}
      onClose={closeDialog}
      className={`todo-dialog paper-dialog${mode === "create" ? "" : " todo-edit-dialog"}`}
      backdropClassName="todo-dialog-backdrop"
      initialFocusRef={refs[mode === "reschedule" ? "dueDate" : "text"]}
      fallbackFocusRef={fallbackFocusRef}
    >
      <header className="todo-dialog__header">
        <h2 id={ids.title}>{copy.title}</h2>
        <p id={ids.description}>{copy.description}</p>
      </header>
      <form className="todo-dialog__form" noValidate onSubmit={handleSubmit}>
        {mode === "reschedule" ? (
          <p className="todo-edit-dialog__task">{values.text}</p>
        ) : (
          <div className="todo-dialog__field todo-dialog__field--task">
            <label htmlFor={ids.field("text")}>Task</label>
            <input
              aria-describedby={fieldError("text") ? ids.error("text") : undefined}
              aria-invalid={Boolean(fieldError("text"))}
              autoComplete="off"
              disabled={isSubmitting}
              id={ids.field("text")}
              onChange={(event) => updateValue("text", event.target.value)}
              placeholder={mode === "create" ? "What needs doing?" : undefined}
              ref={refs.text as RefObject<HTMLInputElement>}
              required
              type="text"
              value={values.text}
            />
            {renderFieldError("text")}
          </div>
        )}
        <div className="todo-dialog__details">
          <div className="todo-dialog__field">
            <label htmlFor={ids.field("dueDate")}>Due date</label>
            <input
              aria-describedby={fieldError("dueDate") ? ids.error("dueDate") : undefined}
              aria-invalid={Boolean(fieldError("dueDate"))}
              disabled={isSubmitting}
              id={ids.field("dueDate")}
              onChange={(event) => updateValue("dueDate", event.target.value)}
              ref={refs.dueDate as RefObject<HTMLInputElement>}
              type="date"
              value={values.dueDate ?? ""}
            />
            {renderFieldError("dueDate")}
          </div>
          <div className="todo-dialog__field">
            <label htmlFor={ids.field("dueTime")}>Due time</label>
            <input
              aria-describedby={fieldError("dueTime") ? ids.error("dueTime") : ids.timeHint}
              aria-invalid={Boolean(fieldError("dueTime"))}
              disabled={isSubmitting}
              id={ids.field("dueTime")}
              onChange={(event) => updateValue("dueTime", event.target.value)}
              ref={refs.dueTime as RefObject<HTMLInputElement>}
              step={mode === "create" ? undefined : "1"}
              type="time"
              value={values.dueTime ?? ""}
            />
            {fieldError("dueTime") ? (
              renderFieldError("dueTime")
            ) : (
              <p className="todo-dialog__hint" id={ids.timeHint}>
                {preciseStoredTime
                  ? `Saved time: ${preciseStoredTime}. Kept exactly unless you change this field.`
                  : "Requires a due date."}
              </p>
            )}
          </div>
        </div>
        {mode !== "reschedule" && (
          <fieldset className="todo-dialog__repeat">
            <div className="todo-dialog__field">
              <label htmlFor={ids.field("recurrenceFreq")}>Repeats</label>
              <select
                aria-describedby={
                  fieldError("recurrenceFreq")
                    ? ids.error("recurrenceFreq")
                    : repeatHint
                      ? ids.repeatHint
                      : undefined
                }
                aria-invalid={Boolean(fieldError("recurrenceFreq"))}
                disabled={isSubmitting}
                id={ids.field("recurrenceFreq")}
                onChange={(event) => updateValue("recurrenceFreq", event.target.value)}
                ref={refs.recurrenceFreq as RefObject<HTMLSelectElement>}
                value={values.recurrenceFreq ?? ""}
              >
                <option value="">Doesn’t repeat</option>
                {RECURRENCE_FREQS.map((freq) => (
                  <option key={freq} value={freq}>
                    {recurrenceFreqLabel(freq)}
                  </option>
                ))}
              </select>
              {fieldError("recurrenceFreq")
                ? renderFieldError("recurrenceFreq")
                : repeatHint && (
                    <p className="todo-dialog__hint" id={ids.repeatHint}>
                      {repeatHint}
                    </p>
                  )}
            </div>
            {repeatFreq && (
              <div className="todo-dialog__details">
                <div className="todo-dialog__field">
                  <label htmlFor={ids.field("recurrenceInterval")}>Every</label>
                  <div className="todo-dialog__measure">
                    <input
                      aria-describedby={
                        fieldError("recurrenceInterval")
                          ? ids.error("recurrenceInterval")
                          : ids.repeatUnit
                      }
                      aria-invalid={Boolean(fieldError("recurrenceInterval"))}
                      disabled={isSubmitting}
                      id={ids.field("recurrenceInterval")}
                      inputMode="numeric"
                      max={MAX_RECURRENCE_INTERVAL}
                      min={1}
                      onChange={(event) => updateValue("recurrenceInterval", event.target.value)}
                      ref={refs.recurrenceInterval as RefObject<HTMLInputElement>}
                      type="number"
                      value={values.recurrenceInterval ?? ""}
                    />
                    <span className="todo-dialog__measure-unit" id={ids.repeatUnit}>
                      {recurrencePeriodLabel(repeatFreq)}
                    </span>
                  </div>
                  {renderFieldError("recurrenceInterval")}
                </div>
                <div className="todo-dialog__field">
                  <label htmlFor={ids.field("recurrenceUntil")}>Until</label>
                  <input
                    aria-describedby={
                      fieldError("recurrenceUntil") ? ids.error("recurrenceUntil") : undefined
                    }
                    aria-invalid={Boolean(fieldError("recurrenceUntil"))}
                    disabled={isSubmitting}
                    id={ids.field("recurrenceUntil")}
                    onChange={(event) => updateValue("recurrenceUntil", event.target.value)}
                    ref={refs.recurrenceUntil as RefObject<HTMLInputElement>}
                    type="date"
                    value={values.recurrenceUntil ?? ""}
                  />
                  {fieldError("recurrenceUntil") ? (
                    renderFieldError("recurrenceUntil")
                  ) : (
                    <p className="todo-dialog__hint">Optional. Repeats forever when empty.</p>
                  )}
                </div>
              </div>
            )}
          </fieldset>
        )}
        {mode !== "reschedule" && (
          <div className="todo-dialog__field">
            <label htmlFor={ids.field("projectId")}>Project</label>
            <select
              aria-describedby={fieldError("projectId") ? ids.error("projectId") : undefined}
              aria-invalid={Boolean(fieldError("projectId"))}
              disabled={isSubmitting}
              id={ids.field("projectId")}
              onChange={(event) => updateValue("projectId", event.target.value)}
              ref={refs.projectId as RefObject<HTMLSelectElement>}
              value={values.projectId ?? ""}
            >
              <option value="">No project</option>
              {missingCurrentProject && (
                <option value={values.projectId ?? ""} disabled>
                  Current project (unavailable)
                </option>
              )}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
            {renderFieldError("projectId")}
          </div>
        )}
        {mode !== "reschedule" && (
          <TodoClassFields
            baseId={baseId}
            classes={classes}
            values={values}
            disabled={isSubmitting}
            onChange={updateValue}
            classRef={refs.classId as RefObject<HTMLSelectElement>}
            typeRef={refs.assignmentType as RefObject<HTMLSelectElement>}
            errors={errors}
          />
        )}
        {errors.formErrors.length > 0 && (
          <p className="todo-dialog__submit-error" role="alert">
            Review the form and try again.
          </p>
        )}
        {submitError && (
          <p className="todo-dialog__submit-error" id={ids.submitError} role="alert">
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
            aria-busy={isSubmitting}
            aria-describedby={
              isSubmitting ? ids.saveStatus : submitError ? ids.submitError : undefined
            }
            className="todo-dialog__button todo-dialog__button--primary"
            ref={submitRef}
            type="submit"
          >
            {isSubmitting ? copy.pending : copy.submit}
          </button>
        </footer>
      </form>
      <p className="todo-edit-dialog__status" id={ids.saveStatus} role="status" aria-live="polite">
        {isSubmitting ? "Saving this task. Please wait before closing the form." : ""}
      </p>
    </Dialog>
  );
}

export interface TodoComposerDialogProps {
  readonly open: boolean;
  readonly initialDueDate?: string | null;
  readonly initialProjectId?: string | null;
  readonly projects: readonly ProjectSummary[];
  readonly classes?: readonly ClassSummary[];
  readonly onCreate: (
    input: NewTodoInput,
    options: { readonly signal: AbortSignal },
  ) => Promise<void>;
  readonly onClose: () => void;
}

/** Create-mode wrapper kept for existing call sites. */
export function TodoComposerDialog({ onCreate, ...props }: TodoComposerDialogProps) {
  return (
    <TodoFormDialog
      mode="create"
      {...props}
      onSubmit={(submission, options) =>
        onCreate((submission as { input: NewTodoInput }).input, options)
      }
    />
  );
}

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
  readonly fallbackFocusRef?: RefObject<HTMLElement | null>;
}

/** Edit/reschedule wrapper kept for existing call sites. */
export function TodoEditDialog({ todo, mode = "edit", onSave, ...props }: TodoEditDialogProps) {
  return (
    <TodoFormDialog
      mode={mode}
      open={todo !== null}
      todo={todo}
      {...props}
      onSubmit={(submission, options) =>
        onSave(todo!.id, (submission as { input: UpdateTodoDetailsInput }).input, options)
      }
    />
  );
}
