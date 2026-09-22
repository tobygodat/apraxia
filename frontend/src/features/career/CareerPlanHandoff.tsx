import { useEffect, useRef, useState } from "react";
import { hasServiceErrorCode } from "../../lib/serviceError";
import type { Project, ProjectSummary } from "../../types/domain";
import { isSqlDate } from "../todos/dateDomain";
import {
  buildCareerBrief,
  parseCareerPlan,
  CareerPlanImportError,
  type CareerPlanDraft,
} from "./careerPlan";
import {
  isDefiniteRejection,
  type CareerApplication,
  type CareerPrepItem,
  type CareerQuestion,
  type CareerService,
  type CareerStep,
  type CareerStory,
} from "./careerService";
import { useCareerRun } from "./useCareerRun";
import "./careerPlan.css";

interface HandoffProps {
  userId: string;
  application: CareerApplication;
  steps: readonly CareerStep[];
  items: readonly CareerPrepItem[];
  today: string;
  service: CareerService;
  projects?: readonly ProjectSummary[];
  loadProject?(id: string): Promise<Project>;
  onImported(items: CareerPrepItem[]): void;
  onOpenToday?(): void;
}

/** An explicit text handoff: selected context leaves only when the user copies it. */
export function CareerPlanHandoff(props: HandoffProps) {
  const [mode, setMode] = useState<"brief" | "import" | null>(null);
  const [receipt, setReceipt] = useState("");
  // The import panel stays mounted once opened, so a save in flight survives
  // switching to the brief and back.
  const [importStarted, setImportStarted] = useState(false);
  const briefButton = useRef<HTMLButtonElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    (mode === "brief" ? briefButton : importButton).current?.focus();
    setMode(null);
  };
  return (
    <div className="career-plan-tools">
      <div className="career-plan__actions">
        <button
          ref={briefButton}
          type="button"
          className="paper-action"
          aria-expanded={mode === "brief"}
          onClick={() => {
            setReceipt("");
            setMode(mode === "brief" ? null : "brief");
          }}
        >
          brief for AI
        </button>
        <button
          ref={importButton}
          type="button"
          className="paper-action"
          aria-expanded={mode === "import"}
          onClick={() => {
            setReceipt("");
            setImportStarted(true);
            setMode(mode === "import" ? null : "import");
          }}
        >
          import a plan
        </button>
      </div>
      {mode === "brief" && <CareerBrief {...props} onClose={close} />}
      {importStarted && (
        <div hidden={mode !== "import"}>
          <CareerPlanImport
            {...props}
            onClose={close}
            onImported={(rows) => {
              setImportStarted(false);
              props.onImported(rows);
              setReceipt(
                `${rows.length} ${rows.length === 1 ? "task" : "tasks"} saved to prep and tasks.`,
              );
              close();
            }}
          />
        </div>
      )}
      {/* The live region stays mounted so a new receipt is announced. */}
      <div className="career-plan__receipt">
        <p role="status">{receipt}</p>
        {receipt && props.onOpenToday && (
          <button type="button" className="paper-action" onClick={props.onOpenToday}>
            open today
          </button>
        )}
      </div>
    </div>
  );
}

