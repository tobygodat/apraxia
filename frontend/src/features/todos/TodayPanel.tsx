import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Profile, ClassSummary, ProjectSummary, Todo } from "../../types/domain";
import { TodayList } from "./TodayList";
import { type TodayListController, useTodayListController } from "./todayListController";
import { TodoComposerDialog } from "./TodoComposerDialog";
import { TodoEditDialog } from "./TodoEditDialog";
import type { TodoService } from "./todoService";
import { useLocalToday } from "./useLocalToday";
import { addSqlDateDays } from "./dateDomain";
import "./TodayPanel.css";

export interface TodayPanelProps {
  readonly heading?: string;
  readonly allowTomorrow?: boolean;
  readonly service: TodoService;
  /** A verified authenticated-session lifetime, not a row ownership argument. */
  readonly workspaceSessionKey: string;
  readonly profile: Profile;
  readonly projects: readonly ProjectSummary[];
  readonly classes?: readonly ClassSummary[];
  /** Change after an external write, such as the shell's global Add action. */
  readonly refreshKey?: string | number;
}

interface EditIntent {
  readonly controller: TodayListController;
  readonly todo: Todo;
  readonly mode: "edit" | "reschedule";
}

/** Reusable Today slice; calendar loading and credentials never enter this component. */
export function TodayPanel(props: TodayPanelProps) {
  return <TodayPanelSession key={props.workspaceSessionKey} {...props} />;
}

function TodayPanelSession({ service, workspaceSessionKey, profile, projects, classes = [], refreshKey, heading, allowTomorrow = false }: TodayPanelProps) {
  const today = useLocalToday(profile.timezone);
  const [day, setDay] = useState<"Today" | "Tomorrow">("Today");
  const selectedDay = allowTomorrow ? day : "Today";
  const localDate = selectedDay === "Tomorrow" ? addSqlDateDays(today, 1) : today;
  const todayRef = useRef(today);
  useLayoutEffect(() => { todayRef.current = today; }, [today]);
  // The Today RPC intentionally rejects future dates. Tomorrow uses the
  // existing authenticated workspace read, without changing Today ranks.
  const dayService = useMemo<TodoService>(() => ({
    ...service,
    async loadToday(date, options) {
      if (date === todayRef.current) return service.loadToday(date, options);
      const snapshot = await service.loadWorkspace(options);
      return snapshot.todos.flatMap(todo => !todo.completed && todo.dueDate === date ? [{
        ...todo, completed: false as const, completedAt: null, dueDate: date,
        isOverdue: false, isManuallyOrdered: todo.todayRank !== null,
        projectTitle: snapshot.projects.find(project => project.id === todo.projectId)?.title ?? null,
      }] : []);
    },
  }), [service]);
  const { state, controller } = useTodayListController(dayService, localDate, workspaceSessionKey);
  const focusRef = useRef<HTMLDivElement>(null);
  const activeController = useRef<TodayListController | null>(controller);
  const [composerScope, setComposerScope] = useState<TodayListController | null>(null);
  const [editIntent, setEditIntent] = useState<EditIntent | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const appliedRefresh = useRef({ controller, refreshKey, refreshRevision });

  useLayoutEffect(() => {
    activeController.current = controller;
    return () => { activeController.current = null; };
  }, [controller]);

  useEffect(() => {
    const previous = appliedRefresh.current;
    if (previous.controller !== controller) {
      // The hook already loads a newly authenticated scope.
      appliedRefresh.current = { controller, refreshKey, refreshRevision };
      return;
    }
    if (previous.refreshKey === refreshKey && previous.refreshRevision === refreshRevision) return;
    // Refresh only after the current write settles. In particular, never abort
    // a successful delete before its exact Undo token has reached this client.
    if (state.pendingMutation !== null) return;
    appliedRefresh.current = { controller, refreshKey, refreshRevision };
    void controller.load();
  }, [controller, refreshKey, refreshRevision, state.pendingMutation]);

  const visibleEdit = editIntent?.controller === controller ? editIntent : null;
  const projectTitles = new Map(projects.map((project) => [project.id, project.title]));
  const visibleTodos = selectedDay === "Tomorrow"
    ? state.model.todos.filter(todo => todo.dueDate === localDate)
    : state.model.todos;
  const displayState = {
    ...state,
    loadError: state.loadError?.replace(/\bToday\b/g, selectedDay) ?? null,
    mutationError: state.mutationError?.replace(/\bToday\b/g, selectedDay) ?? null,
    announcement: { ...state.announcement, message: state.announcement.message
      .replace(/ Today refreshed\.$/, ` ${selectedDay} refreshed.`)
      .replace(/ (out of|no longer in) Today\.$/, ` $1 ${selectedDay}.`) },
    model: {
      ...state.model,
      todos: visibleTodos.map((todo) => ({
        ...todo,
        className: todo.classId ? classes.find(course => course.id === todo.classId)?.name ?? todo.className : null,
        projectTitle: todo.projectId === null ? null : projectTitles.get(todo.projectId) ?? todo.projectTitle,
      })),
    },
  };

  return (
    <div className="today-panel" ref={focusRef} tabIndex={-1} aria-label={`${selectedDay} tasks`}>
      <TodayList
        heading={heading}
        day={selectedDay}
        onDayChange={allowTomorrow ? setDay : undefined}
        state={displayState}
        onRetry={() => { void controller.load(); }}
        onAddTodo={() => setComposerScope(controller)}
        onCompleteTodo={(id) => { void controller.completeTodo(id); }}
        onEditTodo={(todo) => setEditIntent({ controller, todo, mode: "edit" })}
        onDeleteTodo={(todo) => { void controller.deleteTodo(todo.id); }}
        onUndoDelete={() => { void controller.undoDelete(); }}
        onDismissUndo={controller.dismissUndo}
        onMoveTodo={(id, direction) => { void controller.moveTodo(id, direction); }}
        onPlaceTodo={(id, targetId, placement) => { void controller.placeTodo(id, targetId, placement); }}
      />
      <TodoComposerDialog
        open={composerScope === controller}
        initialDueDate={localDate}
        projects={projects} classes={classes}
        onClose={() => setComposerScope(null)}
        onCreate={async (input, options) => {
          const saved = await service.createTodo(input, options);
          if (options.signal.aborted || activeController.current !== controller) return;
          if (!controller.acceptCreatedTodo(saved)) {
            // The write succeeded. Close the form and reload; never turn a
            // reconciliation failure into an invitation to create a duplicate.
            setRefreshRevision((revision) => revision + 1);
          }
        }}
      />
      <TodoEditDialog
        todo={visibleEdit?.todo ?? null}
        mode={visibleEdit?.mode ?? "edit"}
        projects={projects} classes={classes}
        fallbackFocusRef={focusRef}
        onClose={() => setEditIntent(null)}
        onSave={async (id, input, options) => {
          if (!await controller.updateDetails(id, input, options)) {
            throw new Error("The todo update was not confirmed.");
          }
        }}
      />
    </div>
  );
}
