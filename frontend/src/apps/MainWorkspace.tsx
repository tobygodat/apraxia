import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { AuthIdentity } from "../auth/authPort";
import type { SignOutStatus } from "../auth/AuthProvider";
import type { Profile, ProjectSummary, SearchResult, Todo } from "../types/domain";
import { CloudAppShell } from "../components/app-shell/CloudAppShell";
import { GlobalAddTodoController, useGlobalAddTodo } from "../components/global-add/GlobalAddTodoController";
import { SearchDialog } from "../components/search/SearchDialog";
import type { TodoService } from "../features/todos/todoService";
import { TodosWorkspaceContent } from "../features/todos/TodosWorkspace";
import { TodoEditDialog } from "../features/todos/TodoEditDialog";
import { HomePage } from "../features/calendar/HomePage";
import { SettingsPage } from "../features/calendar/SettingsPage";
import type { CalendarService } from "../features/calendar/calendarService";
import { CollectionPage } from "../features/collections/CollectionPage";
import { CollectionEditor } from "../features/collections/CollectionEditor";
import type { CollectionKind, CollectionRecord, CollectionService } from "../features/collections/collectionService";
import type { WorkspaceData } from "./workspaceData";
import { WorkspaceDialog } from "./WorkspaceDialog";
import "./workspace.css";
import type { DriveService } from '../features/classes/driveService';
import { ClassesPage } from "../features/classes/ClassesPage";

export interface MainWorkspaceProps {
  identity: AuthIdentity;
  classAssignments?: ReactNode;
  signOutStatus: SignOutStatus;
  onSignOut(): Promise<void>;
  todoService: TodoService;
  collectionService: CollectionService;
  calendarService: CalendarService;
  driveService?: DriveService;
  workspaceData: WorkspaceData;
}

export function MainWorkspace(props: MainWorkspaceProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectError, setProjectError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [profileRevision, setProfileRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const changed = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setProfileError(false);
    void props.workspaceData.profile(controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (value.userId !== props.identity.userId) { setProfileError(true); return; }
      setProfile(value);
    }).catch(() => { if (!controller.signal.aborted) setProfileError(true); });
    return () => controller.abort();
  }, [props.workspaceData, props.identity.userId, profileRevision]);
  useEffect(() => {
    const controller = new AbortController();
    void props.workspaceData.projects(controller.signal).then(value => {
      if (!controller.signal.aborted) { setProjects(value); setProjectError(false); }
    }).catch(() => { if (!controller.signal.aborted) setProjectError(true); });
    return () => controller.abort();
  }, [props.workspaceData, revision]);
  return <GlobalAddTodoController workspaceSessionKey={props.identity.userId} service={props.todoService} projects={projects}
    onCreated={() => { changed(); setNotice("Task added"); return undefined; }}>
    <WorkspaceRoutes {...props} profile={profile} profileError={profileError} retryProfile={() => setProfileRevision(v => v + 1)}
      projects={projects} projectError={projectError} revision={revision} changed={changed} notice={notice} setNotice={setNotice} />
  </GlobalAddTodoController>;
}

