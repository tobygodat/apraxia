import { useEffect, useMemo } from "react";
import { registerUserStateResetter } from "../auth/userState";
import { primeCoverImage } from "../features/calendar/HomeHeader";
import { MainWorkspace, preloadWorkspaceChunks, type MainWorkspaceProps } from "./MainWorkspace";
import { cacheNavigationService, NavigationCache } from "./navigationCache";
import { WorkspacePreferencesProvider } from "./workspacePreferences";

/** Shared by the authenticated app and local QA, including navigation timing. */
export function WorkspaceRuntime(props: MainWorkspaceProps) {
  const cache = useMemo(
    () => new NavigationCache(),
    // Reset keys, not inputs: a new account or provider must start an empty cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.identity.userId, props.todoService, props.collectionService, props.calendarService],
  );
  const todoService = useMemo(
    () =>
      cacheNavigationService(
        props.todoService,
        cache,
        "todos",
        ["loadWorkspace", "loadToday"],
        [
          "createTodo",
          "updateTodoDetails",
          "setTodoCompleted",
          "softDeleteTodo",
          "restoreTodo",
          "reorderToday",
        ],
      ),
    [props.todoService, cache],
  );
  const collectionService = useMemo(
    () =>
      cacheNavigationService(
        props.collectionService,
        cache,
        "collections",
        ["listProjects", "listIdeas", "getProject", "getIdea", "getTodo", "projectTodos"],
        ["saveProject", "saveIdea", "softDelete", "restore"],
      ),
    [props.collectionService, cache],
  );
  const calendarService = useMemo(
    () =>
      cacheNavigationService(
        { ...props.calendarService, invalidate: cache.invalidate },
        cache,
        "calendar",
        ["status", "calendars", "week"],
        ["connect", "disconnect", "setVisibility"],
      ),
    [props.calendarService, cache],
  );
  const workspaceData = useMemo(
    () => ({
      ...props.workspaceData,
      // Class and assignment writes drop cached task reads: assignments are todos.
      classes: props.workspaceData.classes
        ? cacheNavigationService(
            props.workspaceData.classes,
            cache,
            "classes",
            ["list"],
            ["create", "rename", "importLegacy"],
          )
        : undefined,
      assignments: props.workspaceData.assignments
        ? cacheNavigationService(
            props.workspaceData.assignments,
            cache,
            "assignments",
            [],
            ["create", "update", "remove", "restore"],
          )
        : undefined,
      homeAppearance: props.workspaceData.homeAppearance
        ? cacheNavigationService(
            props.workspaceData.homeAppearance,
            cache,
            "homeAppearance",
            ["load"],
            ["save"],
          )
        : undefined,
    }),
    [props.workspaceData, cache],
  );
  useEffect(() => {
    const unregister = registerUserStateResetter(cache.clear, { phase: "cancel" });
    return () => {
      unregister();
      cache.clear();
    };
  }, [cache]);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const timer = window.setTimeout(() => {
      void Promise.allSettled([
        todoService.loadWorkspace({ signal }),
        collectionService.listProjects({ offset: 0, signal }).then((projects) => {
          if (typeof collectionService.getProject !== "function") return;
          const targets = projects.slice(0, 24);
          void Promise.allSettled(
            targets.flatMap((project) => [
              collectionService.getProject(project.id),
              collectionService.projectTodos(project.id, 0),
              collectionService.listIdeas({ projectId: project.id, offset: 0, signal }),
            ]),
          );
        }),
        collectionService.listIdeas({ offset: 0, signal }),
        workspaceData.homeAppearance?.load(props.identity.userId, signal).then((appearance) => {
          if (appearance.coverImage) primeCoverImage(appearance.coverImage);
        }),
      ]);
    }, 100);
    let idleHandle: number | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    if (typeof window.requestIdleCallback === "function") {
      // A timeout guarantees this still runs within 2s under sustained
      // main-thread activity, where an idle period might otherwise never
      // arrive.
      idleHandle = window.requestIdleCallback(() => preloadWorkspaceChunks(), { timeout: 2000 });
    } else {
      idleTimer = setTimeout(() => preloadWorkspaceChunks(), 1500);
    }
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (idleHandle !== undefined && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
      if (idleTimer !== undefined) clearTimeout(idleTimer);
    };
  }, [todoService, collectionService, workspaceData, props.identity.userId]);
  return (
    <WorkspacePreferencesProvider>
      <MainWorkspace
        {...props}
        cache={cache}
        workspaceData={workspaceData}
        todoService={todoService}
        collectionService={collectionService}
        calendarService={calendarService}
      />
    </WorkspacePreferencesProvider>
  );
}
