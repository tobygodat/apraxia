import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { WorkspaceDialog } from "../../apps/WorkspaceDialog";
import type { DriveService } from "./driveService";
import "./classes.css";
// One Paper sheet covers the whole Classes feature: this page, the class
// detail, assignments, the Drive source, the saved notes and the PDF reader.
import "./classesPaper.css";

import { ClassDetail } from "./ClassDetail";
import { ClassSummary } from "./ClassSummary";
import { emptyClassOverview, type ClassOverview } from "./classOverview";
import type { ClassOverviewService } from "./classOverviewService";
import type { AssignmentService } from "./assignmentService";

import { readLegacyClasses, type Course, type ClassService } from "./classService";
import type { NoteService } from "./noteService";
import { serviceErrorMessage } from "../../lib/serviceError";
import { peekRead } from "../../apps/navigationCache";
import { useWorkspaceRevision } from "../../apps/workspaceStore";
import { useColdLoad } from "../../apps/coldLoad";
import { useLocalToday } from "../todos/useLocalToday";

export function ClassesPage({
  userId,
  courseId,
  driveService,
  assignmentService,
  classService,
  noteService,
  overviewService,
  timezone,
  onClassesChanged,
}: {
  userId: string;
  courseId?: string;
  driveService?: DriveService;
  assignmentService?: AssignmentService;
  classService?: ClassService;
  noteService?: NoteService;
  /** Totals behind every row of the class list. The page works without it. */
  overviewService?: ClassOverviewService;
  timezone?: string;
  /** Task forms list classes by name; a create or rename refreshes those choices. */
  onClassesChanged?: () => void;
}) {
  const [cachedCourses] = useState(() =>
    classService ? peekRead(classService, "list", userId, new AbortController().signal) : undefined,
  );
  const [courses, setCourses] = useState<Course[]>(cachedCourses ?? []);
  const [loaded, setLoaded] = useState(cachedCourses !== undefined);
  // Tracks whether a real snapshot (seeded from cache, or resolved from
  // list()) exists, so a genuinely empty class list doesn't flash "Loading
  // classes…" on refresh just because courses.length is 0.
  const hasSnapshot = useRef(cachedCourses !== undefined);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ course: Course; isNew: boolean } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const navigate = useNavigate();
  const course = courses.find((c) => c.id === courseId);
  // Sampled, not computed once: a page left open past local midnight has to
  // re-label "Due tomorrow" as "Due today" on its own.
  const today = useLocalToday(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  useColdLoad(!loaded && !error);
  useEffect(() => {
    const controller = new AbortController();
    // Don't flash the loading state when a cached list is already seeded/present.
    setLoaded(hasSnapshot.current);
    setError("");
    setWarning("");
    void (async () => {
      if (!classService) throw new Error("Class storage is unavailable. Reload to try again.");
      try {
        let legacy;
        try {
          legacy = readLegacyClasses(userId);
        } catch {
          throw new Error(
            "Browser classes couldn’t be read. The original data is unchanged; your account classes are still available.",
          );
        }
        await classService.importLegacy(legacy, controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted)
          setWarning(serviceErrorMessage(cause, "Browser classes could not be imported."));
      }
      const rows = await classService.list(userId, controller.signal);
      if (!controller.signal.aborted) {
        setCourses(rows);
        hasSnapshot.current = true;
        setLoaded(true);
      }
    })().catch((cause) => {
      if (!controller.signal.aborted)
        setError(serviceErrorMessage(cause, "Couldn’t load classes. Try again."));
    });
    return () => controller.abort();
  }, [userId, courseId, classService, reload]);
  useEffect(() => () => pending.current?.abort(), [userId, classService]);
  async function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classService || !editing || pending.current) return;
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    if (
      courses.some(
        (c) => c.id !== editing.course.id && c.name?.toLowerCase() === name.toLowerCase(),
      )
    ) {
      setError("That class already exists. Choose a different class name.");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setError("");
    try {
      const saved = editing.isNew
        ? await classService.create(userId, { id: editing.course.id, name }, controller.signal)
        : await classService.rename(userId, editing.course, name, controller.signal);
      if (controller.signal.aborted) return;
      onClassesChanged?.();
      setCourses((rows) => [...rows.filter((c) => c.id !== saved.id), saved]);
      setEditing(null);
      navigate(`/classes/${saved.id}`);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(serviceErrorMessage(cause, "Couldn’t save this class. Try again."));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setSaving(false);
      }
    }
  }
  return (
    <section className="workspace-page classes-page">
      {courseId && (
        <Link className="classes-back" to="/classes">
          <WorkspaceIcon name="left" />
          All classes
        </Link>
      )}
      {!loaded ? (
        <>
          <h1>Classes</h1>
          {!error && (
            <p className="cloud-shell__sr-only" role="status">
              Loading classes…
            </p>
          )}
        </>
      ) : courseId && !course ? (
        <>
          <h1>Class not found</h1>
          <p>This class isn’t in your account. Return to Classes to check your saved classes.</p>
        </>
      ) : course ? (
        <ClassDetail
          key={course.id}
          userId={userId}
          course={course}
          driveService={driveService}
          assignmentService={assignmentService}
          noteService={noteService}
          timezone={timezone}
          onEdit={() => {
            setError("");
            setEditing({ course, isNew: false });
          }}
        />
      ) : (
        <>
          <header className="classes-heading workspace-page-header">
            <h1>Classes</h1>
            <button
              className="workspace-page-header__action"
              onClick={() => {
                setError("");
                setEditing({
                  course: { id: crypto.randomUUID(), name: "", updatedAt: "" },
                  isNew: true,
                });
              }}
            >
              <WorkspaceIcon name="plus" />
              Add class
            </button>
          </header>
          {!courses.length && (
            <p className="classes-empty">
              No classes yet. Add a class to save assignments and notes.
            </p>
          )}
          <ClassList
            courses={courses}
            userId={userId}
            service={overviewService}
            today={today}
            reload={reload}
          />
        </>
      )}
      {warning && (
        <div className="workspace-error">
          <p role="alert">{warning}</p>
          <button onClick={() => setReload((v) => v + 1)}>Retry import</button>
        </div>
      )}
      {error && !editing && (
        <div className="workspace-error">
          <p role="alert">{error}</p>
          <button onClick={() => setReload((v) => v + 1)}>Reload classes</button>
        </div>
      )}
      {editing && (
        <WorkspaceDialog
          title={editing.isNew ? "Add class" : "Edit class"}
          onClose={() => {
            if (!saving) {
              setEditing(null);
              setError("");
              setReload((v) => v + 1);
            }
          }}
        >
          <form className="classes-form" onSubmit={(event) => void saveCourse(event)}>
            <label>
              Class name
              <input
                name="name"
                required
                maxLength={120}
                placeholder="MATH3012"
                defaultValue={editing.course.name ?? ""}
                disabled={saving}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save class"}
            </button>
          </form>
        </WorkspaceDialog>
      )}
    </section>
  );
}

