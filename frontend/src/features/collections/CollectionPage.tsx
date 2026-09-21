import { useEffect, useRef, useState } from "react";
import type { DeleteUndoToken, Idea, Project, Todo } from "../../types/domain";
import { useColdLoad } from "../../apps/coldLoad";
import { useWorkspace } from "../../apps/workspaceStore";
import { useWorkspacePreferences } from "../../apps/workspacePreferences";
import { peekRead } from "../../apps/navigationCache";
import { TodoComposerDialog, TodoEditDialog } from "../todos/TodoFormDialog";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { formatTaskDate, formatTaskTime } from "../todos/taskFormatting";
import { ideaPreview } from "./collectionPresentation";
import type { TodoService } from "../todos/todoService";
import { CollectionEditor, PROJECT_STATUS_LABELS } from "./CollectionEditor";
import {
  ideaTitle,
  type CollectionKind,
  type CollectionRecord,
  type CollectionService,
  type ProjectStatusFilter,
} from "./collectionService";
import "./collections.css";
import "./collectionsPaper.css";
interface Props {
  kind: CollectionKind;
  service: CollectionService;
  todoService: TodoService;
  recordId?: string;
  onOpenProject?: (id: string) => void;
  onBack?: () => void;
}
const headings = { project: "Projects", idea: "Ideas" };
const descriptions = {
  project: "Outcomes, with their tasks and thoughts in one place.",
  idea: "A place for thoughts you want to keep.",
};
/** The list filter's own choices; "" is the default view, which hides archives. */
const PROJECT_FILTERS: readonly (readonly [string, string])[] = [
  ["", "Current"],
  ...Object.entries(PROJECT_STATUS_LABELS),
  ["all", "Everything"],
];
const titleOf = (kind: CollectionKind, r: CollectionRecord) =>
  kind === "idea" ? ideaTitle(r as Idea) : r.title || "Untitled";
