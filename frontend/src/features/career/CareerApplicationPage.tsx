import { useEffect, useState } from "react";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { hasServiceErrorCode } from "../../lib/serviceError";
import { useLocalToday } from "../todos/useLocalToday";
import { CareerPrepTab } from "./CareerPrepTab";
import { CareerResourcesTab } from "./CareerResourcesTab";
import { CareerStructureTab } from "./CareerStructureTab";
import { applicationSummary } from "./careerPresentation";
import {
  CAREER_STAGES,
  nextStepOf,
  type CareerApplication,
  type CareerService,
  type CareerStage,
  type CareerStep,
} from "./careerService";
import { useCareerRun } from "./useCareerRun";
import "./careerApplication.css";
import "./careerApplicationPaper.css";

export type CareerTab = "structure" | "prep" | "resources";

const TABS: readonly CareerTab[] = ["structure", "prep", "resources"];

/**
 * One application: the process, what there is to prepare, and the files and
 * links. The header carries the next round on all three tabs, so it is read
 * here from the rounds themselves rather than from a column, and a round ticked
 * off on the structure tab moves the header with it.
 */
export function CareerApplicationPage({
  userId,
  applicationId,
  tab,
  service,
  timezone,
  onOpenTab,
  onBack,
  onDeleted,
}: {
  userId: string;
  applicationId: string;
  tab: CareerTab;
  service: CareerService;
  timezone?: string;
  onOpenTab(next: CareerTab): void;
  onBack(): void;
  onDeleted?(): void;
}) {
  const today = useLocalToday(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [application, setApplication] = useState<CareerApplication | null>(null);
  const [steps, setSteps] = useState<CareerStep[]>([]);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const { busy, error, run } = useCareerRun("Couldn’t load this application. Try again.");
  useEffect(() => {
    setApplication(null);
    setMissing(false);
    void run("Loading…", async (signal) => {
      try {
        const [row, rounds] = await Promise.all([
          service.getApplication(userId, applicationId, signal),
          service.listSteps(userId, applicationId, signal),
        ]);
        if (!signal.aborted) {
          setApplication(row);
          setSteps(rounds);
        }
      } catch (cause) {
        // An application that has been deleted is not a failure to report: the
        // page says it is gone and leaves the error line for the rest.
        if (!hasServiceErrorCode(cause, "not_found")) throw cause;
        if (!signal.aborted) setMissing(true);
      }
    });
    // `run` is stable; the application being read is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, userId, applicationId]);

  const nextStep = nextStepOf(steps);
  return (
    <section className="career-app workspace-page">
      <p className="career-app__back">
        <button type="button" className="paper-action paper-action--quiet" onClick={onBack}>
          <WorkspaceIcon name="left" />
          all applications
        </button>
      </p>
      {error && (
        <p className="workspace-error paper-error" role="alert">
          {error}
        </p>
      )}
      {!application ? (
        <p className="career-app__waiting" role="status">
          {missing ? "This application isn’t here any more." : busy || "Loading…"}
        </p>
      ) : (
        <>
          <header className="career-app__header">
            <div className="career-app__identity">
              <h1 className="career-app__company">{application.company}</h1>
              <p className="career-app__role">{application.role}</p>
              <p className="career-app__summary">
                {applicationSummary(application, nextStep, today)}
              </p>
            </div>
            <div className="career-app__header-actions">
              {application.postingUrl && (
                <a
                  className="paper-action paper-action--quiet"
                  href={application.postingUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  posting
                </a>
              )}
              <button
                type="button"
                className="paper-action paper-action--quiet"
                onClick={() => setEditing((open) => !open)}
              >
                {editing ? "close" : "edit"}
              </button>
            </div>
          </header>
          {editing && (
            <ApplicationEditor
              userId={userId}
              application={application}
              service={service}
              onSaved={(row) => {
                setApplication(row);
                setEditing(false);
              }}
              onDeleted={onDeleted}
            />
          )}
          <nav className="career-app__tabs" aria-label="application">
            {TABS.map((name) => (
              <button
                key={name}
                type="button"
                className={`paper-nav__item career-app__tab${
                  name === tab ? " paper-nav__item--current" : ""
                }`}
                aria-current={name === tab ? "page" : undefined}
                onClick={() => onOpenTab(name)}
              >
                {name}
              </button>
            ))}
          </nav>
          {tab === "structure" && (
            <CareerStructureTab
              userId={userId}
              application={application}
              steps={steps}
              service={service}
              today={today}
              onSteps={setSteps}
              onApplication={setApplication}
            />
          )}
          {tab === "prep" && (
            <CareerPrepTab
              userId={userId}
              applicationId={applicationId}
              service={service}
              today={today}
            />
          )}
          {tab === "resources" && (
            <CareerResourcesTab userId={userId} applicationId={applicationId} service={service} />
          )}
        </>
      )}
    </section>
  );
}

/** Company, role, where it stands: the few facts the header reads from. */
function ApplicationEditor({
  userId,
  application,
  service,
  onSaved,
  onDeleted,
}: {
  userId: string;
  application: CareerApplication;
  service: CareerService;
  onSaved(row: CareerApplication): void;
  onDeleted?(): void;
}) {
  const [company, setCompany] = useState(application.company);
  const [role, setRole] = useState(application.role);
  const [appliedOn, setAppliedOn] = useState(application.appliedOn ?? "");
  const [stage, setStage] = useState<CareerStage>(application.stage);
  const [location, setLocation] = useState(application.location ?? "");
  const [postingUrl, setPostingUrl] = useState(application.postingUrl ?? "");
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useCareerRun("Couldn’t save this application. Try again.");
  return (
    <form
      className="career-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void run("Saving…", async (signal) => {
          const row = await service.updateApplication(
            userId,
            application.id,
            {
              company,
              role,
              appliedOn: appliedOn || null,
              stage,
              location: location || null,
              postingUrl: postingUrl || null,
            },
            signal,
          );
          if (!signal.aborted) onSaved(row);
        });
      }}
    >
      {error && (
        <p className="workspace-error paper-error" role="alert">
          {error}
        </p>
      )}
      <div className="career-editor__fields">
        <label className="career-editor__label">
          <span>company</span>
          <input
            className="paper-field"
            value={company}
            required
            onChange={(event) => setCompany(event.target.value)}
          />
        </label>
        <label className="career-editor__label">
          <span>role</span>
          <input
            className="paper-field"
            value={role}
            required
            onChange={(event) => setRole(event.target.value)}
          />
        </label>
        <label className="career-editor__label">
          <span>applied</span>
          <input
            className="paper-field"
            type="date"
            value={appliedOn}
            onChange={(event) => setAppliedOn(event.target.value)}
          />
        </label>
        <label className="career-editor__label">
          <span>stage</span>
          <select
            className="paper-field"
            value={stage}
            onChange={(event) => setStage(event.target.value as CareerStage)}
          >
            {CAREER_STAGES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="career-editor__label">
          <span>location</span>
          <input
            className="paper-field"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>
        <label className="career-editor__label career-editor__label--wide">
          <span>posting</span>
          <input
            className="paper-field"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={postingUrl}
            onChange={(event) => setPostingUrl(event.target.value)}
          />
        </label>
      </div>
      <p className="career-editor__actions">
        <button type="submit" className="paper-action" disabled={!!busy}>
          {busy ? "saving…" : "save"}
        </button>
        {onDeleted &&
          (confirming ? (
            <>
              <button
                type="button"
                className="paper-action paper-action--danger"
                disabled={!!busy}
                onClick={() =>
                  void run("Removing…", async (signal) => {
                    await service.deleteApplication(application.id, signal);
                    if (!signal.aborted) onDeleted();
                  })
                }
              >
                remove {application.company}
              </button>
              <button
                type="button"
                className="paper-action paper-action--quiet"
                onClick={() => setConfirming(false)}
              >
                keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              className="paper-action paper-action--quiet"
              onClick={() => setConfirming(true)}
            >
              remove
            </button>
          ))}
      </p>
    </form>
  );
}
