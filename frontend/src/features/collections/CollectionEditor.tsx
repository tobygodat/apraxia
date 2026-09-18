import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Dialog } from "../../components/dialog/Dialog";
import type { Idea, Project, ProjectSummary } from "../../types/domain";
import type { CollectionKind, CollectionRecord, CollectionService } from "./collectionService";
import "../todos/TodoFormDialog.css";
import "./collections.css";
export interface CollectionEditorProps {
  kind: CollectionKind;
  record?: CollectionRecord;
  projectId?: string;
  service: CollectionService;
  projects: readonly ProjectSummary[];
  onSaved: (record: CollectionRecord) => void;
  onClose: () => void;
}
export function CollectionEditor({
  kind,
  record,
  projectId,
  service,
  projects,
  onSaved,
  onClose,
}: CollectionEditorProps) {
  const id = useId();
  const saveButton = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState(record?.title ?? "");
  const [body, setBody] = useState(
    kind === "idea" ? ((record as Idea)?.body ?? "") : ((record as Project)?.description ?? ""),
  );
  const [selectedProject, setProject] = useState((record as Idea)?.projectId ?? projectId ?? "");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function field(label: string, control: ReactNode) {
    return (
      <label className="collection-field">
        <span>{label}</span>
        {control}
      </label>
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (!(kind === "idea" ? body : title).trim()) {
      setError(kind === "idea" ? "Add some text to your idea." : "Add a title.");
      return;
    }
    submitting.current = true;
    saveButton.current?.focus();
    setBusy(true);
    setError("");
    try {
      const saved =
        kind === "project"
          ? await service.saveProject(
              { title, description: body, status: (record as Project)?.status ?? "active" },
              record?.id,
            )
          : await service.saveIdea({ title, body, projectId: selectedProject || null }, record?.id);
      if (alive.current) onSaved(saved);
    } catch {
      if (alive.current) setError("Couldn’t save. Your details are still here; try again.");
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Dialog
      labelledBy={`${id}-title`}
      busy={busy}
      closeLocked={busy}
      onClose={onClose}
      className="todo-dialog collection-editor"
      backdropClassName="todo-dialog-backdrop"
    >
      <header className="todo-dialog__header">
        <h2 id={`${id}-title`}>
          {record ? "Edit" : "Add"} {kind}
        </h2>
      </header>
      <form className="todo-dialog__form" onSubmit={save}>
        {kind === "idea" &&
          field(
            "Idea",
            <textarea
              data-autofocus
              required
              rows={7}
              value={body}
              disabled={busy}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Keep the thought here."
            />,
          )}
        {field(
          kind === "idea" ? "Title (optional)" : "Title",
          <input
            data-autofocus={kind !== "idea" ? true : undefined}
            required={kind !== "idea"}
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />,
        )}
        {kind !== "idea" && (
          <>
            {field(
              "Description (optional)",
              <textarea
                rows={4}
                value={body}
                disabled={busy}
                onChange={(e) => setBody(e.target.value)}
              />,
            )}
          </>
        )}
        {kind === "idea" &&
          field(
            "Project (optional)",
            <select
              value={selectedProject}
              disabled={busy}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">No project</option>
              {selectedProject && !projects.some((p) => p.id === selectedProject) && (
                <option value={selectedProject} disabled>
                  Current project (unavailable)
                </option>
              )}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>,
          )}
        {error && (
          <p className="todo-dialog__submit-error" role="alert">
            {error}
          </p>
        )}
        <footer className="todo-dialog__actions">
          <button
            type="button"
            className="todo-dialog__button todo-dialog__button--quiet"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            ref={saveButton}
            type="submit"
            className="todo-dialog__button todo-dialog__button--primary"
            aria-disabled={busy}
          >
            {busy ? "Saving…" : record ? "Save changes" : `Add ${kind}`}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
