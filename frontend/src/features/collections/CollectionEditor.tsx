import { type FormEvent, type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Idea, MediaItem, MediaStatus, MediaType, Project, ProjectStatus, ProjectSummary } from "../../types/domain";
import { CollectionConflictError, type CollectionKind, type CollectionRecord, type CollectionService } from "./collectionService";
import type { NewIdeaInput, NewMediaInput, NewProjectInput } from "../../types/domain";
import "../todos/TodoComposerDialog.css";
import "./collections.css";
import { newDraftId, withDraftId, withExpectedUpdatedAt } from "../../lib/writeIntent";
export interface CollectionEditorProps {
    kind: CollectionKind;
    record?: CollectionRecord;
    projectId?: string;
    service: CollectionService;
    projects: readonly ProjectSummary[];
    onSaved: (record: CollectionRecord) => void;
    onClose: () => void;
}
export function CollectionEditor({ kind, record, projectId, service, projects, onSaved, onClose }: CollectionEditorProps) {
    const id = useId();
    const dialog = useRef<HTMLDivElement>(null);
    const saveButton = useRef<HTMLButtonElement>(null);
    const submitting = useRef(false);
    const alive = useRef(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [conflict, setConflict] = useState(false);
    const [title, setTitle] = useState(record?.title ?? "");
    const [body, setBody] = useState(kind === "idea" ? (record as Idea)?.body ?? "" : kind === "project" ? (record as Project)?.description ?? "" : (record as MediaItem)?.notes ?? "");
    const [selectedProject, setProject] = useState((record as Idea)?.projectId ?? projectId ?? "");
    const [status, setStatus] = useState((record as Project | MediaItem)?.status ?? (kind === "project" ? "active" : "saved"));
    const [mediaType, setMediaType] = useState<MediaType>((record as MediaItem)?.mediaType ?? "book");
    const [creator, setCreator] = useState((record as MediaItem)?.creator ?? "");
    const [year, setYear] = useState(String((record as MediaItem)?.releaseYear ?? ""));
    const [rating, setRating] = useState(String((record as MediaItem)?.rating ?? ""));
    const draftId = useRef(newDraftId());
    useLayoutEffect(() => {
        alive.current = true;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const overflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        dialog.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
        return () => { alive.current = false; document.body.style.overflow = overflow; if (previous?.isConnected)
            previous.focus(); };
    }, []);
    function field(label: string, control: ReactNode) { return <label className="collection-field"><span>{label}</span>{control}</label>; }
    async function save(event: FormEvent) {
        event.preventDefault();
        if (submitting.current)
            return;
        if (!(kind === "idea" ? body : title).trim()) {
            setError(kind === "idea" ? "Add some text to your idea." : "Add a title.");
            return;
        }
        submitting.current = true;
        saveButton.current?.focus();
        setBusy(true);
        setError("");
        setConflict(false);
        try {
            const input = kind === "project"
                ? { title, description: body, status: status as ProjectStatus }
                : kind === "idea"
                    ? { title, body, projectId: selectedProject || null }
                    : { title, mediaType, creator, releaseYear: year ? Number(year) : null, rating: rating ? Number(rating) : null, notes: body, status: status as MediaStatus };
            const prepared = record ? withExpectedUpdatedAt(input, record.updatedAt) : withDraftId(input, draftId.current);
            const saved = kind === "project" ? await service.saveProject(prepared as NewProjectInput, record?.id) : kind === "idea" ? await service.saveIdea(prepared as NewIdeaInput, record?.id) : await service.saveMedia(prepared as NewMediaInput, record?.id);
            if (alive.current)
                onSaved(saved);
        }
        catch (reason) {
            if (alive.current)
                { const isConflict = reason instanceof CollectionConflictError || (typeof reason === "object" && reason !== null && "code" in reason && reason.code === "collection_conflict"); setConflict(isConflict); setError(isConflict ? "This record changed in another tab. Your details are still here; reload the latest version before replacing them." : "Couldn’t save. Your details are still here; try again."); }
        }
        finally {
            submitting.current = false;
            if (alive.current)
                setBusy(false);
        }
    }
    async function reloadLatest() {
        if (!record) {
            onClose();
            return;
        }
        setBusy(true);
        setError("");
        try {
            const latest = kind === "project" ? await service.getProject(record.id) : kind === "idea" ? await service.getIdea(record.id) : await service.getMedia(record.id);
            setTitle(latest.title || "");
            setBody((kind === "idea" ? (latest as Idea).body : kind === "project" ? (latest as Project).description : (latest as MediaItem).notes) ?? "");
            setProject((latest as Idea).projectId ?? "");
            setStatus((latest as Project | MediaItem).status ?? (kind === "project" ? "active" : "saved"));
            setMediaType((latest as MediaItem).mediaType ?? "book");
            setCreator((latest as MediaItem).creator ?? "");
            setYear(String((latest as MediaItem).releaseYear ?? ""));
            setRating(String((latest as MediaItem).rating ?? ""));
            setConflict(false);
        } catch {
            setError("The latest record could not be loaded. Try again.");
        } finally {
            setBusy(false);
        }
    }
    return createPortal(<div className="todo-dialog-backdrop"><div className="todo-dialog collection-editor" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={busy} ref={dialog} tabIndex={-1} onKeyDown={event => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                if (!submitting.current)
                    onClose();
            }
            if (event.key === "Tab") {
                const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)") ?? []);
                const first = controls[0], last = controls[controls.length - 1];
                if (!first) {
                    event.preventDefault();
                    dialog.current?.focus();
                }
                else if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                }
                else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        }}>
    <header className="todo-dialog__header"><h2 id={`${id}-title`}>{record ? "Edit" : "Add"} {kind}</h2></header>
    <form className="todo-dialog__form" onSubmit={save}>
      {kind === "idea" && field("Idea", <textarea data-initial-focus required rows={7} value={body} disabled={busy} onChange={e => setBody(e.target.value)} placeholder="Keep the thought here."/>)}
      {field(kind === "idea" ? "Title (optional)" : "Title", <input data-initial-focus={kind !== "idea" ? true : undefined} required={kind !== "idea"} value={title} disabled={busy} onChange={e => setTitle(e.target.value)}/>)}
      {kind === "media" && <div className="todo-dialog__details">
        {field("Type", <select value={mediaType} disabled={busy} onChange={e => setMediaType(e.target.value as MediaType)}><option value="book">Book</option><option value="movie">Movie</option></select>)}
        {field("Creator (optional)", <input value={creator} disabled={busy} onChange={e => setCreator(e.target.value)}/>)}
        {field("Release year (optional)", <input type="number" step="1" value={year} disabled={busy} onChange={e => setYear(e.target.value)}/>)}
        {field("Rating (optional)", <select value={rating} disabled={busy} onChange={e => setRating(e.target.value)}><option value="">Unrated</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} {n === 1 ? "star" : "stars"}</option>)}{rating && !["1", "2", "3", "4", "5"].includes(rating) && <option value={rating}>Saved rating: {rating}</option>}</select>)}
      </div>}
      {kind !== "idea" && <>{field("Status", <select value={status} disabled={busy} onChange={e => setStatus(e.target.value as ProjectStatus | MediaStatus)}>{(kind === "project" ? ["active", "someday", "completed", "archived"] : ["saved", "in_progress", "finished"]).map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>)}{field(kind === "project" ? "Description (optional)" : "Notes (optional)", <textarea rows={4} value={body} disabled={busy} onChange={e => setBody(e.target.value)}/>)}</>}
      {kind === "idea" && field("Project (optional)", <select value={selectedProject} disabled={busy} onChange={e => setProject(e.target.value)}><option value="">No project</option>{selectedProject && !projects.some(p => p.id === selectedProject) && <option value={selectedProject} disabled>Current project (unavailable)</option>}{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select>)}
      {error && <p className="todo-dialog__submit-error" role="alert">{error}</p>}
      {conflict && <button type="button" className="todo-dialog__button" disabled={busy} onClick={() => { if (window.confirm("Replace your draft with the latest saved version?")) void reloadLatest(); }}>Reload latest</button>}
      <footer className="todo-dialog__actions"><button type="button" className="todo-dialog__button todo-dialog__button--quiet" disabled={busy} onClick={onClose}>Cancel</button><button ref={saveButton} type="submit" className="todo-dialog__button todo-dialog__button--primary" aria-disabled={busy}>{busy ? "Saving…" : record ? "Save changes" : `Add ${kind}`}</button></footer>
    </form>
  </div></div>, document.body);
}
