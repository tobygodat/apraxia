import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { WorkspaceDialog } from "../../apps/WorkspaceDialog";
import type { DriveService } from './driveService';
import "./classes.css";

import { ClassAssignments } from "./ClassAssignments";
import type { AssignmentService } from "./assignmentService";

const PdfReader = lazy(() => import("./PdfReader"));

import { readLegacyClasses, type Course, type ClassService } from './classService';
import { SavedClassNotes } from './SavedClassNotes';
import type { NoteService } from './noteService';

export function ClassesPage({ userId, courseId, driveService, assignmentService, classService, noteService, timezone }: {
  userId: string; courseId?: string; driveService?: DriveService; assignmentService?: AssignmentService;
  classService?: ClassService; noteService?: NoteService; timezone?: string;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ course: Course; isNew: boolean } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const navigate = useNavigate();
  const course = courses.find(c => c.id === courseId);
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false); setError(''); setWarning('');
    void (async () => {
      if (!classService) throw new Error('Class storage is unavailable. Reload to try again.');
      try {
        let legacy;
        try { legacy = readLegacyClasses(userId); }
        catch { throw new Error('Browser classes couldn’t be read. The original data is unchanged; your account classes are still available.'); }
        await classService.importLegacy(legacy, controller.signal);
      } catch (cause) { if (!controller.signal.aborted) setWarning(cause instanceof Error ? cause.message : 'Browser classes could not be imported.'); }
      const rows = await classService.list(userId, controller.signal);
      if (!controller.signal.aborted) { setCourses(rows); setLoaded(true); }
    })().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Couldn’t load classes. Try again.'); });
    return () => controller.abort();
  }, [userId, courseId, classService, reload]);
  useEffect(() => () => pending.current?.abort(), [userId, classService]);
  async function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classService || !editing || pending.current) return;
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    if (courses.some(c => c.id !== editing.course.id && c.name?.toLowerCase() === name.toLowerCase())) { setError('That class already exists. Choose a different class name.'); return; }
    const controller = new AbortController(); pending.current = controller; setSaving(true); setError('');
    try {
      const saved = editing.isNew
        ? await classService.create(userId, { id: editing.course.id, name }, controller.signal)
        : await classService.rename(userId, editing.course, name, controller.signal);
      if (controller.signal.aborted) return;
      setCourses(rows => [...rows.filter(c => c.id !== saved.id), saved]); setEditing(null); navigate(`/classes/${saved.id}`);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Couldn’t save this class. Try again.'); }
    finally { if (pending.current === controller) { pending.current = null; setSaving(false); } }
  }
  return <section className="workspace-page classes-page">
    {courseId && <Link className="classes-back" to="/classes"><WorkspaceIcon name="left" />All classes</Link>}
    {!loaded ? <><h1>Classes</h1>{!error && <p role="status">Loading classes…</p>}</> : courseId && !course ?
      <><h1>Class not found</h1><p>This class isn’t in your account. Return to Classes to check your saved classes.</p></> : <>
      <header className="classes-heading"><h1>{course ? course.name ?? 'Recovered class' : 'Classes'}</h1>
        <button onClick={() => { setError(''); setEditing({ course: course ?? { id: crypto.randomUUID(), name: '', updatedAt: '' }, isNew: !course }); }}><WorkspaceIcon name={course ? 'edit' : 'plus'} />{course ? 'Edit class' : 'Add class'}</button>
      </header>
      {course ? <div key={course.id} className="classes-course-content">
        {course.name === null && <p>This class was recovered from its assignments. Edit its name, or open the browser where you originally saved it to recover the name.</p>}
        {assignmentService && <ClassAssignments userId={userId} courseId={course.id} service={assignmentService} timezone={timezone} />}
        <h2>Notes</h2>
        {noteService ? <SavedClassNotes userId={userId} course={course} service={noteService} driveService={driveService}
          renderReader={file => <CourseNotes course={course} file={file} />} /> : <p role="alert">Note storage is unavailable. Reload to try again.</p>}
      </div> : <>
        {!courses.length && <p>No classes yet. Add a class to save assignments and notes.</p>}
        <div className="classes-list">{courses.map(c => <Link key={c.id} to={`/classes/${c.id}`} className="classes-row"><WorkspaceIcon name="classes" /><div><h2>{c.name ?? 'Recovered class'}</h2><p>Open class</p></div><WorkspaceIcon name="right" /></Link>)}</div>
      </>}
    </>}
    {warning && <div><p role="alert">{warning}</p><button onClick={() => setReload(v => v + 1)}>Retry import</button></div>}
    {error && !editing && <div><p role="alert">{error}</p><button onClick={() => setReload(v => v + 1)}>Reload classes</button></div>}
    {editing && <WorkspaceDialog title={editing.isNew ? 'Add class' : 'Edit class'} onClose={() => { if (!saving) { setEditing(null); setError(''); setReload(v => v + 1); } }}>
      <form className="classes-form" onSubmit={event => void saveCourse(event)}>
        <label>Class name<input name="name" required maxLength={120} placeholder="MATH3012" defaultValue={editing.course.name ?? ''} disabled={saving} /></label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save class'}</button>
      </form>
    </WorkspaceDialog>}
  </section>;
}

function CourseNotes({ course, file: preview }: { course: Course; file: File }) {
  const [error, setError] = useState('');
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
    } catch { setError("Full screen isn’t available in this browser. Try opening the workspace in another browser."); }
  }
  return <>
    <div className="classes-notes-layout classes-notes-layout--reading">
      <section ref={reader} className="classes-reader" aria-label={`${course.name ?? 'Recovered class'} notes reader`}>
        {preview && <header><span title={preview.name}>{preview.name}</span><div>
          <button className="classes-reader-tools" type="button" onClick={() => setShowTools(value => !value)} aria-label={showTools ? "Hide PDF toolbar" : "Show PDF toolbar"} aria-expanded={showTools} title={`${showTools ? "Hide" : "Show"} PDF toolbar`}>
            <WorkspaceIcon name="down" />
          </button>
          <button className="classes-reader-fullscreen" type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit full screen" : "Full screen"} title={fullscreen ? "Exit full screen" : "Full screen"}>
            <WorkspaceIcon name={fullscreen ? "minimize" : "maximize"} />
          </button>
        </div></header>}
        {error && <p role="alert">{error}</p>}
        <Suspense fallback={<p role="status">Loading PDF reader…</p>}><PdfReader file={preview} showTools={showTools} /></Suspense>
      </section>
    </div>

  </>;
}
