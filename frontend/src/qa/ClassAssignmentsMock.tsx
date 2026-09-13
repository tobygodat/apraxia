import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AssignmentTypePicker } from "./AssignmentTypePicker";
import { AssignmentDatePicker } from "./AssignmentDatePicker";
import { WorkspaceIcon } from "../components/WorkspaceIcon";
import { addSqlDateDays, localToday } from "../features/todos/dateDomain";
import "./classAssignmentsMock.css";

interface Assignment { id: number; title: string; type: string; due: string; done: boolean }
type Field = "title" | "due" | "type";
const fields: Field[] = ["title", "due", "type"];
const today = localToday("America/New_York");
const samples: Assignment[] = [
  { id: 1, title: "Problem set 3", type: "Homework", due: addSqlDateDays(today, -2), done: false },
  { id: 2, title: "Problem set 4", type: "Homework", due: addSqlDateDays(today, 1), done: false },
  { id: 3, title: "Counting principles", type: "Quiz", due: addSqlDateDays(today, 5), done: false },
  { id: 4, title: "Midterm review problems", type: "Other", due: addSqlDateDays(today, 10), done: false },
  { id: 5, title: "Read chapter 5", type: "Reading", due: "", done: false },
  { id: 6, title: "Problem set 2", type: "Homework", due: addSqlDateDays(today, -9), done: true },
];

function AssignmentEditorRow({ item, field, isNew, onSave, onCancel }: {
  item: Assignment; field: Field; isNew: boolean;
  onSave(item: Assignment, focus: Field | null): void;
  onCancel(): void;
}) {
  const [draft, setDraft] = useState(item);
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  const controls = useRef<Partial<Record<Field, HTMLInputElement | HTMLButtonElement>>>({});
  const finishing = useRef(false);
  const errorId = useId();
  useLayoutEffect(() => { controls.current[field]?.focus(); }, [field]);

  function save(focus: Field | null) {
    if (finishing.current) return;
    const invalid = !draft.title.trim() ? { field: "title" as const, message: "Name required" } : null;
    if (invalid) {
      setError(invalid);
      controls.current[invalid.field]?.focus();
      return;
    }
    finishing.current = true;
    onSave({ ...draft, title: draft.title.trim() }, focus);
  }
  function cancel() { finishing.current = true; onCancel(); }
  function keyDown(event: KeyboardEvent<HTMLInputElement | HTMLButtonElement>, current: Field) {
    if (event.nativeEvent.isComposing) return;
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
      if (current === "due") return <td key={current}><AssignmentDatePicker value={draft.due} label={label}
        buttonRef={node => { if (node) controls.current.due = node; }}
        onChange={due => setDraft(previous => ({ ...previous, due }))}
        onKeyDown={event => keyDown(event, "due")} /></td>;
      if (current === "type") return <td key={current}><AssignmentTypePicker value={draft.type} label={label}
        buttonRef={node => { if (node) controls.current.type = node; }}
        onChange={type => setDraft(previous => ({ ...previous, type }))}
        onKeyDown={event => keyDown(event, "type")} /></td>;
      const props = {
        "aria-label": label,
        "aria-invalid": error?.field === current || undefined,
        "aria-describedby": error?.field === current ? errorId : undefined,
        value: draft[current],
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
        {error?.field === current && <span id={errorId} className="assignment-field-error" role="alert">{error.message}</span>}
      </td>;
    })}
  </tr>;
}

/** Design prototype: fixture-only data and state, reset on reload. */
export function ClassAssignmentsMock({ empty = false }: { empty?: boolean }) {
  const [items, setItems] = useState<Assignment[]>(empty ? [] : samples);
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
  function update(id: number, value: Partial<Assignment>) {
    setItems(previous => previous.map(item => item.id === id ? { ...item, ...value } : item));
  }
  function save(item: Assignment, focus: Field | null) {
    setItems(previous => editing?.isNew ? [...previous, item] : previous.map(row => row.id === item.id ? item : row));
    focusAfterRender.current = focus ? `${item.id}:${focus}` : null;
    setEditing(null);
    setNotice(`${item.title} saved.`);
  }
  function cancel() {
    focusAfterRender.current = editing?.isNew ? "add" : `${editing?.item.id}:${editing?.field}`;
    setEditing(null);
  }
  const ordered = [...items].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || "9999").localeCompare(b.due || "9999"));
  const editor = editing && <AssignmentEditorRow key={`edit-${editing.item.id}`} {...editing} onSave={save} onCancel={cancel} />;
  return <section className="class-assignments-mock" aria-label="Assignments">
    <header><h2>Assignments</h2><button ref={addButton} disabled={!!editing} onClick={() => {
      setNotice("");
      setEditing({ item: { id: Math.max(0, ...items.map(item => item.id)) + 1, title: "", due: "", type: "", done: false }, field: "title", isNew: true });
    }}><WorkspaceIcon name="plus" />Add assignment</button></header>
    <div className="assignment-table-wrap"><table><thead><tr>
      <th scope="col"><span className="cloud-shell__sr-only">Done</span></th>
      <th scope="col">Name</th><th scope="col">Date</th><th scope="col">Type</th>
    </tr></thead><tbody>
      {editing?.isNew && editor}
      {ordered.map(item => editing?.item.id === item.id ? editor : <tr key={item.id} className={item.done ? "assignment-done" : ""}>
        <td><input type="checkbox" checked={item.done} aria-label={`Mark ${item.title} ${item.done ? "unfinished" : "done"}`} onChange={() => { setUndo(item); update(item.id, { done: !item.done }); }} /></td>
        {fields.map(field => <td key={field} className={field === "due" && !item.done && item.due && item.due < today ? "assignment-overdue" : ""}>
          {field === "due" ? <AssignmentDatePicker value={item.due} label={`Edit due for ${item.title}`}
            disabled={!!editing} buttonRef={node => { const key = `${item.id}:due`; if (node) cells.current.set(key, node); else cells.current.delete(key); }}
            onChange={due => { update(item.id, { due }); setNotice(`Date for ${item.title} saved.`); }} />
            : field === "type" ? <AssignmentTypePicker value={item.type} label={`Edit type for ${item.title}`}
              disabled={!!editing} buttonRef={node => { const key = `${item.id}:type`; if (node) cells.current.set(key, node); else cells.current.delete(key); }}
              onChange={type => { update(item.id, { type }); setNotice(`Type for ${item.title} saved.`); }} />
            : <button ref={node => { const key = `${item.id}:${field}`; if (node) cells.current.set(key, node); else cells.current.delete(key); }}
              className="assignment-cell assignment-title" aria-label={`Edit ${field} for ${item.title}`}
              onClick={() => { if (editing) return; setNotice(""); setEditing({ item, field, isNew: false }); }}>
              {item.title}
            </button>}
        </td>)}
      </tr>)}
      {!items.length && !editing && <tr><td colSpan={4} className="assignment-empty">No assignments yet. Add your first assignment above.</td></tr>}
    </tbody></table></div>
    {editing && <p className="assignment-edit-hint">Tab to move · Enter to save · Esc to cancel</p>}
    <span className="cloud-shell__sr-only" role="status">{notice}</span>
    {undo && <p className="assignment-undo" role="status">Assignment {undo.done ? "reopened" : "completed"}. <button onClick={() => { update(undo.id, { done: undo.done }); setUndo(null); }}>Undo</button></p>}
  </section>;
}