/**
 * Every class with its own standing: what is due next, what is still open, and
 * how many notes are saved. Totals arrive after the names, so the list is
 * readable immediately and never shifts when they land.
 */
function ClassList({
  courses,
  userId,
  service,
  today,
  reload,
}: {
  courses: Course[];
  userId: string;
  service?: ClassOverviewService;
  today: string;
  reload: number;
}) {
  const [cached] = useState(() =>
    service ? peekRead(service, "list", userId, new AbortController().signal) : undefined,
  );
  const [overviews, setOverviews] = useState<Record<string, ClassOverview> | undefined>(cached);
  // A task saved from the global Add dialog is an assignment when it carries a
  // class, and it lands while this list is mounted. The store's revision is how
  // a visible page hears about a write it did not make.
  const revision = useWorkspaceRevision();
  useEffect(() => {
    if (!service) return;
    const controller = new AbortController();
    // Totals are supporting detail: a failed read leaves the names usable and
    // says nothing rather than pushing an error at the page.
    void service
      .list(userId, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setOverviews(rows);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [userId, service, reload, revision]);
  if (!courses.length) return null;
  return (
    <div className="classes-list">
      {courses.map((c) => (
        <Link key={c.id} to={`/classes/${c.id}`} className="classes-row">
          <WorkspaceIcon name="classes" />
          <div>
            <h2>{c.name ?? "Recovered class"}</h2>
            {overviews ? (
              <ClassSummary
                overview={overviews[c.id] ?? emptyClassOverview}
                today={today}
                variant="row"
              />
            ) : (
              <p>Open class</p>
            )}
          </div>
          <WorkspaceIcon name="right" />
        </Link>
      ))}
    </div>
  );
}
