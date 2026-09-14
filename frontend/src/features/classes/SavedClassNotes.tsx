import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DriveNotes } from './DriveNotes';
import type { DriveService, DriveFile } from './driveService';
import type { Course } from './classService';
import { prepareUpload, type ClassNote, type NoteService, type UploadDraft } from './noteService';

export function SavedClassNotes({ userId, course, service, driveService, renderReader }: {
  userId: string; course: Course; service: NoteService; driveService?: DriveService; renderReader(file: File): ReactNode;
}) {
  const [notes, setNotes] = useState<ClassNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ id: string; file: File } | null>(null);
  const [draft, setDraft] = useState<{ file: File; value: UploadDraft } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const resume = useRef<ClassNote | null>(null);
  const add = (note: ClassNote) => setNotes(rows => [...rows.filter(n => n.id !== note.id), note]);
  async function run(label: string, work: (signal: AbortSignal) => Promise<void>) {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(label); setError('');
    try { await work(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Couldn’t save notes. Try again.'); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(''); } }
  }
  const refresh = () => run('Loading notes…', async signal => {
    const rows = await service.list(userId, course.id, signal);
    if (!signal.aborted) { setNotes(rows); setLoaded(true); }
  });
  useEffect(() => { void refresh(); return () => { pending.current?.abort(); pending.current = null; }; }, [service, userId, course.id]);
  async function upload(file: File, existing?: UploadDraft) {
    await run('Saving PDF…', async signal => {
      const value = existing ?? await prepareUpload(file, resume.current?.id);
      signal.throwIfAborted();
      setDraft({ file, value });
      const note = await service.reserve(userId, course.id, value, signal);
      if (!signal.aborted) add(note);
      const saved = await service.upload(note, file, signal);
      if (!signal.aborted) { add(saved); setDraft(null); resume.current = null; setPreview({ id: saved.id, file }); }
    });
  }
  function choose(note: ClassNote | null = null) {
    resume.current = note; fileInput.current?.click();
  }
  async function open(note: ClassNote) {
    await run(`Opening ${note.name}…`, async signal => {
      let file: File;
      if (note.source === 'drive') {
        if (!driveService || !note.drive_file_id) throw new Error('Connect Google Drive to open this note.');
        file = await driveService.pdf({ id: note.drive_file_id, name: note.name, folder: false, modifiedTime: null, size: null }, signal);
      } else file = await service.download(note, signal);
      if (!signal.aborted) setPreview({ id: note.id, file });
    });
  }
  async function attach(file: DriveFile, pdf: File, signal: AbortSignal) {
    const note = await service.attachDrive(userId, course.id, file, signal);
    if (!signal.aborted) { add(note); setPreview({ id: note.id, file: pdf }); }
  }
  return <>
    <input ref={fileInput} className="cloud-shell__sr-only" type="file" accept="application/pdf,.pdf" tabIndex={-1} aria-label="Choose PDF" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file);
    }} />
    {driveService && <DriveNotes userId={userId} courseId={course.id} service={driveService} disabled={!!busy || !loaded}
      onSelect={attach} onPreview={() => setPreview(current => notes.find(n => n.id === current?.id)?.source === 'drive' ? null : current)} onChooseLocal={() => choose()} />}
    {!driveService && <button disabled={!!busy || !loaded} onClick={() => choose()}>Upload PDF</button>}
    <p className="classes-note-hint">Device PDFs are saved privately to your account. Up to 50 MB per file.</p>
    {busy && <p role="status">{busy}</p>}
    {error && <div className="classes-note-error"><p role="alert">{error}</p>
      {draft ? <button disabled={!!busy} onClick={() => void upload(draft.file, draft.value)}>Retry upload</button> : <button disabled={!!busy} onClick={() => void refresh()}>Reload notes</button>}
    </div>}
    {loaded && !notes.length && <p>No saved notes yet.</p>}
    {notes.length > 0 && <ul className="classes-saved-notes" aria-label="Saved notes">{notes.map(note => {
      const incomplete = note.source === 'upload' && !note.uploaded_at;
      return <li key={note.id}>
        <div>{incomplete ? <span>{note.name}</span> : <button disabled={!!busy} aria-pressed={preview?.id === note.id} onClick={() => void open(note)}>{note.name}</button>}
          <small>{incomplete ? 'Upload incomplete' : note.source === 'drive' ? 'Google Drive' : 'Saved PDF'}</small></div>
        {incomplete && <div className="classes-note-actions"><button disabled={!!busy} onClick={() => void run('Finishing save…', async signal => {
          const saved = await service.finish(note, signal); if (!signal.aborted) { add(saved); if (draft?.value.id === note.id) setDraft(null); }
        })}>Finish saving</button><button disabled={!!busy} onClick={() => choose(note)}>Choose PDF again</button></div>}
      </li>;
    })}</ul>}
    {preview && <div key={preview.id}>{renderReader(preview.file)}</div>}
  </>;
}
