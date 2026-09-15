import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Link,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
} from "react-router-dom";
import type { AuthIdentity } from "../auth/authPort";
import type { SignOutStatus } from "../auth/AuthProvider";
import type { SearchResult, Todo } from "../types/domain";
import { CloudAppShell } from "../components/app-shell/CloudAppShell";
import {
  GlobalAddTodoController,
  useGlobalAddTodo,
} from "../components/global-add/GlobalAddTodoController";
import { SearchDialog } from "../components/search/SearchDialog";
import type { TodoService } from "../features/todos/todoService";
import { TodoEditDialog } from "../features/todos/TodoFormDialog";
import type { CalendarService } from "../features/calendar/calendarService";
import { CollectionEditor } from "../features/collections/CollectionEditor";
import type {
  CollectionKind,
  CollectionRecord,
  CollectionService,
} from "../features/collections/collectionService";
import type { DriveService } from "../features/classes/driveService";
import type { NavigationCache } from "./navigationCache";
import type { WorkspaceData } from "./workspaceData";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { useWorkspace, WorkspaceProvider } from "./workspaceStore";
import "./workspace.css";

// Route-level chunks: calendar (Temporal polyfill), classes (pdfjs), todos board, collections.
const loadHomePage = () =>
  import("../features/calendar/HomePage").then((m) => ({ default: m.HomePage }));
const loadSettingsPage = () =>
  import("../features/calendar/SettingsPage").then((m) => ({ default: m.SettingsPage }));
const loadTodosWorkspaceContent = () =>
  import("../features/todos/TodosWorkspace").then((m) => ({ default: m.TodosWorkspaceContent }));
const loadClassesPage = () =>
  import("../features/classes/ClassesPage").then((m) => ({ default: m.ClassesPage }));
const loadCollectionPage = () =>
  import("../features/collections/CollectionPage").then((m) => ({ default: m.CollectionPage }));

const HomePage = lazy(loadHomePage);
const SettingsPage = lazy(loadSettingsPage);
const TodosWorkspaceContent = lazy(loadTodosWorkspaceContent);
const ClassesPage = lazy(loadClassesPage);
const CollectionPage = lazy(loadCollectionPage);

/** Warms the route chunks so navigation doesn't wait on network once data is cached. */
export function preloadWorkspaceChunks() {
  void loadHomePage();
  void loadSettingsPage();
  void loadTodosWorkspaceContent();
  void loadClassesPage();
  void loadCollectionPage();
}

export interface MainWorkspaceProps {
  identity: AuthIdentity;
  signOutStatus: SignOutStatus;
  onSignOut(): Promise<void>;
  todoService: TodoService;
  collectionService: CollectionService;
  calendarService: CalendarService;
  driveService?: DriveService;
  workspaceData: WorkspaceData;
  /** Shared session read cache; the store creates a private one when omitted. */
  cache?: NavigationCache;
}

export function MainWorkspace(props: MainWorkspaceProps) {
  return (
    <WorkspaceProvider
      identity={props.identity}
      workspaceData={props.workspaceData}
      cache={props.cache}
    >
      <WorkspaceCapture {...props} />
    </WorkspaceProvider>
  );
}

function WorkspaceCapture(props: MainWorkspaceProps) {
  const { projects, classes, invalidate } = useWorkspace();
  const [notice, setNotice] = useState("");
  return (
    <GlobalAddTodoController
      workspaceSessionKey={props.identity.userId}
      service={props.todoService}
      projects={projects}
      classes={classes}
      onCreated={() => {
        invalidate();
        setNotice("Task added");
        return undefined;
      }}
    >
      <Routes>
        <Route element={<WorkspaceLayout {...props} notice={notice} setNotice={setNotice} />}>
          <Route element={<WorkspaceContent />}>
            <Route index element={<HomeRoute {...props} />} />
            <Route
              path="todos"
              element={
                <TodosWorkspaceContent
                  service={props.todoService}
                  workspaceSessionKey={props.identity.userId}
                />
              }
            />
            <Route path="projects" element={<CollectionRoute {...props} kind="project" />} />
            <Route path="projects/:id" element={<CollectionRoute {...props} kind="project" />} />
            <Route path="ideas" element={<CollectionRoute {...props} kind="idea" />} />
            <Route path="media" element={<CollectionRoute {...props} kind="media" />} />
            <Route path="classes" element={<ClassesRoute {...props} />} />
            <Route path="classes/:id" element={<ClassesRoute {...props} />} />
            <Route path="settings" element={<SettingsRoute {...props} />} />
            <Route
              path="*"
              element={
                <section className="workspace-page">
                  <h1>Page not found</h1>
                  <Link to="/">Back to Home</Link>
                </section>
              }
            />
          </Route>
        </Route>
      </Routes>
    </GlobalAddTodoController>
  );
}

/** Nested outlet inside the shell's main region: project warning plus lazy page chunks. */
function WorkspaceContent() {
  const { projectError, invalidate } = useWorkspace();
  return (
    <>
      {projectError && (
        <p className="workspace-project-warning">
          Project or class choices couldn’t load. <button onClick={invalidate}>Try again</button>
        </p>
      )}
      <Suspense
        fallback={
          <section className="workspace-page">
            <p role="status">Loading…</p>
          </section>
        }
      >
        <Outlet />
      </Suspense>
    </>
  );
}

function ProfilePlaceholder({ title }: { title: string }) {
  const { profileError, retryProfile } = useWorkspace();
  return (
    <section className="workspace-page">
      <h1>{title}</h1>
      {profileError ? (
        <div role="alert">
          <p>Couldn’t load your workspace. Your records are still saved.</p>
          <button onClick={retryProfile}>Try again</button>
        </div>
      ) : (
        <p role="status">Loading your workspace…</p>
      )}
    </section>
  );
}