function WorkspaceRoutes({ profile, profileError, retryProfile, projects, projectError, revision, changed, notice, setNotice, ...props }: MainWorkspaceProps & {
  profile: Profile | null; profileError: boolean; retryProfile(): void; projects: readonly ProjectSummary[];
  projectError: boolean; revision: number; changed(): void; notice: string; setNotice(value: string): void;
}) {
  const { openTodoComposer } = useGlobalAddTodo();
  const location = useLocation();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editor, setEditor] = useState<{ kind: CollectionKind; record?: CollectionRecord; fromSearch?: boolean } | null>(null);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.altKey) {
        event.preventDefault();
        if (!document.querySelector('[role="dialog"]')) setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  async function selectResult(result: SearchResult) {
    if (result.recordType === "project") {
      navigate(`/projects/${encodeURIComponent(result.recordId)}`); setSearchOpen(false); return;
    }
    if (result.recordType === "todo") {
      const todo = await props.collectionService.getTodo(result.recordId);
      if (!alive.current) return;
      setEditingTodo(todo);
    } else {
      const kind = result.recordType;
      const record = kind === "idea" ? await props.collectionService.getIdea(result.recordId) : await props.collectionService.getMedia(result.recordId);
      if (!alive.current) return;
      setEditor({ kind, record, fromSearch: true });
    }
    setSearchOpen(false);
  }
  const pathname = location.pathname.replace(/\/$/, "") || "/";
  const projectMatch = /^\/projects\/([^/]+)$/.exec(pathname);
  const collectionKind: CollectionKind | null = pathname === "/projects" || projectMatch ? "project" : pathname === "/ideas" ? "idea" : pathname === "/media" ? "media" : null;
  const profileState = <section className="workspace-page"><h1>{pathname === "/settings" ? "Settings" : "Home"}</h1>
    {profileError ? <div role="alert"><p>Couldn’t load your workspace. Your records are still saved.</p><button onClick={retryProfile}>Try again</button></div>
      : <p role="status">Loading your workspace…</p>}</section>;
  let content;
  if (pathname === "/") content = profile ? <div className="workspace-home-scroll"><HomePage appearanceService={props.workspaceData.homeAppearance} todoService={props.todoService} calendarService={props.calendarService} profile={profile} projects={projects} workspaceSessionKey={props.identity.userId} refreshKey={revision} /></div> : profileState;
  else if (pathname === "/todos") content = <TodosWorkspaceContent service={props.todoService} workspaceSessionKey={props.identity.userId} refreshKey={revision} />;
  else if (pathname === "/classes" || /^\/classes\/[^/]+$/.test(pathname)) content = <ClassesPage key={props.identity.userId} userId={props.identity.userId} courseId={pathname.split("/")[2]} driveService={props.driveService} assignments={props.classAssignments} />;
  else if (pathname === "/settings") content = profile ? <SettingsPage calendarService={props.calendarService} profile={profile} onSignOut={props.onSignOut} /> : profileState;
  else if (collectionKind) content = <CollectionPage key={`${collectionKind}:${projectMatch?.[1] ?? ""}`} kind={collectionKind} service={props.collectionService} todoService={props.todoService}
    projects={projects} refreshKey={revision} onChanged={changed} recordId={projectMatch?.[1]} onOpenProject={id => navigate(`/projects/${encodeURIComponent(id)}`)} onBack={() => navigate("/projects")} />;
  else content = <section className="workspace-page"><h1>Page not found</h1><Link to="/">Back to Home</Link></section>;
  return <div ref={rootRef}>
    <CloudAppShell identity={props.identity} signOutStatus={props.signOutStatus} onSignOut={props.onSignOut}
      onOpenGlobalAdd={() => setAddOpen(true)} onOpenSearch={() => setSearchOpen(true)}>
      {projectError && <p className="workspace-project-warning">Project choices couldn’t load. <button onClick={changed}>Try again</button></p>}
      {content}
    </CloudAppShell>
    {addOpen && <WorkspaceDialog title="Add to orbitOS" onClose={() => setAddOpen(false)}><div className="workspace-add-choices">
      <button onClick={() => { setAddOpen(false); openTodoComposer(); }}>Task</button>
      {(["idea", "media", "project"] as const).map(kind => <button key={kind} onClick={() => { setAddOpen(false); setEditor({ kind }); }}>{kind[0].toUpperCase() + kind.slice(1)}</button>)}
      <a href="https://calendar.google.com/calendar/u/0/r/eventedit" target="_blank" rel="noopener noreferrer" onClick={() => setAddOpen(false)}>Calendar event ↗</a>
    </div></WorkspaceDialog>}
    {editor && <CollectionEditor key={`${editor.kind}:${editor.record?.id ?? "new"}`} {...editor} service={props.collectionService} projects={projects}
      onSaved={() => { const returnToSearch = editor.fromSearch; setEditor(null); changed(); setNotice("Saved"); if (returnToSearch) setSearchOpen(true); }}
      onClose={() => { const returnToSearch = editor.fromSearch; setEditor(null); if (returnToSearch) setSearchOpen(true); }} />}
    <TodoEditDialog todo={editingTodo} projects={projects} fallbackFocusRef={rootRef} onClose={() => { setEditingTodo(null); setSearchOpen(true); }}
      onSave={async (id, input, options) => { await props.todoService.updateTodoDetails(id, input, options); if (alive.current) { changed(); setNotice("Task saved"); } }} />
    <SearchDialog open={searchOpen} service={props.collectionService} refreshKey={revision} onClose={() => setSearchOpen(false)} onSelect={selectResult} />
    {notice && <aside className="workspace-notice"><p role="status">{notice}</p><button onClick={() => setNotice("")}>Dismiss</button></aside>}
  </div>;
}
