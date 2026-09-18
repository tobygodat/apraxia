import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { ClassAssignments } from "./ClassAssignments";
import { ClassSummary } from "./ClassSummary";
import { SavedClassNotes } from "./SavedClassNotes";
import { localToday } from "../todos/dateDomain";
import type { AssignmentService } from "./assignmentService";
import type { ClassOverview } from "./classOverview";
import type { Course } from "./classService";
import type { DriveService } from "./driveService";
import type { NoteService } from "./noteService";

const PdfReader = lazy(() => import("./PdfReader"));

/**
 * One class. Its header totals come from the assignments and notes already on
 * this page, so ticking an assignment off moves the header with the table
 * instead of waiting for a reload. Mount it keyed by class id.
 */
export function ClassDetail({
  userId,
  course,
  driveService,
  assignmentService,
  noteService,
  timezone,
  onEdit,
}: {
  userId: string;
  course: Course;
  driveService?: DriveService;
  assignmentService?: AssignmentService;
  noteService?: NoteService;
  timezone?: string;
  onEdit(): void;
}) {
  const today = localToday(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [assignments, setAssignments] = useState<ClassOverview | null>(null);
  const [notes, setNotes] = useState<number | null>(null);
  // Wait for both halves before writing the line, so a class with notes and no
  // assignments never reads "Nothing saved yet" on its way to the real total.
  const overview =
    assignments && (notes !== null || !noteService) ? { ...assignments, notes: notes ?? 0 } : null;
  return (
    <>
      <header className="classes-heading workspace-page-header">
        <div>
          <h1>{course.name ?? "Recovered class"}</h1>
          {overview && <ClassSummary overview={overview} today={today} variant="header" />}
        </div>
        <button className="workspace-page-header__action" onClick={onEdit}>
          <WorkspaceIcon name="edit" />
          Edit class
        </button>
      </header>
      <div className="classes-course-content">
        {course.name === null && (
          <p>
            This class was recovered from its assignments. Edit its name, or open the browser where
            you originally saved it to recover the name.
          </p>
        )}
        {assignmentService && (
          <ClassAssignments
            userId={userId}
            courseId={course.id}
            service={assignmentService}
            timezone={timezone}
            onOverview={setAssignments}
          />
        )}
        <h2 className="classes-section-heading">Notes</h2>
        {noteService ? (
          <SavedClassNotes
            userId={userId}
            course={course}
            service={noteService}
            driveService={driveService}
            onCount={setNotes}
            renderReader={(file) => <CourseNotes course={course} file={file} />}
          />
        ) : (
          <p role="alert">Note storage is unavailable. Reload to try again.</p>
        )}
      </div>
    </>
  );
}

function CourseNotes({ course, file: preview }: { course: Course; file: File }) {
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const reader = useRef<HTMLElement>(null);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === reader.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === reader.current) await document.exitFullscreen();
      else await reader.current?.requestFullscreen();
    } catch {
      setError(
        "Full screen isn’t available in this browser. Try opening the workspace in another browser.",
      );
    }
  }
  return (
    <div className="classes-notes-layout classes-notes-layout--reading">
      <section
        ref={reader}
        className="classes-reader"
        aria-label={`${course.name ?? "Recovered class"} notes reader`}
      >
        {preview && (
          <header>
            <span title={preview.name}>{preview.name}</span>
            <div>
              <button
                className="classes-reader-tools"
                type="button"
                onClick={() => setShowTools((value) => !value)}
                aria-label={showTools ? "Hide PDF toolbar" : "Show PDF toolbar"}
                aria-expanded={showTools}
                title={`${showTools ? "Hide" : "Show"} PDF toolbar`}
              >
                <WorkspaceIcon name="down" />
              </button>
              <button
                className="classes-reader-fullscreen"
                type="button"
                onClick={() => void toggleFullscreen()}
                aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                title={fullscreen ? "Exit full screen" : "Full screen"}
              >
                <WorkspaceIcon name={fullscreen ? "minimize" : "maximize"} />
              </button>
            </div>
          </header>
        )}
        {error && <p role="alert">{error}</p>}
        <Suspense fallback={<p role="status">Loading PDF reader…</p>}>
          <PdfReader file={preview} showTools={showTools} />
        </Suspense>
      </section>
    </div>
  );
}
