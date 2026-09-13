import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AssignmentTypePicker } from "./AssignmentTypePicker";
import { AssignmentDatePicker } from "./AssignmentDatePicker";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { localToday } from "../todos/dateDomain";
import "./classAssignments.css";

import type { Assignment, AssignmentPatch, AssignmentService } from "./assignmentService";
type Field = "title" | "due" | "type";
const fields: Field[] = ["title", "due", "type"];

function AssignmentEditorRow({ item, field, isNew, onSave, onCancel, today }: {
  item: Assignment; field: Field; isNew: boolean; today: string;
  onSave(item: Assignment, focus: Field | null): Promise<void>;
  onCancel(): void;
}) {
  const [draft, setDraft] = useState(item);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  const controls = useRef<Partial<Record<Field, HTMLInputElement | HTMLButtonElement>>>({});
  const finishing = useRef(false);
  const errorId = useId();
  useLayoutEffect(() => { controls.current[field]?.focus(); }, [field]);

  async function save(focus: Field | null) {
    if (finishing.current) return;
    const invalid = !draft.title.trim() ? { field: "title" as const, message: "Name required" } : null;
    if (invalid) {
      setError(invalid);
      controls.current[invalid.field]?.focus();
      return;
    }
    finishing.current = true;
    setSaving(true);
    try { await onSave({ ...draft, title: draft.title.trim() }, focus); }
    catch (failure) {
      finishing.current = false;
      setError({ field: "title", message: failure instanceof Error ? failure.message : "Couldn’t save assignment. Try again." });
      setSaving(false);
    }
  }
  function cancel() { if (finishing.current) return; finishing.current = true; onCancel(); }
  function keyDown(event: KeyboardEvent<HTMLInputElement | HTMLButtonElement>, current: Field) {
    if (finishing.current || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    if (event.key === "Enter" && current === "title") { event.preventDefault(); save(current); }
    if (event.key === "Tab") {
      const next = fields[fields.indexOf(current) + (event.shiftKey ? -1 : 1)];
      if (next) { event.preventDefault(); controls.current[next]?.focus(); }
    }
  }
  return <tr className="assignment-editing" onBlur={event => {
    if (finishing.current || event.currentTarget.contains(event.relatedTarget) || (event.relatedTarget instanceof Element && event.relatedTarget.closest(".assignment-calendar, .assignment-type-menu"))) return;
    if (isNew && !draft.title.trim() && !draft.due && !draft.type) { cancel(); return; }
    save(event.relatedTarget ? null : "title");
  }}>
    <td><span className="assignment-draft-marker" aria-hidden="true" /></td>
    {fields.map(current => {
      const label = isNew ? ({ title: "New assignment", due: "New due date", type: "New type" }[current]) : `Edit ${current} for ${item.title}`;
      if (current === "due") return <td key={current}><AssignmentDatePicker today={today} value={draft.due} label={label}
        disabled={saving} buttonRef={node => { if (node) controls.current.due = node; }}
        onChange={due => setDraft(previous => ({ ...previous, due }))}
        onKeyDown={event => keyDown(event, "due")} /></td>;
      if (current === "type") return <td key={current}><AssignmentTypePicker value={draft.type} label={label}
        disabled={saving} buttonRef={node => { if (node) controls.current.type = node; }}
        onChange={type => setDraft(previous => ({ ...previous, type }))}
        onKeyDown={event => keyDown(event, "type")} /></td>;
      const props = {
        "aria-label": label,
        "aria-invalid": error?.field === current || undefined,
        "aria-describedby": error?.field === current ? errorId : undefined,
        value: draft[current],
        disabled: saving,
        ref: (node: HTMLInputElement | HTMLButtonElement | null) => { if (node) controls.current[current] = node; },
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          setDraft(previous => ({ ...previous, [current]: event.target.value }));
          if (error?.field === current) setError(null);
        },
        onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLButtonElement>) => keyDown(event, current),
      };
      return <td key={current}>
        <div className="assignment-editor-cell">
          <input {...props} type="text" placeholder="Assignment name" maxLength={180} />
        </div>
        {saving && <span role="status">Saving…</span>}
        {error?.field === current && <span id={errorId} className="assignment-field-error" role="alert">{error.message}</span>}
      </td>;
    })}
  </tr>;
}

