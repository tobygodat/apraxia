import { useEffect, useRef, useState } from "react";
import type { DeleteUndoToken, Idea, MediaItem, Project, Todo } from "../../types/domain";
import { useWorkspace } from "../../apps/workspaceStore";
import { TodoComposerDialog, TodoEditDialog } from "../todos/TodoFormDialog";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { formatTaskDate, formatTaskTime } from "../todos/taskFormatting";
import { ideaPreview } from "./collectionPresentation";
import type { TodoService } from "../todos/todoService";
import { CollectionEditor } from "./CollectionEditor";
import {
  ideaTitle,
  type CollectionKind,
  type CollectionRecord,
  type CollectionService,
} from "./collectionService";
import "./collections.css";
interface Props {
  kind: CollectionKind;
  service: CollectionService;
  todoService: TodoService;
  recordId?: string;
  onOpenProject?: (id: string) => void;
  onBack?: () => void;
}
const headings = { project: "Projects", idea: "Ideas", media: "Media" };
const descriptions = {
  project: "Outcomes, with their tasks and thoughts in one place.",
  idea: "A place for thoughts you want to keep.",
  media: "Books and movies to return to.",
};
const titleOf = (kind: CollectionKind, r: CollectionRecord) =>
  kind === "idea" ? ideaTitle(r as Idea) : r.title || "Untitled";
