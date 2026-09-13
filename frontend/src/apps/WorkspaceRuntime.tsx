import { useEffect, useMemo } from "react";
import { registerUserStateResetter } from "../auth/userState";
import { MainWorkspace, type MainWorkspaceProps } from "./MainWorkspace";
import { cacheNavigationService, NavigationCache } from "./navigationCache";

/** Shared by the authenticated app and local QA, including navigation timing. */
export function WorkspaceRuntime(props: MainWorkspaceProps) {
  const cache = useMemo(() => new NavigationCache(), [props.identity.userId, props.todoService, props.collectionService, props.calendarService]);
  const todoService = useMemo(() => cacheNavigationService(props.todoService, cache, "todos",
    ["loadWorkspace", "loadToday"], ["createTodo", "updateTodoDetails", "setTodoCompleted", "softDeleteTodo", "restoreTodo", "reorderToday"]), [props.todoService, cache]);
  const collectionService = useMemo(() => cacheNavigationService(props.collectionService, cache, "collections",
    ["listProjects", "listIdeas", "listMedia", "getProject", "getIdea", "getMedia", "getTodo", "projectTodos"],
    ["saveProject", "saveIdea", "saveMedia", "softDelete", "restore"]), [props.collectionService, cache]);
  const calendarService = useMemo(() => ({ ...cacheNavigationService(props.calendarService, cache, "calendar",
    ["status", "calendars", "week"], ["connect", "disconnect", "setVisibility"]), invalidate: cache.invalidate }), [props.calendarService, cache]);
  useEffect(() => {
    const unregister = registerUserStateResetter(cache.clear, { phase: "cancel" });
    const refresh = () => cache.invalidate();
    window.addEventListener("focus", refresh);
    return () => { unregister(); window.removeEventListener("focus", refresh); cache.clear(); };
  }, [cache]);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const timer = window.setTimeout(() => {
      void Promise.allSettled([
        todoService.loadWorkspace({ signal }),
        collectionService.listProjects({ status: "active", mediaType: "all", offset: 0, signal }),
        collectionService.listIdeas({ status: "all", mediaType: "all", offset: 0, signal }),
        collectionService.listMedia({ status: "all", mediaType: "all", offset: 0, signal }),
      ]);
    }, 100);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [todoService, collectionService]);
  return <MainWorkspace {...props} todoService={todoService} collectionService={collectionService} calendarService={calendarService} />;
}