const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export function CollectionPage(props: Props) {
  const { kind, service, todoService, recordId, onOpenProject, onBack } = props;
  const { projects, classes, revision: refreshKey, invalidate: onChanged } = useWorkspace();
  const { resolvedTheme } = useWorkspacePreferences();
  // Paper draws several of this page's controls as words rather than icons,
  // and states its filter as a row of words, so the markup forks on the preset.
  const paper = resolvedTheme.startsWith("paper");
  const isDetail = kind === "project" && Boolean(recordId);
  const [seed] = useState(() => {
    const peekedProjectRaw = isDetail ? peekRead(service, "getProject", recordId!) : undefined;
    const peekedTasksRaw = isDetail ? peekRead(service, "projectTodos", recordId!, 0) : undefined;
    const peekedIdeasRaw = isDetail
      ? peekRead(service, "listIdeas", { projectId: recordId!, offset: 0 })
      : undefined;
    const peekedRowsRaw = !isDetail
      ? kind === "project"
        ? peekRead(service, "listProjects", { offset: 0 })
        : peekRead(service, "listIdeas", { offset: 0 })
      : undefined;
    const initialLoading = isDetail
      ? peekedProjectRaw === undefined ||
        peekedTasksRaw === undefined ||
        peekedIdeasRaw === undefined
      : peekedRowsRaw === undefined;
    return { peekedProjectRaw, peekedTasksRaw, peekedIdeasRaw, peekedRowsRaw, initialLoading };
  });
  const { peekedProjectRaw, peekedTasksRaw, peekedIdeasRaw, peekedRowsRaw, initialLoading } = seed;
  const [rows, setRows] = useState<CollectionRecord[]>(() => peekedRowsRaw ?? []);
  const [revision, setRevision] = useState(0);
  const [limit, setLimit] = useState(50);
  const [more, setMore] = useState(() => (peekedRowsRaw ?? []).length === 50);
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<{
    kind: CollectionKind;
    record?: CollectionRecord;
    projectId?: string;
  } | null>(null);
  const [project, setProject] = useState<Project | null>(() => peekedProjectRaw ?? null);
  const [tasks, setTasks] = useState<Todo[]>(() => peekedTasksRaw ?? []);
  const [ideas, setIdeas] = useState<Idea[]>(() => peekedIdeasRaw ?? []);
  const [taskLimit, setTaskLimit] = useState(50);
  const [ideaLimit, setIdeaLimit] = useState(50);
  const [moreTasks, setMoreTasks] = useState(() => (peekedTasksRaw ?? []).length === 50);
  const [moreIdeas, setMoreIdeas] = useState(() => (peekedIdeasRaw ?? []).length === 50);
  const [composer, setComposer] = useState(false);
  const [editingTask, setEditingTask] = useState<Todo | null>(null);
  const [notice, setNotice] = useState("");
  const [deleteNotice, setDeleteNotice] = useState(false);
  const [undo, setUndo] = useState<{
    kind: CollectionKind | "todo";
    id: string;
    token: DeleteUndoToken;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter | "">("");
  const [settling, setSettling] = useState<string | null>(null);
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
        setSettling(null);
        setIdeas(i);
        setMoreTasks(t[t.length - 1].length === 50);
        setMoreIdeas(i.length === ideaLimit);
      } else {
        const pages = await Promise.all(
          Array.from({ length: limit / 50 }, (_, n) => {
            const options = { offset: n * 50, signal: controller.signal };
            // The default view omits `status` so it shares the prefetch's cache key.
            return kind === "project"
              ? service.listProjects(statusFilter ? { ...options, status: statusFilter } : options)
              : service.listIdeas(options);
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
        if (active) {
          setError("Couldn’t load this collection. Try again.");
          setSettling(null);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setSettling(null);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [kind, service, recordId, limit, taskLimit, ideaLimit, revision, refreshKey, statusFilter]);
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
      setDeleteNotice(true);
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
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await todoService.setTodoCompleted(task.id, !task.completed, {
        signal: new AbortController().signal,
      });
      changed();
      return true;
    } catch {
      setError("Couldn’t update this task. Try again.");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function settleAndComplete(task: Todo) {
    if (task.completed || paper || reducedMotion()) {
      await complete(task);
      return;
    }
    setSettling(task.id);
    await new Promise((r) => setTimeout(r, 420));
    if (!mounted.current) return;
    const ok = await complete(task);
    if (!ok && mounted.current) setSettling(null);
  }
  const detail = isDetail;
  const prefetchedProjectIds = useRef<Set<string>>(new Set());
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    prefetchedProjectIds.current.clear();
  }, [refreshKey]);
  useEffect(() => {
    return () => {
      if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    };
  }, []);
  function prefetchProject(id: string) {
    if (prefetchedProjectIds.current.has(id)) return;
    prefetchedProjectIds.current.add(id);
    service.getProject(id).catch(() => {});
    service.projectTodos(id, 0).catch(() => {});
    service.listIdeas({ projectId: id, offset: 0 }).catch(() => {});
  }
  function scheduleProjectPrefetch(id: string) {
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    prefetchTimer.current = setTimeout(() => {
      prefetchTimer.current = null;
      prefetchProject(id);
    }, 120);
  }
  function cancelProjectPrefetch() {
    if (prefetchTimer.current) {
      clearTimeout(prefetchTimer.current);
      prefetchTimer.current = null;
    }
  }
  function renderRow(k: CollectionKind, r: CollectionRecord) {
    const p = k === "idea" ? projects.find((p) => p.id === (r as Idea).projectId) : null;
    const preview =
      k === "idea" ? ideaPreview(r as Idea) : k === "project" ? (r as Project).description : null;
    const metadata = k === "idea" && !detail ? p?.title : null;
    // Active is the ordinary state, so only the other three are worth a badge.
    const status =
      k === "project" && (r as Project).status !== "active" ? (r as Project).status : null;
    const body = (
      <>
        <strong>{titleOf(k, r)}</strong>
        {status && <span className="collection-status">{PROJECT_STATUS_LABELS[status]}</span>}
        {preview && <span className="collection-preview">{preview}</span>}
        {metadata && <span className="collection-meta">{metadata}</span>}
      </>
    );
    return (
      <li key={r.id} className="collection-row paper-row">
        <button
          className="collection-open"
          onClick={() =>
            k === "project" && onOpenProject
              ? onOpenProject(r.id)
              : setEditor({ kind: k, record: r })
          }
          {...(k === "project"
            ? {
                onPointerEnter: () => scheduleProjectPrefetch(r.id),
                onPointerLeave: cancelProjectPrefetch,
                onFocus: () => scheduleProjectPrefetch(r.id),
                onBlur: cancelProjectPrefetch,
              }
            : {})}
        >
          {/* Paper sets the row's action word beside its name, so the two need
              a box between them; classic keeps the children it always had. */}
          {paper ? <span className="collection-open__body">{body}</span> : body}
          {paper && (
            <span className="paper-action paper-action--quiet collection-open__word">
              {k === "project" ? "open" : "edit"}
            </span>
          )}
        </button>
        <button
          className="collection-delete paper-action paper-action--danger"
          disabled={busy}
          title="Delete"
          aria-label={`Delete ${titleOf(k, r)}`}
          onClick={() => void remove(k, r.id)}
        >
          {paper ? "delete" : <WorkspaceIcon name="trash" />}
        </button>
      </li>
    );
  }
  function renderTask(task: Todo) {
    return (
      <div
        className="collection-task paper-row"
        key={task.id}
        data-settling={settling === task.id || undefined}
      >
        <label className="collection-task-check">
          <input
            type="checkbox"
            className="paper-check"
            checked={task.completed || settling === task.id}
            disabled={busy}
            aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.text}`}
            onChange={() => void settleAndComplete(task)}
          />
        </label>
        <button
          className="collection-task-text"
          data-completed={task.completed}
          onClick={() => setEditingTask(task)}
        >
          <span className="collection-task-title">{task.text}</span>
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
          className="collection-row-action paper-action"
          title="Edit task"
          aria-label={`Edit ${task.text}`}
          onClick={() => setEditingTask(task)}
        >
          {paper ? "edit" : <WorkspaceIcon name="edit" />}
        </button>
        <button
          className="collection-delete paper-action paper-action--danger"
          disabled={busy}
          title="Delete task"
          aria-label={`Delete ${task.text}`}
          onClick={() => void remove("todo", task.id)}
        >
          {paper ? "delete" : <WorkspaceIcon name="trash" />}
        </button>
      </div>
    );
  }
  const completedTasks = tasks.filter((t) => t.completed);
  const openTasks = tasks.filter((t) => !t.completed);
  const coldDetail = detail && loading && !project;
  const coldList = !detail && loading && !rows.length;
  // The project detail page stays quiet about routine notices, but a deletion
  // is only reversible while its Undo is on screen, so that one still shows.
  const showNotice = Boolean(notice) && (!detail || deleteNotice);
  const showLoadingStatus = !error && (detail ? coldDetail : coldList);
  useColdLoad(!error && (detail ? coldDetail : coldList));
  return (
    <section
      className={`collection-page${detail && kind === "project" ? " collection-page--project" : ""}`}
    >
      {detail && (
        <button className="collection-back paper-action paper-action--quiet" onClick={onBack}>
          <WorkspaceIcon name="left" />
          Back to Projects
        </button>
      )}
      <header
        className={`collection-heading workspace-page-header${detail ? " collection-heading--detail" : ""}`}
      >
        <div>
          <h1 ref={headingRef} tabIndex={-1}>
            {detail
              ? (project?.title ?? projects.find((p) => p.id === recordId)?.title) || (
                  <span className="cloud-shell__sr-only">Loading project…</span>
                )
              : headings[kind]}
          </h1>
          {!detail && <p>{descriptions[kind]}</p>}
          {detail && project?.description && (
            <p className="collection-description">{project.description}</p>
          )}
        </div>
        {detail ? (
          <button
            className="workspace-page-header__action paper-action paper-action--quiet"
            disabled={!project}
            onClick={() => project && setEditor({ kind: "project", record: project })}
          >
            <WorkspaceIcon name="edit" />
            Edit project
          </button>
        ) : (
          <button
            className="workspace-page-header__action paper-button paper-button--primary"
            onClick={() => setEditor({ kind })}
          >
            <WorkspaceIcon name="plus" />
            Add {kind}
          </button>
        )}
      </header>
      {showNotice && (
        <div className="collection-notice" role="status">
          {notice}
          {undo && (
            <button
              className="collection-notice__undo paper-action"
              disabled={busy}
              onClick={() => void restore()}
            >
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
      {showLoadingStatus && (
        <p className="cloud-shell__sr-only" role="status">
          Loading…
        </p>
      )}
      {detail ? (
        <>
          <section className="collection-section">
            <header>
              <h2 className="paper-heading">
                Tasks{" "}
                {!coldDetail && (
                  <span className="collection-section__count">{openTasks.length}</span>
                )}
              </h2>
              <button
                className="collection-section__add paper-button paper-button--primary"
                onClick={() => setComposer(true)}
              >
                <WorkspaceIcon name="plus" />
                Add task
              </button>
            </header>
            {openTasks.map(renderTask)}
            {!loading && !openTasks.length && (
              <p className="collection-empty">
                No open tasks. Add the next action when you’re ready.
              </p>
            )}
            {completedTasks.length > 0 && (
              <div className="collection-completed">
                <button
                  type="button"
                  className="collection-completed__toggle paper-action"
                  aria-expanded={showCompleted}
                  aria-controls="collection-completed-tasks"
                  onClick={() => setShowCompleted((v) => !v)}
                >
                  {showCompleted ? "Hide completed" : "Show completed"} ({completedTasks.length})
                </button>
                <div
                  id="collection-completed-tasks"
                  className="collection-completed__list"
                  hidden={!showCompleted}
                >
                  {completedTasks.map(renderTask)}
                </div>
              </div>
            )}
            {moreTasks && (
              <button
                className="collection-button paper-action"
                disabled={loading}
                onClick={() => setTaskLimit((v) => v + 50)}
              >
                Load more tasks
              </button>
            )}
          </section>
          <section className="collection-section">
            <header>
              <h2 className="paper-heading">
                Ideas{" "}
                {!coldDetail && <span className="collection-section__count">{ideas.length}</span>}
              </h2>
              <button
                className="collection-section__add paper-button paper-button--primary"
                onClick={() => recordId && setEditor({ kind: "idea", projectId: recordId })}
              >
                <WorkspaceIcon name="plus" />
                Add idea
              </button>
            </header>
            {ideas.length > 0 && (
              <ul className="collection-list">{ideas.map((i) => renderRow("idea", i))}</ul>
            )}
            {!loading && !ideas.length && (
              <p className="collection-empty">
                No ideas here yet. Keep supporting thoughts with this project.
              </p>
            )}
            {moreIdeas && (
              <button
                className="collection-button paper-action"
                disabled={loading}
                onClick={() => setIdeaLimit((v) => v + 50)}
              >
                Load more ideas
              </button>
            )}
          </section>
        </>
      ) : (
        <>
          {kind === "project" &&
            (paper ? (
              <div className="collection-filter">
                <span className="collection-filter__label" id="collection-status-filter-label">
                  Status
                </span>
                <div
                  className="collection-filter__words"
                  role="group"
                  aria-labelledby="collection-status-filter-label"
                >
                  {PROJECT_FILTERS.map(([value, label]) => {
                    const current = statusFilter === value;
                    return (
                      <button
                        key={value || "current"}
                        type="button"
                        className={`collection-filter__word paper-nav__item${
                          current ? " paper-nav__item--current" : ""
                        }`}
                        aria-pressed={current}
                        onClick={() => {
                          setLimit(50);
                          setStatusFilter(value as ProjectStatusFilter | "");
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="collection-filter">
                <label htmlFor="collection-status-filter">Status</label>
                <select
                  id="collection-status-filter"
                  value={statusFilter}
                  onChange={(e) => {
                    setLimit(50);
                    setStatusFilter(e.target.value as ProjectStatusFilter | "");
                  }}
                >
                  {PROJECT_FILTERS.map(([value, label]) => (
                    <option key={value || "current"} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          <ul className="collection-list">{rows.map((r) => renderRow(kind, r))}</ul>
          {!loading && !error && !rows.length && (
            <div className="collection-empty">
              <p>
                {kind === "project"
                  ? "No projects in this view."
                  : "No ideas yet. Keep your first thought here."}
              </p>
              <button
                className="collection-button paper-action"
                onClick={() => setEditor({ kind })}
              >
                Add {kind}
              </button>
            </div>
          )}
          {more && (
            <button
              className="collection-button paper-action"
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
            setDeleteNotice(Boolean(undo));
            if (editor.kind !== "project") setNotice("Saved.");
            else if (!undo) setNotice("");
            changed();
          }}
        />
      )}
      {composer && (
        <TodoComposerDialog
          open
          initialProjectId={recordId}
          projects={projects}
          classes={classes}
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
        classes={classes}
        onClose={() => setEditingTask(null)}
        onSave={async (id, input, options) => {
          await todoService.updateTodoDetails(id, input, options);
          changed();
        }}
      />
    </section>
  );
}
