import { useEffect, useMemo, useRef, useState } from "react";

import { CloudAppShell, type CloudAppShellProps } from "../../components/app-shell/CloudAppShell";
import { GlobalAddTodoController, useGlobalAddTodo } from "../../components/global-add/GlobalAddTodoController";
import { GlobalAddTodoShell } from "../../components/global-add/GlobalAddTodoShell";
import type { Profile, Todo } from "../../types/domain";
import { shiftWeekMonday, startOfWeekMonday, type SqlDate } from "./dateDomain";
import { buildTodoBoardModel } from "./todoBoardModel";
import { TodoEditDialog } from "./TodoEditDialog";
import type { TodoService } from "./todoService";
import { TodosBoard } from "./TodosBoard";
import { useLocalToday } from "./useLocalToday";
import { type TodoWorkspaceController, useTodoWorkspaceController } from "./useTodoWorkspaceController";

export interface TodosWorkspaceProps extends Pick<
  CloudAppShellProps,
  "identity" | "signOutStatus" | "onSignOut"
> {
  readonly service: TodoService;
  /** Authenticated client-state lifetime, never a provider ownership argument. */
  readonly workspaceSessionKey: string;
}

/**
 * Complete provider-injected Todos slice, mounted at the authenticated /todos
 * route with the generated-type Supabase adapter.
 */
export function TodosWorkspace(props: TodosWorkspaceProps) {
  return <TodosWorkspaceSession key={props.workspaceSessionKey} {...props} />;
}

/** Route content uses the app-level capture provider and keeps its board position. */
export function TodosWorkspaceContent({ service, workspaceSessionKey, refreshKey }: {
  service: TodoService; workspaceSessionKey: string; refreshKey: number;
}) {
  const controller = useTodoWorkspaceController(service, workspaceSessionKey);
  const applied = useRef(refreshKey);
  useEffect(() => {
    if (applied.current === refreshKey || !controller.profile || controller.pendingTodoIds.size > 0) return;
    applied.current = refreshKey;
    void controller.refreshWorkspace();
  }, [refreshKey, controller.profile, controller.pendingTodoIds, controller.refreshWorkspace]);
  if (controller.profile) return <ReadyTodosBoard controller={controller} profile={controller.profile} />;
  return <section className="todos-board-page">
    <header className="todos-board-toolbar"><h1>Todos</h1></header>
    {controller.loadState.status === "error" ? <div className="todos-board-error" role="alert">
      <p>Couldn’t load your todos. Try again.</p><button onClick={controller.retryLoad}>Try again</button>
    </div> : <p className="todos-board-status" role="status">Loading your todos…</p>}
  </section>;
}

function TodosWorkspaceSession(props: TodosWorkspaceProps) {
  const controller = useTodoWorkspaceController(props.service, props.workspaceSessionKey);
  const profile = controller.profile;
  const ready = controller.loadState.status === "idle" &&
    profile !== null && profile.userId === props.identity.userId;

  if (!ready || profile === null) {
    const failed = controller.loadState.status === "error" ||
      (profile !== null && profile.userId !== props.identity.userId);

    return (
      <CloudAppShell {...props} availableDestinations={["/todos"]} settingsAvailable={false} globalAddDisabled onOpenGlobalAdd={() => undefined}>
        <section className="todos-board-page" aria-labelledby="todos-loading-heading">
          <header className="todos-board-toolbar"><h1 id="todos-loading-heading">Todos</h1></header>
          {failed ? (
            <div className="todos-board-error" role="alert">
              <p>Couldn’t load your todos. Try again.</p>
              <button type="button" onClick={controller.retryLoad}>Try again</button>
            </div>
          ) : <p className="todos-board-status" role="status">Loading your todos…</p>}
        </section>
      </CloudAppShell>
    );
  }

  return (
    <GlobalAddTodoController
      workspaceSessionKey={props.workspaceSessionKey}
      service={props.service}
      projects={controller.projects}
      onCreated={(todo) => {
        if (!controller.acceptCreatedTodo(todo)) {
          throw new Error("Saved todo requires a fresh workspace view.");
        }
        return undefined;
      }}
    >
      <GlobalAddTodoShell {...props} availableDestinations={["/todos"]} settingsAvailable={false}>
        <ReadyTodosBoard controller={controller} profile={profile} />
      </GlobalAddTodoShell>
    </GlobalAddTodoController>
  );
}

function ReadyTodosBoard({
  controller,
  profile,
}: {
  readonly controller: TodoWorkspaceController;
  readonly profile: Profile;
}) {
  const { openTodoComposer } = useGlobalAddTodo();
  const today = useLocalToday(profile.timezone);
  // null follows the current week across local midnight; explicit navigation
  // remains on its selected Monday until the user chooses Today.
  const [selectedMonday, setSelectedMonday] = useState<SqlDate | null>(null);
  const visibleMonday = selectedMonday ?? startOfWeekMonday(today);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const boardFocusRef = useRef<HTMLDivElement>(null);
  const model = useMemo(
    () => buildTodoBoardModel(controller.todos, visibleMonday, today),
    [controller.todos, today, visibleMonday],
  );

  return (
    <div ref={boardFocusRef} tabIndex={-1}>
      <TodosBoard
        model={model}
        loadState={controller.loadState}
        projects={controller.projects}
        pendingTodoIds={controller.pendingTodoIds}
        mutationResult={controller.mutationResult}
        mutationError={controller.mutationError}
        undoNotice={controller.undoNotice}
        onPreviousWeek={() => setSelectedMonday(shiftWeekMonday(visibleMonday, -1))}
        onNextWeek={() => setSelectedMonday(shiftWeekMonday(visibleMonday, 1))}
        onToday={() => setSelectedMonday(null)}
        onRetry={controller.retryLoad}
        onAddTodo={(dueDate) => openTodoComposer({ initialDueDate: dueDate })}
        onToggleComplete={(todo) => controller.setCompleted(todo.id, !todo.completed)}
        onEditTodo={setEditingTodo}
        onDeleteTodo={(todo) => controller.deleteTodo(todo.id)}
      />
      <TodoEditDialog
        todo={editingTodo}
        projects={controller.projects}
        fallbackFocusRef={boardFocusRef}
        onClose={() => setEditingTodo(null)}
        onSave={async (todoId, input, options) => {
          await controller.updateDetails(todoId, input, options);
        }}
      />
    </div>
  );
}
