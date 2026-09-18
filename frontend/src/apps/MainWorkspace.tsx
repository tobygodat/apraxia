import {
  createElement,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
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
import { localToday, startOfWeekSunday } from "../features/todos/dateDomain";
import type { CalendarService } from "../features/calendar/calendarService";
import { CollectionEditor } from "../features/collections/CollectionEditor";
import type {
  CollectionKind,
  CollectionRecord,
  CollectionService,
} from "../features/collections/collectionService";
import type { DriveService } from "../features/classes/driveService";
import { ColdLoadGate, useColdLoad } from "./coldLoad";
import type { NavigationCache } from "./navigationCache";
import type { WorkspaceData } from "./workspaceData";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceErrorBoundary } from "../components/WorkspaceErrorBoundary";
import { useWorkspace, WorkspaceProvider } from "./workspaceStore";
import "./workspace.css";

/**
 * Wraps a route chunk loader so a route whose chunk was already resolved by
 * `preload()` mounts synchronously with the real component — no `React.lazy`
 * suspend, so no `Suspense` fallback commit and no cold-load gate for it.
 * `React.lazy` itself still owns the fallback path for a route visited
 * before its `preload()` (or the promise it started) has resolved: the
 * dynamic import is deduped by the module specifier, so calling `load()`
 * again here is cheap, not a second fetch.
 */
function preloadable<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): { preload(): Promise<void>; Component: ComponentType<P> } {
  let Resolved: ComponentType<P> | undefined;
  const Lazy = lazy(load);
  // `Lazy` (a `LazyExoticComponent<ComponentType<P>>`) is functionally a
  // `ComponentType<P>` at runtime but isn't structurally recognized as one
  // by JSX/`createElement`'s generic prop checking; the cast reflects that,
  // not a real type hole. The element type is chosen once per mounted
  // instance: if the chunk resolves after a route already mounted through
  // `Lazy`, switching to `Resolved` on the next render would change the
  // element type and remount the whole page (state, scroll, effects).
  const Component: ComponentType<P> = (props: P) => {
    const [Type] = useState(() => (Resolved ?? Lazy) as ComponentType<P>);
    return createElement(Type, props);
  };
  const preload = (): Promise<void> =>
    load().then((module) => {
      Resolved = module.default;
    });
  return { preload, Component };
}

// Route-level chunks: calendar (Temporal polyfill), classes (pdfjs), todos board,
// weekly review, collections.
// Each call names its prop type explicitly via a type-only dynamic import
// query (erased at build time, no extra bundling): letting `preloadable`'s
// type parameter infer purely from the loader's return type hits a known
// TypeScript generic-inference limitation for a type used in both a
// function's parameter and its result.
const homeChunk = preloadable<
  Parameters<(typeof import("../features/calendar/HomePage"))["HomePage"]>[0]
>(() => import("../features/calendar/HomePage").then((m) => ({ default: m.HomePage })));
const settingsChunk = preloadable<
  Parameters<(typeof import("../features/calendar/SettingsPage"))["SettingsPage"]>[0]