/** The same account-scoped table is used by the live workspace and QA fixture. */
export function ClassAssignments(props: { userId: string; courseId: string; service: AssignmentService; timezone?: string }) {
  return <AssignmentSession key={`${props.userId}:${props.courseId}`} {...props} />;
}
function AssignmentSession({ userId, courseId, service, timezone }: { userId: string; courseId: string; service: AssignmentService; timezone?: string }) {
  const today = localToday(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [items, setItems] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const session = useRef<AbortController | null>(null);
  const [failure, setFailure] = useState<{ message: string; retry(): void } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    setLoading(true); setLoadError("");
    void service.list(userId, courseId, controller.signal).then(rows => {
      if (!controller.signal.aborted) { setItems(rows); setLoading(false); }
    }).catch(() => {
      if (!controller.signal.aborted) { setLoadError("Couldn’t load assignments. Try again."); setLoading(false); }
    });
    return () => controller.abort();
  }, [userId, courseId, service, revision]);
  const [editing, setEditing] = useState<{ item: Assignment; field: Field; isNew: boolean } | null>(null);
  const [undo, setUndo] = useState<Assignment | null>(null);
  const [notice, setNotice] = useState("");
  const addButton = useRef<HTMLButtonElement>(null);
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterRender = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = focusAfterRender.current;
    if (!key) return;
    const target = key === "add" ? addButton.current : cells.current.get(key);
    target?.focus();
    target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    focusAfterRender.current = null;
  });
  async function update(id: string, value: AssignmentPatch, success?: () => void) {
    if (busy.current || !session.current || session.current.signal.aborted) return;
    busy.current = true; setPending(true); setFailure(null);
    const signal = session.current.signal;
    try {
      const saved = await service.update(userId, courseId, id, value, signal);
      if (!signal.aborted) {
        setItems(previous => previous.map(item => item.id === id ? saved : item));
        setNotice(`${saved.title} saved.`);
        success?.();
      }
    } catch (error) {
      if (!signal.aborted) setFailure({ message: error instanceof Error ? error.message : "Couldn’t save the change.", retry: () => { void update(id, value, success); } });
    } finally { busy.current = false; if (!signal.aborted) setPending(false); }
  }
  async function save(item: Assignment, focus: Field | null) {
    if (busy.current || !session.current || session.current.signal.aborted) throw new Error("A save is in progress. Try again.");
    busy.current = true; setPending(true); setFailure(null);
    const signal = session.current.signal;
    try {
      const original = editing?.item;
      // Only send edited fields, so another device’s completion/date is preserved.
      const patch: AssignmentPatch = {};
      for (const field of fields) if (original?.[field] !== item[field]) patch[field] = item[field];
      const saved = editing?.isNew ? await service.create(userId, courseId, item, signal)
        : Object.keys(patch).length ? await service.update(userId, courseId, item.id, patch, signal) : item;
      if (signal.aborted) return;
      setItems(previous => editing?.isNew ? [...previous, saved] : previous.map(row => row.id === item.id ? saved : row));
      focusAfterRender.current = focus ? `${item.id}:${focus}` : null;
      setEditing(null);
      setNotice(`${saved.title} saved.`);
    } finally { busy.current = false; if (!signal.aborted) setPending(false); }
  }
  function cancel() {
    focusAfterRender.current = editing?.isNew ? "add" : `${editing?.item.id}:${editing?.field}`;
    setEditing(null);
  }
  const ordered = [...items].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || "9999").localeCompare(b.due || "9999"));
  const editor = editing && <AssignmentEditorRow today={today} key={`edit-${editing.item.id}`} {...editing} onSave={save} onCancel={cancel} />;
  return <section className="class-assignments" aria-label="Assignments">
    <header><h2>Assignments</h2><button ref={addButton} disabled={!!editing || pending || loading || !!loadError} onClick={() => {
      setNotice(""); setFailure(null);
      setEditing({ item: { id: crypto.randomUUID(), title: "", due: "", type: "", done: false }, field: "title", isNew: true });
    }}><WorkspaceIcon name="plus" />Add assignment</button></header>
    {loading && <p role="status">Loading assignments…</p>}
    {loadError && <p role="alert">{loadError} <button onClick={() => setRevision(value => value + 1)}>Try again</button></p>}
    {failure && <p role="alert">{failure.message} <button disabled={pending} onClick={failure.retry}>Try again</button></p>}
    <div className="assignment-table-wrap" aria-busy={pending}><table><thead><tr>
      <th scope="col"><span className="cloud-shell__sr-only">Done</span></th>
      <th scope="col">Name</th><th scope="col">Date</th><th scope="col">Type</th>
    </tr></thead><tbody>
      {editing?.isNew && editor}
      {ordered.map(item => editing?.item.id === item.id ? editor : <tr key={item.id} className={item.done ? "assignment-done" : ""}>
        <td><input type="checkbox" checked={item.done} aria-disabled={!!editing || pending} aria-label={`Mark ${item.title} ${item.done ? "unfinished" : "done"}`} onChange={() => { if (editing) return; void update(item.id, { done: !item.done }, () => setUndo(item)); }} /></td>
        {fields.map(field => <td key={field} className={field === "due" && !item.done && item.due && item.due < today ? "assignment-overdue" : ""}>
          {field === "due" ? <AssignmentDatePicker today={today} value={item.due} label={`Edit due for ${item.title}`}
            disabled={!!editing || loading || !!loadError} busy={pending} buttonRef={node => { const key = `${item.id}:due`; if (node) cells.current.set(key, node); else cells.current.delete(key); }}
            onChange={due => { void update(item.id, { due }); }} />
            : field === "type" ? <AssignmentTypePicker value={item.type} label={`Edit type for ${item.title}`}
              disabled={!!editing || loading || !!loadError} busy={pending} buttonRef={node => { const key = `${item.id}:type`; if (node) cells.current.set(key, node); else cells.current.delete(key); }}
              onChange={type => { void update(item.id, { type }); }} />
            : <button ref={node => { const key = `${item.id}:${field}`; if (node) cells.current.set(key, node); else cells.current.delete(key); }}
              disabled={pending} className="assignment-cell assignment-title" aria-label={`Edit ${field} for ${item.title}`}
              onClick={() => { if (editing) return; setNotice(""); setFailure(null); setEditing({ item, field, isNew: false }); }}>
              {item.title}
            </button>}
        </td>)}
      </tr>)}
      {!loading && !loadError && !items.length && !editing && <tr><td colSpan={4} className="assignment-empty">No assignments yet. Add your first assignment above.</td></tr>}
    </tbody></table></div>
    {editing && <p className="assignment-edit-hint">Tab to move · Enter to save · Esc to cancel</p>}
    <span className="cloud-shell__sr-only" role="status">{notice}</span>
    {undo && <p className="assignment-undo" role="status">Assignment {undo.done ? "reopened" : "completed"}. <button disabled={pending || !!editing} onClick={() => { void update(undo.id, { done: undo.done }, () => setUndo(null)); }}>Undo</button></p>}
  </section>;
}
