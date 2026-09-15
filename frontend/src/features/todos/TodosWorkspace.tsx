import { useMemo, useRef, useState } from "react";

import { CloudAppShell, type CloudAppShellProps } from "../../components/app-shell/CloudAppShell";
import {
  GlobalAddTodoController,
  useGlobalAddTodo,
} from "../../components/global-add/GlobalAddTodoController";
import { GlobalAddTodoShell } from "../../components/global-add/GlobalAddTodoShell";
import type { Profile, Todo } from "../../types/domain";
import { shiftWeekMonday, startOfWeekMonday, type SqlDate } from "./dateDomain";
import { buildTodoBoardModel } from "./todoBoardModel";
import { type TodoControllerBinding, useTodoController } from "./todoController";
import { TodoFormDialog } from "./TodoFormDialog";
import type { TodoService } from "./todoService";
import { TodosBoard } from "./TodosBoard";
import { todoLoadErrorCopy } from "./todoUiState";
import { useLocalToday } from "./useLocalToday";

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

function BoardPlaceholder({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <section className="todos-board-page" aria-labelledby="todos-loading-heading">
      <header className="todos-board-toolbar">
        <h1 id="todos-loading-heading">Tasks</h1>
      </header>
      {failed ? (
        <div className="todos-board-error" role="alert">
          <p>{todoLoadErrorCopy("Tasks")}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <p className="todos-board-status" role="status">
          Loading your tasks…
        </p>
      )}
    </section>
  );
}

/** Route content uses the app-level capture provider and keeps its board position. */
export function TodosWorkspaceContent({
  service,
  workspaceSessionKey,
}: {
  service: TodoService;
  workspaceSessionKey: string;
}) {
  const binding = useTodoController(service, workspaceSessionKey, { workspace: true });
  if (binding.state.profile)
    return <ReadyTodosBoard binding={binding} profile={binding.state.profile} />;
  return (
    <BoardPlaceholder
      failed={binding.state.workspaceStatus === "error"}
      onRetry={() => {
        void binding.controller.loadWorkspace();
      }}
    />
  );
}

function TodosWorkspaceSession(props: TodosWorkspaceProps) {
  const binding = useTodoController(props.service, props.workspaceSessionKey, { workspace: true });
  const { state, controller } = binding;
  const profile = state.profile;
  const ready =
    state.workspaceStatus === "ready" &&
    profile !== null &&
    profile.userId === props.identity.userId;

  if (!ready || profile === null) {
    const failed =
      state.workspaceStatus === "error" ||
      (profile !== null && profile.userId !== props.identity.userId);
    return (
      <CloudAppShell
        {...props}
        availableDestinations={["/todos"]}
        settingsAvailable={false}
        globalAddDisabled
        onOpenGlobalAdd={() => undefined}
      >
        <BoardPlaceholder
          failed={failed}
          onRetry={() => {
            void controller.loadWorkspace();
          }}
        />
      </CloudAppShell>
    );
  }

  return (
    <GlobalAddTodoController
      workspaceSessionKey={props.workspaceSessionKey}
      service={props.service}
      projects={state.projects}
      classes={state.classes}
      onCreated={(todo) => {
        if (!controller.acceptCreatedTodo(todo)) {
          throw new Error("Saved todo requires a fresh workspace view.");
        }
        return undefined;
      }}
    >
      <GlobalAddTodoShell {...props} availableDestinations={["/todos"]} settingsAvailable={false}>
        <ReadyTodosBoard binding={binding} profile={profile} />
      </GlobalAddTodoShell>
    </GlobalAddTodoController>
  );
}

function ReadyTodosBoard({
  binding: { state, controller },
  profile,
}: {
  readonly binding: TodoControllerBinding;
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
    () => buildTodoBoardModel(state.todos, visibleMonday, today),
    [state.todos, today, visibleMonday],
  );

  return (
    <div ref={boardFocusRef} tabIndex={-1}>
      <TodosBoard
        model={model}
        loadStatus={state.workspaceStatus}
        projects={state.projects}
        pendingTodoIds={state.pendingTodoIds}
        mutationResult={state.mutationResult}
        mutationError={state.mutationError}
        undoNotice={state.undoNotice}
        announcement={state.announcement}
        onPreviousWeek={() => setSelectedMonday(shiftWeekMonday(visibleMonday, -1))}
        onNextWeek={() => setSelectedMonday(shiftWeekMonday(visibleMonday, 1))}
        onToday={() => setSelectedMonday(null)}
        onRetry={() => {
          void controller.loadWorkspace();
        }}
        onAddTodo={(dueDate) => openTodoComposer({ initialDueDate: dueDate })}
        onToggleComplete={(todo) => controller.setCompleted(todo.id, !todo.completed)}
        onEditTodo={setEditingTodo}
        onDeleteTodo={(todo) => controller.deleteTodo(todo.id)}
        onRescheduleTodo={(todo, dueDate) => {
          void controller
            .updateDetails(
              todo.id,
              dueDate === null ? { dueDate: null, dueTime: null } : { dueDate },
              undefined,
              "reschedule",
            )
            .catch(() => {});
        }}
        onUndoDelete={() => {
          controller.undoDelete();
        }}
        onDismissUndo={controller.dismissUndo}
      />
      <TodoFormDialog
        mode="edit"
        open={editingTodo !== null}
        todo={editingTodo}
        projects={state.projects}
        classes={state.classes}
        fallbackFocusRef={boardFocusRef}
        onClose={() => setEditingTodo(null)}
        onSubmit={async (submission, options) => {
          if (submission.mode !== "create")
            await controller.updateDetails(submission.todoId, submission.input, options);
        }}
      />
    </div>
  );
}
