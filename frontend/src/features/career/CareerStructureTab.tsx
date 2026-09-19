import { useState } from "react";
import { MarkdownField } from "./markdown/MarkdownField";
import { stepTiming } from "./careerPresentation";
import {
  nextStepOf,
  type CareerApplication,
  type CareerService,
  type CareerStep,
} from "./careerService";
import { useCareerRun } from "./useCareerRun";

/**
 * The process: every round in order, the one that is next carrying the green
 * rule, and the notes about how the whole thing goes underneath. The next round
 * is worked out from the rounds themselves, so ticking one off moves the rule
 * without a reload.
 */
export function CareerStructureTab({
  userId,
  application,
  steps,
  service,
  today,
  onSteps,
  onApplication,
}: {
  userId: string;
  application: CareerApplication;
  steps: readonly CareerStep[];
  service: CareerService;
  today: string;
  onSteps(steps: CareerStep[]): void;
  onApplication(application: CareerApplication): void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [scheduledOn, setScheduledOn] = useState("");
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  const { busy, error, run } = useCareerRun("Couldn’t save this round. Try again.");
  const ordered = [...steps].sort(
    (a, b) =>
      a.position - b.position ||
      (a.scheduledOn ?? "").localeCompare(b.scheduledOn ?? "") ||
      a.id.localeCompare(b.id),
  );
  const next = nextStepOf(steps);
  const replace = (step: CareerStep) =>
    onSteps([...steps.filter((row) => row.id !== step.id), step]);

  function save(step: Partial<CareerStep> & { name: string }, label: string) {
    return run(label, async (signal) => {
      const row = await service.saveStep(userId, application.id, step, signal);
      if (!signal.aborted) replace(row);
    });
  }

  return (
    <div className="career-tab">
      <h2 className="paper-heading career-tab__heading">process</h2>
      <div className="career-app-rows">
        {ordered.map((step) => {
          const timing = stepTiming(step, today);
          const done = !!step.doneAt;
          const open = notesFor === step.id;
          return (
            <div
              key={step.id}
              className={`paper-row career-app-row${done ? " career-app-row--done" : ""}${
                step.id === next?.id ? " paper-row--now career-app-row--now" : ""
              }`}
            >
              <div className="career-app-row__line">
                <input
                  className="paper-check"
                  type="checkbox"
                  checked={done}
                  aria-label={`${step.name} done`}
                  disabled={!!busy}
                  onChange={(event) =>
                    void save(
                      {
                        id: step.id,
                        name: step.name,
                        doneAt: event.target.checked ? new Date().toISOString() : null,
                      },
                      event.target.checked ? "Marking done…" : "Reopening…",
                    )
                  }
                />
                <span className="career-app-row__name">{step.name}</span>
                <button
                  type="button"
                  className="paper-action paper-action--quiet career-app-row__note-action"
                  onClick={() => setNotesFor(open ? null : step.id)}
                >
                  {open ? "hide note" : "note"}
                </button>
                <span
                  className={`paper-row__meta career-app-row__when${
                    timing.late ? " paper-row__meta--late" : ""
                  }`}
                >
                  {timing.label}
                </span>
              </div>
              {step.notes && !open && <p className="career-app-row__notes">{step.notes}</p>}
              {open && (
                <div className="career-app-row__editor">
                  <label className="career-editor__label">
                    <span>date</span>
                    <input
                      className="paper-field"
                      type="date"
                      value={step.scheduledOn ?? ""}
                      onChange={(event) =>
                        void save(
                          {
                            id: step.id,
                            name: step.name,
                            scheduledOn: event.target.value || null,
                          },
                          "Saving the date…",
                        )
                      }
                    />
                  </label>
                  <textarea
                    className="paper-field career-app-row__note-field"
                    aria-label={`${step.name} note`}
                    defaultValue={step.notes ?? ""}
                    rows={2}
                    placeholder="how this round went, or what to expect"
                    onBlur={(event) => {
                      if (event.target.value === (step.notes ?? "")) return;
                      void save(
                        { id: step.id, name: step.name, notes: event.target.value || null },
                        "Saving the note…",
                      );
                    }}
                  />
                  <p className="career-app-row__editor-actions">
                    <button
                      type="button"
                      className="paper-action paper-action--danger"
                      disabled={!!busy}
                      onClick={() =>
                        void run("Removing the round…", async (signal) => {
                          await service.removeStep(userId, step.id, signal);
                          if (!signal.aborted) {
                            onSteps(steps.filter((row) => row.id !== step.id));
                            setNotesFor(null);
                          }
                        })
                      }
                    >
                      remove this round
                    </button>
                  </p>
                </div>
              )}
            </div>
          );
        })}
        <div className="paper-row career-app-row career-app-row--add">
          {adding ? (
            <form
              className="career-app-row__line career-app-row__add-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) return;
                void save(
                  {
                    name,
                    scheduledOn: scheduledOn || null,
                    position: ordered.length ? ordered[ordered.length - 1].position + 1 : 0,
                  },
                  "Adding the round…",
                ).then(() => {
                  setName("");
                  setScheduledOn("");
                });
              }}
            >
              <input
                className="paper-field career-app-row__add-name"
                value={name}
                autoFocus
                required
                placeholder="technical screen"
                aria-label="round"
                onChange={(event) => setName(event.target.value)}
              />
              <input
                className="paper-field"
                type="date"
                value={scheduledOn}
                aria-label="round date"
                onChange={(event) => setScheduledOn(event.target.value)}
              />
              <button type="submit" className="paper-action" disabled={!!busy}>
                add
              </button>
              <button
                type="button"
                className="paper-action paper-action--quiet"
                onClick={() => setAdding(false)}
              >
                cancel
              </button>
            </form>
          ) : (
            <button type="button" className="paper-action" onClick={() => setAdding(true)}>
              add step
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="workspace-error paper-error" role="alert">
          {error}
        </p>
      )}

      <div className="career-tab__section-head">
        <h2 className="paper-heading career-tab__heading">how it goes</h2>
        <span className="career-tab__aside">markdown · live preview</span>
      </div>
      <div className="career-tab__notes paper-measure">
        <MarkdownField
          value={application.processNotes ?? ""}
          label="how this process goes"
          placeholder="write what you know about the process"
          minRows={6}
          status={saved}
          onCommit={(next) =>
            void run("Saving the notes…", async (signal) => {
              const row = await service.updateApplication(
                userId,
                application.id,
                { processNotes: next || null },
                signal,
              );
              if (!signal.aborted) {
                onApplication(row);
                setSaved("saved");
              }
            })
          }
        />
      </div>
    </div>
  );
}
