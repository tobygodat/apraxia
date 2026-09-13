import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { WorkspaceDialog } from "../../apps/WorkspaceDialog";
import { DriveNotes } from './DriveNotes';
import type { DriveService } from './driveService';
import "./classes.css";

import { ClassAssignments } from "./ClassAssignments";
import type { AssignmentService } from "./assignmentService";

const PdfReader = lazy(() => import("./PdfReader"));

interface Course { id: string; name: string }
const initialCourses: Course[] = [{ id: "math3012", name: "MATH3012" }];
const storageKey = (userId: string) => `orbitos:classes:v1:${userId}`;

function readCourses(userId: string): Course[] {
  const stored: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "null");
  if (stored === null) return initialCourses;
  if (!Array.isArray(stored) || !stored.every(c => c && typeof c.id === "string" && (typeof c.code === "string" || typeof c.name === "string"))) throw new Error("Invalid saved classes");
  // Older browser records used the code as the primary class label.
  return stored.map(c => ({ id: c.id, name: typeof c.code === "string" ? c.code : c.name }));
}

export function ClassesPage({ userId, courseId, driveService, assignmentService, timezone }: { userId: string; courseId?: string; driveService?: DriveService; assignmentService?: AssignmentService; timezone?: string }) {
  const [loaded] = useState(() => { try { return { courses: readCourses(userId), error: "" }; } catch { return { courses: initialCourses, error: "Saved classes couldn’t be read. Reload to try again; changes won’t be saved until storage is available." }; } });
  const [courses, setCourses] = useState(loaded.courses);
  const [error, setError] = useState(loaded.error);
  const [editing, setEditing] = useState<Course | "new" | null>(null);
  const navigate = useNavigate();
  const course = courses.find(c => c.id === courseId);

  function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    const id = editing && editing !== "new" ? editing.id : crypto.randomUUID();
    if (courses.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) { setError("That class already exists. Choose a different class name."); return; }
    const value = { id, name };
    const next = courses.some(c => c.id === id) ? courses.map(c => c.id === id ? value : c) : [...courses, value];
    try {
      if (loaded.error) throw new Error("Unavailable storage");
      localStorage.setItem(storageKey(userId), JSON.stringify(next));
    } catch { setError("Couldn’t save this class in your browser. Check browser storage permissions and try again."); return; }
    setCourses(next); setError(""); setEditing(null); navigate(`/classes/${id}`);
  }

  return <section className="workspace-page classes-page">
    {courseId && <Link className="classes-back" to="/classes"><WorkspaceIcon name="left" />All classes</Link>}
    {courseId && !course ? <><h1>Class not found</h1><p>This class isn’t saved in this browser. Return to Classes to add it.</p></> : <>
      <header className="classes-heading"><div><h1>{course ? course.name : "Classes"}</h1></div>
        <button onClick={() => { setError(loaded.error); setEditing(course ?? "new"); }}><WorkspaceIcon name={course ? "edit" : "plus"} />{course ? "Edit class" : "Add class"}</button>
      </header>
      {course ? <div key={course.id} className="classes-course-content">{assignmentService && <><ClassAssignments userId={userId} courseId={course.id} service={assignmentService} timezone={timezone} /><h2>Notes</h2></>}<CourseNotes course={course} userId={userId} driveService={driveService} compact={!!assignmentService} /></div> : <>
        <div className="classes-list">{courses.map(c => <Link key={c.id} to={`/classes/${c.id}`} className="classes-row"><WorkspaceIcon name="classes" /><div><h2>{c.name}</h2><p>Open class</p></div><WorkspaceIcon name="right" /></Link>)}</div>
        <p className="classes-local-note">Classes are saved in this browser only.</p>
      </>}
    </>}
    {error && !editing && <p role="alert">{error}</p>}
    {editing && <WorkspaceDialog title={editing === "new" ? "Add class" : "Edit class"} onClose={() => { setEditing(null); setError(loaded.error); }}>
      <form className="classes-form" onSubmit={saveCourse}>
        <label>Class name<input name="name" required maxLength={120} placeholder="MATH3012" defaultValue={editing === "new" ? "" : editing.name} /></label>
        <p>Saved in this browser only.</p>{error && <p role="alert">{error}</p>}
        <button type="submit">Save class</button>
      </form>
    </WorkspaceDialog>}
  </section>;
}

function CourseNotes({ course, userId, driveService, compact = false }: { course: Course; userId: string; driveService?: DriveService; compact?: boolean }) {
  const [preview, setPreview] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const reader = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === reader.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === reader.current) await document.exitFullscreen();
      else await reader.current?.requestFullscreen();
    } catch { setError("Full screen isn’t available in this browser. Try opening the workspace in another browser."); }
  }
  return <>
    <input ref={fileInput} className="cloud-shell__sr-only" type="file" accept="application/pdf,.pdf" tabIndex={-1} aria-label="Choose PDF" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) { setError("Choose a PDF exported from Goodnotes."); return; }
      setError(""); setShowTools(false); setPreview(file);
    }} />
    {!driveService && compact && !preview && <div className="classes-compact-source"><p>Open a PDF to start reading.</p><button onClick={() => fileInput.current?.click()}>From device</button></div>}
    {compact && !preview && error && <p role="alert">{error}</p>}
    {driveService && <DriveNotes userId={userId} courseId={course.id} service={driveService} onPreview={setPreview} onChooseLocal={compact ? () => fileInput.current?.click() : undefined} />}
    {(!compact || preview) && <div className={`classes-notes-layout${preview ? " classes-notes-layout--reading" : ""}`}>
      <section ref={reader} className="classes-reader" aria-label={`${course.name} notes reader`}>
        {preview && <header><span title={preview.name}>{preview.name}</span><div>
          <button className="classes-reader-tools" type="button" onClick={() => setShowTools(value => !value)} aria-label={showTools ? "Hide PDF toolbar" : "Show PDF toolbar"} aria-expanded={showTools} title={`${showTools ? "Hide" : "Show"} PDF toolbar`}>
            <WorkspaceIcon name="down" />
          </button>
          <button className="classes-reader-fullscreen" type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen" : "Full screen"}>
            <WorkspaceIcon name={fullscreen ? "minimize" : "maximize"} />
          </button>
        </div></header>}
        {error && <p role="alert">{error}</p>}
        {preview ? <Suspense fallback={<p role="status">Loading PDF reader…</p>}><PdfReader file={preview} showTools={showTools} /></Suspense> : <div className="classes-reader-empty"><h2>{driveService ? "Choose a PDF to read" : "No notes yet"}</h2><button onClick={() => fileInput.current?.click()}>Preview a PDF</button><p>Choose a PDF from your device. Previews aren’t uploaded or saved.</p></div>}
      </section>
    </div>}

  </>;
}