function HomeRoute(props: MainWorkspaceProps) {
  const { profile, projects, classes } = useWorkspace();
  if (!profile) return <ProfilePlaceholder title="Home" />;
  return (
    <div className="workspace-home-scroll">
      <HomePage
        appearanceService={props.workspaceData.homeAppearance}
        todoService={props.todoService}
        calendarService={props.calendarService}
        profile={profile}
        projects={projects}
        classes={classes}
        workspaceSessionKey={props.identity.userId}
      />
    </div>
  );
}

function SettingsRoute(props: MainWorkspaceProps) {
  const { profile } = useWorkspace();
  if (!profile) return <ProfilePlaceholder title="Settings" />;
  return (
    <SettingsPage
      calendarService={props.calendarService}
      profile={profile}
      onSignOut={props.onSignOut}
    />
  );
}

function ClassesRoute(props: MainWorkspaceProps) {
  const { profile, invalidate } = useWorkspace();
  const { id } = useParams();
  return (
    <ClassesPage
      key={props.identity.userId}
      onClassesChanged={invalidate}
      userId={props.identity.userId}
      courseId={id}
      driveService={props.driveService}
      assignmentService={props.workspaceData.assignments}
      classService={props.workspaceData.classes}
      noteService={props.workspaceData.notes}
      timezone={profile?.timezone}
    />
  );
}

function CollectionRoute({ kind, ...props }: MainWorkspaceProps & { kind: CollectionKind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <CollectionPage
      key={`${kind}:${id ?? ""}`}
      kind={kind}
      service={props.collectionService}
      todoService={props.todoService}
      recordId={id}
      onOpenProject={(projectId) => navigate(`/projects/${encodeURIComponent(projectId)}`)}
      onBack={() => navigate("/projects")}
    />
  );
}

function WorkspaceLayout({
  notice,
  setNotice,
  ...props
}: MainWorkspaceProps & { notice: string; setNotice(value: string): void }) {
  const { openTodoComposer } = useGlobalAddTodo();
  const { projects, classes, invalidate, dialogs } = useWorkspace();
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editor, setEditor] = useState<{
    kind: CollectionKind;
    record?: CollectionRecord;
    fromSearch?: boolean;
  } | null>(null);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const initialPath = useRef(location.pathname);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.altKey) {
        event.preventDefault();
        if (!dialogs.isOpen()) setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogs]);
  useEffect(() => {
    // In-app navigation moves focus to the new page; history traversal keeps the browser's own focus.
    if (location.pathname === initialPath.current || navigationType === "POP") return;
    initialPath.current = location.pathname;
    rootRef.current?.querySelector<HTMLElement>("#cloud-main-content")?.focus();
  }, [location.pathname, navigationType]);
  async function selectResult(result: SearchResult) {
    if (result.recordType === "project") {
      navigate(`/projects/${encodeURIComponent(result.recordId)}`);
      setSearchOpen(false);
      return;
    }
    if (result.recordType === "todo") {
      const todo = await props.collectionService.getTodo(result.recordId);
      if (!alive.current) return;
      setEditingTodo(todo);
    } else {
      const kind = result.recordType;
      const record =
        kind === "idea"
          ? await props.collectionService.getIdea(result.recordId)
          : await props.collectionService.getMedia(result.recordId);
      if (!alive.current) return;
      setEditor({ kind, record, fromSearch: true });
    }
    setSearchOpen(false);
  }
  return (
    <div ref={rootRef}>
      <CloudAppShell
        identity={props.identity}
        signOutStatus={props.signOutStatus}
        onSignOut={props.onSignOut}
        onOpenGlobalAdd={() => setAddOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />
      {addOpen && (
        <WorkspaceDialog title="Add to orbitOS" onClose={() => setAddOpen(false)}>
          <div className="workspace-add-choices">
            <button
              onClick={() => {
                setAddOpen(false);
                openTodoComposer();
              }}
            >
              Task
            </button>
            {(["idea", "media", "project"] as const).map((kind) => (
              <button
                key={kind}
                onClick={() => {
                  setAddOpen(false);
                  setEditor({ kind });
                }}
              >
                {kind[0].toUpperCase() + kind.slice(1)}
              </button>
            ))}
            <a
              href="https://calendar.google.com/calendar/u/0/r/eventedit"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setAddOpen(false)}
            >
              Calendar event ↗
            </a>
          </div>
        </WorkspaceDialog>
      )}
      {editor && (
        <CollectionEditor
          key={`${editor.kind}:${editor.record?.id ?? "new"}`}
          {...editor}
          service={props.collectionService}
          projects={projects}
          onSaved={() => {
            const returnToSearch = editor.fromSearch;
            setEditor(null);
            invalidate();
            setNotice("Saved");
            if (returnToSearch) setSearchOpen(true);
          }}
          onClose={() => {
            const returnToSearch = editor.fromSearch;
            setEditor(null);
            if (returnToSearch) setSearchOpen(true);
          }}
        />
      )}
      <TodoEditDialog
        todo={editingTodo}
        projects={projects}
        classes={classes}
        fallbackFocusRef={rootRef}
        onClose={() => {
          setEditingTodo(null);
          setSearchOpen(true);
        }}
        onSave={async (id, input, options) => {
          await props.todoService.updateTodoDetails(id, input, options);
          if (alive.current) {
            invalidate();
            setNotice("Task saved");
          }
        }}
      />
      <SearchDialog
        open={searchOpen}
        service={props.collectionService}
        onClose={() => setSearchOpen(false)}
        onSelect={selectResult}
      />
      {notice && (
        <aside className="workspace-notice">
          <p role="status">{notice}</p>
          <button onClick={() => setNotice("")}>Dismiss</button>
        </aside>
      )}
    </div>
  );
}
