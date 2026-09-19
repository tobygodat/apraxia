import { useEffect, useRef, useState } from "react";

import type { ClassSummary, Profile, ProjectSummary, Todo } from "../../types/domain";
import { TodayList } from "./TodayList";
import { useTodoController } from "./todoController";
import { TodoFormDialog } from "./TodoFormDialog";
import type { TodoService } from "./todoService";
import { selectTodayList, type TodayListDay } from "./todoViews";
import { useLocalToday } from "./useLocalToday";
import { addSqlDateDays } from "./dateDomain";
import "./TodayPanel.css";

/** What the panel knows about today, for a caller that prints it elsewhere. */
export interface TodaySummary {
  readonly dueToday: number;
  readonly overdue: number;
}

export interface TodayPanelProps {
  readonly heading?: string;
  /** Called whenever the counts change, so the page header can print them. */
  readonly onSummary?: (summary: TodaySummary) => void;
  readonly allowTomorrow?: boolean;
  readonly service: TodoService;
  /** A verified authenticated-session lifetime, not a row ownership argument. */
  readonly workspaceSessionKey: string;
  readonly profile: Profile;
  readonly projects: readonly ProjectSummary[];
  readonly classes?: readonly ClassSummary[];
}

/** Reusable Today slice; calendar loading and credentials never enter this component. */
export function TodayPanel(props: TodayPanelProps) {
  return <TodayPanelSession key={props.workspaceSessionKey} {...props} />;
}

function TodayPanelSession({
  service,
  workspaceSessionKey,
  profile,
  projects,
  classes = [],
  heading,
  allowTomorrow = false,
  onSummary,
}: TodayPanelProps) {
  const today = useLocalToday(profile.timezone);
  const [day, setDay] = useState<TodayListDay>("Today");
  const selectedDay = allowTomorrow ? day : "Today";
  const localDate = selectedDay === "Tomorrow" ? addSqlDateDays(today, 1) : today;
  // Tomorrow reads the workspace slice; the ranked Today slice always follows today.
  const { state, controller } = useTodoController(service, workspaceSessionKey, {
    localDate: today,
    workspace: selectedDay === "Tomorrow",
  });
  const focusRef = useRef<HTMLDivElement>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  // Drafts belong to the controller that opened them; a replaced service drops them.
  const [editIntent, setEditIntent] = useState<{
    readonly scope: object;
    readonly todo: Todo;
    readonly mode: "edit" | "reschedule";
  } | null>(null);
  const edit = editIntent?.scope === controller ? editIntent : null;
  const view = selectTodayList(state, selectedDay, today, projects, classes);

  // The Today slice holds what is due today plus what fell past it, so both
  // counts come from the rows already loaded rather than a second read.
  const overdueCount = state.today.todos.filter((todo) => todo.isOverdue).length;
  const dueTodayCount = state.today.todos.length - overdueCount;
  useEffect(() => {
    onSummary?.({ dueToday: dueTodayCount, overdue: overdueCount });
  }, [dueTodayCount, overdueCount, onSummary]);

  return (
    <div className="today-panel" ref={focusRef} tabIndex={-1} aria-label={`${selectedDay} tasks`}>
      <TodayList
        heading={heading}
        day={selectedDay}
        onDayChange={allowTomorrow ? setDay : undefined}
        state={view}
        onRetry={() => {
          void (selectedDay === "Tomorrow" ? controller.loadWorkspace() : controller.loadToday());
        }}
        onAddTodo={() => setComposerOpen(true)}
        onCompleteTodo={(id) => {
          controller.completeTodo(id);
        }}
        onEditTodo={(todo) => setEditIntent({ scope: controller, todo, mode: "edit" })}
        onDeleteTodo={(todo) => {
          controller.deleteTodo(todo.id);
        }}
        onUndoDelete={() => {
          controller.undoDelete();
        }}
        onDismissUndo={controller.dismissUndo}
        onMoveTodo={(id, direction) => {
          void controller.moveTodo(id, direction);
        }}
        onPlaceTodo={(id, targetId, placement) => {
          void controller.placeTodo(id, targetId, placement);
        }}
      />
      <TodoFormDialog
        mode="create"
        open={composerOpen}
        initialDueDate={localDate}
        projects={projects}
        classes={classes}
        onClose={() => setComposerOpen(false)}
        onSubmit={async (submission, options) => {
          if (submission.mode !== "create") return;
          const saved = await service.createTodo(submission.input, options);
          if (options.signal.aborted) return;
          // The write succeeded. Never turn a reconciliation failure into an
          // invitation to create a duplicate: reload instead.
          if (!controller.acceptCreatedTodo(saved)) void controller.refresh();
        }}
      />
      <TodoFormDialog
        mode={edit?.mode ?? "edit"}
        open={edit !== null}
        todo={edit?.todo}
        projects={projects}
        classes={classes}
        fallbackFocusRef={focusRef}
        onClose={() => setEditIntent(null)}
        onSubmit={async (submission, options) => {
          if (submission.mode === "create") return;
          await controller.updateDetails(
            submission.todoId,
            submission.input,
            options,
            submission.mode === "reschedule" ? "reschedule" : "update",
          );
        }}
      />
    </div>
  );
}