>(() => import("../features/calendar/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const todosChunk = preloadable<
  Parameters<(typeof import("../features/todos/TodosWorkspace"))["TodosWorkspaceContent"]>[0]
>(() =>
  import("../features/todos/TodosWorkspace").then((m) => ({ default: m.TodosWorkspaceContent })),
);
const classesChunk = preloadable<
  Parameters<(typeof import("../features/classes/ClassesPage"))["ClassesPage"]>[0]
>(() => import("../features/classes/ClassesPage").then((m) => ({ default: m.ClassesPage })));
const reviewChunk = preloadable<
  Parameters<(typeof import("../features/review/WeeklyReviewPage"))["WeeklyReviewPage"]>[0]
>(() =>
  import("../features/review/WeeklyReviewPage").then((m) => ({ default: m.WeeklyReviewPage })),
);
const collectionChunk = preloadable<
  Parameters<(typeof import("../features/collections/CollectionPage"))["CollectionPage"]>[0]
>(() =>
  import("../features/collections/CollectionPage").then((m) => ({ default: m.CollectionPage })),
);

const HomePage = homeChunk.Component;
const SettingsPage = settingsChunk.Component;
const TodosWorkspaceContent = todosChunk.Component;
const ClassesPage = classesChunk.Component;
const WeeklyReviewPage = reviewChunk.Component;
const CollectionPage = collectionChunk.Component;

/** Warms the route chunks so navigation doesn't wait on network once data is cached. */
export function preloadWorkspaceChunks(): Promise<void> {
  return Promise.all([
    homeChunk.preload(),
    settingsChunk.preload(),
    todosChunk.preload(),
    classesChunk.preload(),
    reviewChunk.preload(),
    collectionChunk.preload(),
  ]).then(() => undefined);
}

/** Starts loading only the chunk that `pathname` will render; undefined for other paths. */
export function preloadRouteChunk(pathname: string): Promise<void> | undefined {
  const chunk =
    pathname === "/"
      ? homeChunk
      : pathname.startsWith("/todos")
        ? todosChunk
        : pathname.startsWith("/projects") || pathname.startsWith("/ideas")
          ? collectionChunk
          : pathname.startsWith("/classes")
            ? classesChunk
            : pathname.startsWith("/review")
              ? reviewChunk
              : pathname.startsWith("/settings")
                ? settingsChunk
                : undefined;
  return chunk?.preload();
}

// The first page's chunk downloads while the session is still restoring,
// instead of only once the workspace has mounted and asked for it. Skipped
// under Vitest so component tests control their own chunk loading, and in
// legacy builds, which carry this module but never render the cloud routes.
if (
  typeof window !== "undefined" &&
  import.meta.env.MODE !== "test" &&
  import.meta.env.VITE_APRAXIA_RUNTIME !== "legacy"
)
  void preloadRouteChunk(window.location.pathname)?.catch(() => undefined);

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

/**
 * Warms the Home page's calendar/today reads once the profile (and its
 * timezone) is known, so a first visit to Home from another route finds
 * the navigation cache already seeded instead of showing loading placeholders.
 * Skips entirely when Home is already the current route: HomePage's own
 * effects own that request there.
 */
function HomeDataPreload({
  todoService,
  calendarService,
}: Pick<MainWorkspaceProps, "todoService" | "calendarService">) {
  const { profile } = useWorkspace();
  const location = useLocation();
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !profile || location.pathname === "/") return undefined;
    started.current = true;
    const controller = new AbortController();
    const signal = controller.signal;
    const today = localToday(profile.timezone);
    const sunday = startOfWeekSunday(today);
    const tasks: Promise<unknown>[] = [];
    if (typeof todoService.loadToday === "function")
      tasks.push(todoService.loadToday(today, { signal }));
    if (typeof calendarService.status === "function")
      tasks.push(
        calendarService
          .status(signal)
          .then((status) =>
            status?.connectionState === "connected"
              ? calendarService.week(sunday, signal)
              : undefined,
          ),
      );
    void Promise.allSettled(tasks);
    return () => controller.abort();
  }, [profile, location.pathname, todoService, calendarService]);
  return null;
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
      <HomeDataPreload todoService={props.todoService} calendarService={props.calendarService} />
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
            <Route path="classes" element={<ClassesRoute {...props} />} />
            <Route path="review" element={<ReviewRoute {...props} />} />
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

/** Suspense fallback: stays invisible under the cold-load gate, sr-only status only. */
function RouteSuspenseFallback() {
  useColdLoad(true);
  return (
    <p className="cloud-shell__sr-only" role="status" aria-live="polite">
      Loading…
    </p>
  );
}

/** Nested outlet inside the shell's main region: project warning plus lazy page chunks. */
function WorkspaceContent() {
  const { projectError, invalidate } = useWorkspace();
  const location = useLocation();
  return (
    <>
      {projectError && (
        <p className="workspace-project-warning">
          Project or class choices couldn’t load. <button onClick={invalidate}>Try again</button>
        </p>
      )}
      <ColdLoadGate key={location.pathname}>
        <WorkspaceErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<RouteSuspenseFallback />}>
            <Outlet />
          </Suspense>
        </WorkspaceErrorBoundary>
      </ColdLoadGate>
    </>
  );
}

function ProfilePlaceholder({ title }: { title: string }) {
  const { profileError, retryProfile } = useWorkspace();
  useColdLoad(!profileError);
  return (
    <section className="workspace-page">
      <h1>{title}</h1>
      {profileError ? (
        <div role="alert">
          <p>Couldn’t load your workspace. Your records are still saved.</p>
          <button onClick={retryProfile}>Try again</button>
        </div>
      ) : (
        <p className="cloud-shell__sr-only" role="status" aria-live="polite">
          Loading your workspace…
        </p>
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
  const { profile, invalidate } = useWorkspace();
  const { workspaceData, identity } = props;
  const saveTimezone = useCallback(
    async (timezone: string) => {
      await workspaceData.setTimezone(identity.userId, timezone);
      // Today, the board, and the calendar all derive dates from the profile.
      invalidate();
    },
    [workspaceData, identity.userId, invalidate],
  );
  if (!profile) return <ProfilePlaceholder title="Settings" />;
  return (
    <SettingsPage
      calendarService={props.calendarService}
      profile={profile}
      onSignOut={props.onSignOut}
      onSaveTimezone={saveTimezone}
    />
  );
}

function ReviewRoute(props: MainWorkspaceProps) {
  const { profile } = useWorkspace();
  if (!profile) return <ProfilePlaceholder title="Weekly review" />;
  return (
    <WeeklyReviewPage
      service={props.todoService}
      profile={profile}
      workspaceSessionKey={props.identity.userId}
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
      const record = await props.collectionService.getIdea(result.recordId);
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
        <WorkspaceDialog title="Add to apraxia" onClose={() => setAddOpen(false)}>
          <div className="workspace-add-choices">
            <button
              onClick={() => {
                setAddOpen(false);
                openTodoComposer();
              }}
            >
              Task
            </button>
            {(["idea", "project"] as const).map((kind) => (
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