export function CollectionPage(props: Props) {
  const { kind, service, todoService, recordId, onOpenProject, onBack } = props;
  const { projects, revision: refreshKey, invalidate: onChanged } = useWorkspace();
  const [rows, setRows] = useState<CollectionRecord[]>([]);
  const [status, setStatus] = useState(kind === "project" ? "active" : "all");
  const [mediaType, setMediaType] = useState("all");
  const [revision, setRevision] = useState(0);
  const [limit, setLimit] = useState(50);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<{
    kind: CollectionKind;
    record?: CollectionRecord;
    projectId?: string;
  } | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Todo[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [taskLimit, setTaskLimit] = useState(50);
  const [ideaLimit, setIdeaLimit] = useState(50);
  const [moreTasks, setMoreTasks] = useState(false);
  const [moreIdeas, setMoreIdeas] = useState(false);
  const [composer, setComposer] = useState(false);
  const [editingTask, setEditingTask] = useState<Todo | null>(null);
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<{
    kind: CollectionKind | "todo";
    id: string;
    token: DeleteUndoToken;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function changed() {
    if (mounted.current) {
      setRevision((v) => v + 1);
      onChanged();
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    async function load() {
      if (kind === "project" && recordId) {
        const [p, t, ideaPages] = await Promise.all([
          service.getProject(recordId),
          Promise.all(
            Array.from({ length: taskLimit / 50 }, (_, n) =>
              service.projectTodos(recordId, n * 50),
            ),
          ),
          Promise.all(
            Array.from({ length: ideaLimit / 50 }, (_, n) =>
              service.listIdeas({ projectId: recordId, offset: n * 50, signal: controller.signal }),
            ),
          ),
        ]);
        const i = ideaPages.flat();
        if (!active) return;
        setProject(p);
        setTasks(t.flat());
        setIdeas(i);
        setMoreTasks(t[t.length - 1].length === 50);
        setMoreIdeas(i.length === ideaLimit);
      } else {
        const pages = await Promise.all(
          Array.from({ length: limit / 50 }, (_, n) => {
            const options = { status, mediaType, offset: n * 50, signal: controller.signal };
            return kind === "project"
              ? service.listProjects(options)
              : kind === "idea"
                ? service.listIdeas(options)
                : service.listMedia(options);
          }),
        );
        const records = pages.flat();
        if (!active) return;
        setRows(records);
        setMore(records.length === limit);
      }
    }
    void load()
      .catch(() => {
        if (active) setError("Couldn’t load this collection. Try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    kind,
    service,
    recordId,
    status,
    mediaType,
    limit,
    taskLimit,
    ideaLimit,
    revision,
    refreshKey,
  ]);
  async function remove(k: CollectionKind | "todo", id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const token =
        k === "todo"
          ? await todoService.softDeleteTodo(id, { signal: new AbortController().signal })
          : await service.softDelete(k, id);
      if (!mounted.current) return;
      setUndo({ kind: k, id, token });
      setNotice(
        `${k === "project" ? "Project deleted. Its tasks and ideas are kept." : "Deleted."}`,
      );
      changed();
      headingRef.current?.focus();
    } catch {
      setError("Couldn’t delete. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function restore() {
    if (!undo || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const ok =
        undo.kind === "todo"
          ? await todoService.restoreTodo(undo.id, undo.token, {
              signal: new AbortController().signal,
            })
          : await service.restore(undo.kind, undo.id, undo.token);
      if (!mounted.current) return;
      if (!ok) throw new Error();
      setUndo(null);
      setNotice("Restored.");
      changed();
    } catch {
      setError("Couldn’t restore this record. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function complete(task: Todo) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await todoService.setTodoCompleted(task.id, !task.completed, {
        signal: new AbortController().signal,
      });
      changed();
    } catch {
      setError("Couldn’t update this task. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function renderRow(k: CollectionKind, r: CollectionRecord) {
    const p = k === "idea" ? projects.find((p) => p.id === (r as Idea).projectId) : null;
    const preview =
      k === "idea" ? ideaPreview(r as Idea) : k === "project" ? (r as Project).description : null;
    const metadata =
      k === "idea"
        ? p?.title
        : k === "media"
          ? [
              (r as MediaItem).creator,
              (r as MediaItem).mediaType,
              (r as MediaItem).status.replace(/_/g, " "),
            ]
              .filter(Boolean)
              .join(" · ")
          : (r as Project).status;
    return (
      <li key={r.id} className="collection-row">
        <button
          className="collection-open"
          onClick={() =>
            k === "project" && onOpenProject
              ? onOpenProject(r.id)
              : setEditor({ kind: k, record: r })
          }
        >
          <strong>{titleOf(k, r)}</strong>
          {preview && <span className="collection-preview">{preview}</span>}
          {metadata && <span className="collection-meta">{metadata}</span>}
        </button>
        <button
          className="collection-delete"
          disabled={busy}
          title="Delete"
          aria-label={`Delete ${titleOf(k, r)}`}
          onClick={() => void remove(k, r.id)}
        >
          <WorkspaceIcon name="trash" />
        </button>
      </li>
    );
  }
  function renderTask(task: Todo) {
    return (
      <div className="collection-task" key={task.id}>
        <label className="collection-task-check">
          <input
            type="checkbox"
            checked={task.completed}
            disabled={busy}
            aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.text}`}
            onChange={() => void complete(task)}
          />
        </label>
        <button
          className="collection-task-text"
          data-completed={task.completed}
          onClick={() => setEditingTask(task)}
        >
          {task.text}
          {task.dueDate && (
            <span className="collection-meta">
              <time dateTime={task.dueDate}>{formatTaskDate(task.dueDate)}</time>
              {task.dueTime && (
                <>
                  {" "}
                  · <time dateTime={task.dueTime}>{formatTaskTime(task.dueTime)}</time>
                </>
              )}
            </span>
          )}
        </button>
        <button
          className="collection-row-action"
          title="Edit task"
          aria-label={`Edit ${task.text}`}
          onClick={() => setEditingTask(task)}
        >
          <WorkspaceIcon name="edit" />
        </button>
        <button
          className="collection-delete"
          disabled={busy}
          title="Delete task"
          aria-label={`Delete ${task.text}`}
          onClick={() => void remove("todo", task.id)}
        >
          <WorkspaceIcon name="trash" />
        </button>
      </div>
    );
  }
  const detail = kind === "project" && Boolean(recordId);
  return (
    <section className="collection-page">
      {detail && (
        <button className="collection-back" onClick={onBack}>
          <WorkspaceIcon name="left" />
          Back to Projects
        </button>
      )}
      <header className="collection-heading workspace-page-header">
        <div>
          <h1 ref={headingRef} tabIndex={-1}>
            {detail ? (project?.title ?? "Project") : headings[kind]}
          </h1>
          <p>{detail ? project?.status : descriptions[kind]}</p>
        </div>
        {detail ? (
          project && (
            <button
              className="workspace-page-header__action"
              onClick={() => setEditor({ kind: "project", record: project })}
            >
              <WorkspaceIcon name="edit" />
              Edit project
            </button>
          )
        ) : (
          <button className="workspace-page-header__action" onClick={() => setEditor({ kind })}>
            <WorkspaceIcon name="plus" />
            Add {kind}
          </button>
        )}
      </header>
      {!detail && kind !== "idea" && (
        <div className="collection-filters">
          {kind === "media" && (
            <label>
              Type
              <select
                value={mediaType}
                onChange={(e) => {
                  setMediaType(e.target.value);
                  setLimit(50);
                }}
              >
                <option value="all">All types</option>
                <option value="book">Books</option>
                <option value="movie">Movies</option>
              </select>
            </label>
          )}
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setLimit(50);
              }}
            >
              <option value="all">All statuses</option>
              {(kind === "project"
                ? ["active", "someday", "completed", "archived"]
                : ["saved", "in_progress", "finished"]
              ).map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {notice && (
        <div className="collection-notice" role="status">
          {notice}
          {undo && (
            <button className="collection-button" disabled={busy} onClick={() => void restore()}>
              Undo deletion
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="workspace-error" role="alert">
          <p>{error}</p>
          <button onClick={() => setRevision((v) => v + 1)}>Retry</button>
        </div>
      )}
      {loading && (
        <p className="collection-meta" role="status">
          Loading…
        </p>
      )}
      {detail ? (
        project && (
          <>
            {project.description && (
              <p className="collection-detail-description">{project.description}</p>
            )}
            <section className="collection-section">
              <header>
                <h2>Tasks</h2>
                <button className="collection-button" onClick={() => setComposer(true)}>
                  Add task
                </button>
              </header>
              {tasks.filter((t) => !t.completed).map(renderTask)}
              {!loading && !tasks.some((t) => !t.completed) && (
                <p className="collection-empty">
                  No incomplete tasks. Add the next action when you’re ready.
                </p>
              )}
              <details>
                <summary>Completed tasks ({tasks.filter((t) => t.completed).length})</summary>
                {tasks.filter((t) => t.completed).map(renderTask)}
              </details>
              {moreTasks && (
                <button
                  className="collection-button"
                  disabled={loading}
                  onClick={() => setTaskLimit((v) => v + 50)}
                >
                  Load more tasks
                </button>
              )}
            </section>
            <section className="collection-section">
              <header>
                <h2>Ideas</h2>
                <button
                  className="collection-button"
                  onClick={() => setEditor({ kind: "idea", projectId: project.id })}
                >
                  Add idea
                </button>
              </header>
              <ul className="collection-list">{ideas.map((i) => renderRow("idea", i))}</ul>
              {!loading && !ideas.length && (
                <p className="collection-empty">
                  No ideas here yet. Keep supporting thoughts with this project.
                </p>
              )}
              {moreIdeas && (
                <button
                  className="collection-button"
                  disabled={loading}
                  onClick={() => setIdeaLimit((v) => v + 50)}
                >
                  Load more ideas
                </button>
              )}
            </section>
          </>
        )
      ) : (
        <>
          <ul className="collection-list">{rows.map((r) => renderRow(kind, r))}</ul>
          {!loading && !error && !rows.length && (
            <div className="collection-empty">
              <p>
                {kind === "project"
                  ? "No projects in this view."
                  : kind === "media"
                    ? "No books or movies in this view."
                    : "No ideas yet. Keep your first thought here."}
              </p>
              <button className="collection-button" onClick={() => setEditor({ kind })}>
                Add {kind}
              </button>
            </div>
          )}
          {more && (
            <button
              className="collection-button"
              disabled={loading}
              onClick={() => setLimit((v) => v + 50)}
            >
              Load more
            </button>
          )}
        </>
      )}
      {editor && (
        <CollectionEditor
          key={`${editor.kind}-${editor.record?.id ?? "new"}`}
          {...editor}
          service={service}
          projects={projects}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setNotice("Saved.");
            changed();
          }}
        />
      )}
      {composer && (
        <TodoComposerDialog
          open
          initialProjectId={recordId}
          projects={projects}
          onClose={() => setComposer(false)}
          onCreate={async (input, options) => {
            await todoService.createTodo(input, options);
            changed();
          }}
        />
      )}
      <TodoEditDialog
        todo={editingTask}
        projects={projects}
        onClose={() => setEditingTask(null)}
        onSave={async (id, input, options) => {
          await todoService.updateTodoDetails(id, input, options);
          changed();
        }}
      />
    </section>
  );
}