function CareerBrief({
  userId,
  application,
  steps,
  items,
  today,
  service,
  projects = [],
  loadProject,
  onClose,
}: HandoffProps & { onClose(): void }) {
  const [stories, setStories] = useState<CareerStory[]>([]);
  const [questions, setQuestions] = useState<CareerQuestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedStories, setSelectedStories] = useState<string[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeQuestions, setIncludeQuestions] = useState(true);
  const [includePrep, setIncludePrep] = useState(true);
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, error, run, setError } = useCareerRun("Couldn’t prepare this brief. Try again.");
  const load = () =>
    run("Loading context…", async (signal) => {
      const [savedStories, savedQuestions] = await Promise.all([
        service.listStories(userId, signal),
        service.listQuestions(userId, application.id, signal),
      ]);
      if (signal.aborted) return;
      setStories(savedStories);
      setQuestions(savedQuestions);
      setLoaded(true);
    });
  useEffect(() => {
    void load();
    // The panel remounts for a new handoff; loading is scoped to that panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
  return (
    <section className="career-plan" aria-label="brief for your assistant">
      <h3 className="career-plan__heading">prepare a brief</h3>
      <p className="career-plan__description">
        Choose context for {application.company}, then review the brief before sharing it with your
        assistant.
      </p>
      {draft === null ? (
        <>
          <div className="career-plan__choices">
            <label>
              <input
                className="paper-check"
                type="checkbox"
                checked={includeNotes}
                onChange={(event) => setIncludeNotes(event.target.checked)}
              />
              process notes
            </label>
            <label>
              <input
                className="paper-check"
                type="checkbox"
                checked={includeQuestions}
                onChange={(event) => setIncludeQuestions(event.target.checked)}
              />
              saved questions
            </label>
            <label>
              <input
                className="paper-check"
                type="checkbox"
                checked={includePrep}
                onChange={(event) => setIncludePrep(event.target.checked)}
              />
              existing preparation
            </label>
          </div>
          {!!stories.length && (
            <details className="career-plan__context">
              <summary>choose behavioral stories · {selectedStories.length} selected</summary>
              <div className="career-plan__choices">
                {stories.map((story) => (
                  <label key={story.id}>
                    <input
                      className="paper-check"
                      type="checkbox"
                      checked={selectedStories.includes(story.id)}
                      onChange={() => setSelectedStories(toggle(selectedStories, story.id))}
                    />
                    {story.title}
                  </label>
                ))}
              </div>
            </details>
          )}
          {!!projects.length && loadProject && (
            <details className="career-plan__context">
              <summary>choose projects · {selectedProjects.length} selected</summary>
              <div className="career-plan__choices">
                {projects.map((project) => (
                  <label key={project.id}>
                    <input
                      className="paper-check"
                      type="checkbox"
                      checked={selectedProjects.includes(project.id)}
                      onChange={() => setSelectedProjects(toggle(selectedProjects, project.id))}
                    />
                    {project.title}
                  </label>
                ))}
              </div>
            </details>
          )}
          <div className="career-plan__actions">
            <button
              type="button"
              className="paper-action"
              disabled={!!busy || !loaded}
              onClick={() =>
                void run("Preparing…", async (signal) => {
                  const evidence = loadProject
                    ? await Promise.all(selectedProjects.map((id) => loadProject(id)))
                    : [];
                  if (signal.aborted) return;
                  try {
                    setDraft(
                      buildCareerBrief({
                        application: {
                          ...application,
                          processNotes: includeNotes ? application.processNotes : null,
                        },
                        steps: includeNotes
                          ? steps
                          : steps.map((step) => ({ ...step, notes: null })),
                        prep: includePrep ? items : [],
                        questions: includeQuestions ? questions : [],
                        stories: stories.filter((story) => selectedStories.includes(story.id)),
                        projects: evidence,
                        today,
                      }),
                    );
                  } catch (cause) {
                    if (cause instanceof CareerPlanImportError) setError(cause.message);
                    else throw cause;
                  }
                })
              }
            >
              {busy || "review brief"}
            </button>
            {!loaded && error && (
              <button type="button" className="paper-action" onClick={() => void load()}>
                retry
              </button>
            )}
            <button type="button" className="paper-action paper-action--quiet" onClick={onClose}>
              close
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="career-plan__field">
            <span>brief to share</span>
            <textarea
              autoFocus
              className="paper-field career-plan__source"
              rows={12}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setCopied(false);
              }}
            />
          </label>
          <div className="career-plan__actions">
            <button
              type="button"
              className="paper-action"
              onClick={() =>
                void run("Copying…", async (signal) => {
                  try {
                    await navigator.clipboard.writeText(draft);
                  } catch {
                    setError("Couldn’t copy the brief. Select the text above and copy it.");
                    return;
                  }
                  if (!signal.aborted) setCopied(true);
                })
              }
              disabled={!!busy}
            >
              {copied ? "copied" : "copy brief"}
            </button>
            <button
              type="button"
              className="paper-action paper-action--quiet"
              onClick={() => {
                setDraft(null);
                setCopied(false);
              }}
            >
              change context
            </button>
            <button type="button" className="paper-action paper-action--quiet" onClick={onClose}>
              close
            </button>
          </div>
          {copied && (
            <p role="status" className="career-plan__description">
              Paste this into your assistant, then bring its plan back with “import a plan”.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="workspace-error paper-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

interface ReviewTask extends CareerPlanDraft {
  id: string;
  included: boolean;
  existing: boolean;
}

function CareerPlanImport({
  userId,
  application,
  items,
  service,
  onImported,
  onClose,
}: HandoffProps & { onClose(): void }) {
  const [source, setSource] = useState("");
  const [tasks, setTasks] = useState<ReviewTask[] | null>(null);
  // Once submitted, retries send precisely the same IDs and values. An uncertain
  // response must not become permission to create a second, edited batch.
  const [submitted, setSubmitted] = useState<(CareerPlanDraft & { id: string })[] | null>(null);
  const { busy, error, setError, run } = useCareerRun(
    "Couldn’t confirm the save. Your reviewed plan is kept here; try saving again.",
  );
  const update = (id: string, changes: Partial<ReviewTask>) =>
    setTasks((rows) => rows?.map((row) => (row.id === id ? { ...row, ...changes } : row)) ?? null);
  const included = tasks?.filter((task) => task.included) ?? [];
  return (
    <section className="career-plan" aria-label="import preparation plan">
      <h3 className="career-plan__heading">review a preparation plan</h3>
      {!tasks ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const parsed = parseCareerPlan(source);
              setTasks(
                parsed.map((task) => {
                  const existing = items.some(
                    (item) => item.body.trim() === task.body.trim() && item.dueOn === task.dueOn,
                  );
                  return { ...task, id: crypto.randomUUID(), included: !existing, existing };
                }),
              );
              setError("");
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Couldn’t read this plan. Use one task per line.",
              );
            }
          }}
        >
          <label className="career-plan__field">
            <span>paste a plan</span>
            <textarea
              autoFocus
              className="paper-field career-plan__source"
              rows={7}
              required
              maxLength={200_000}
              value={source}
              onChange={(event) => setSource(event.target.value)}
              aria-describedby="career-plan-format"
              placeholder={
                "- Practice a two-minute project introduction\n- Review questions for the next round"
              }
            />
          </label>
          <p id="career-plan-format" className="career-plan__description">
            Use one task per line, a checklist, or the JSON from your brief. You’ll choose what to
            save and check the dates next.
          </p>
          <div className="career-plan__actions">
            <button type="submit" className="paper-action">
              review tasks
            </button>
            <button type="button" className="paper-action paper-action--quiet" onClick={onClose}>
              cancel
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const batch =
              submitted ??
              included.map(({ id, body, dueOn }) => ({ id, body: body.trim(), dueOn }));
            if (
              !batch.length ||
              batch.some(
                (task) =>
                  !task.body ||
                  [...task.body].length > 2000 ||
                  (task.dueOn !== null && !isSqlDate(task.dueOn)),
              )
            ) {
              setError(
                "Select at least one task. Use text up to 2,000 characters and a valid date, or leave the date empty.",
              );
              return;
            }
            setSubmitted(batch);
            void run("Saving tasks…", async (signal) => {
              let saved: CareerPrepItem[];
              try {
                saved = await service.importPrep(userId, application.id, batch, signal);
              } catch (cause) {
                // A definite rejection saved nothing, so the review can change
                // again. Clashing IDs are replaced so the next save can succeed.
                if (!signal.aborted && isDefiniteRejection(cause)) {
                  setSubmitted(null);
                  if (hasServiceErrorCode(cause, "conflict"))
                    setTasks(
                      (rows) => rows?.map((row) => ({ ...row, id: crypto.randomUUID() })) ?? null,
                    );
                }
                throw cause;
              }
              if (!signal.aborted) onImported(saved);
            });
          }}
        >
          <p className="career-plan__description">
            These become tasks linked to {application.company}. Tasks due today or earlier appear on
            Home; tasks without a date go to Inbox.
          </p>
          <ol className="career-plan__review">
            {tasks.map((task, index) => (
              <li key={task.id} className="career-plan__task">
                <label className="career-plan__include">
                  <input
                    className="paper-check"
                    type="checkbox"
                    checked={task.included}
                    disabled={!!submitted}
                    onChange={(event) => update(task.id, { included: event.target.checked })}
                  />
                  include task {index + 1}
                </label>
                <label className="career-plan__field career-plan__task-body">
                  <span>task {index + 1}</span>
                  <textarea
                    autoFocus={index === 0}
                    className="paper-field"
                    rows={2}
                    maxLength={4000}
                    required={task.included}
                    value={task.body}
                    readOnly={!!submitted}
                    onChange={(event) => update(task.id, { body: event.target.value })}
                  />
                </label>
                <label className="career-plan__field career-plan__task-date">
                  <span>due date {index + 1}</span>
                  <input
                    className="paper-field"
                    type="date"
                    min="0001-01-01"
                    max="9999-12-31"
                    value={task.dueOn ?? ""}
                    disabled={!!submitted}
                    onChange={(event) => update(task.id, { dueOn: event.target.value || null })}
                  />
                </label>
                {task.existing && (
                  <p className="career-plan__duplicate">
                    Matches an existing prep item; left unselected.
                  </p>
                )}
              </li>
            ))}
          </ol>
          <div className="career-plan__actions">
            <button type="submit" className="paper-action" disabled={!!busy || !included.length}>
              {busy ||
                (submitted
                  ? "try saving again"
                  : `save ${included.length} ${included.length === 1 ? "task" : "tasks"}`)}
            </button>
            {!submitted && (
              <button
                type="button"
                className="paper-action paper-action--quiet"
                onClick={() => {
                  setTasks(null);
                  setError("");
                }}
              >
                edit source
              </button>
            )}
            <button
              type="button"
              className="paper-action paper-action--quiet"
              onClick={onClose}
              disabled={!!busy}
            >
              {submitted ? "close" : "cancel"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="workspace-error paper-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
