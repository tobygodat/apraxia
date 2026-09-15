import type { ProjectSummary, TodayTodo } from "../../types/domain";
import { addSqlDateDays, type SqlDate } from "./dateDomain";
import { buildTodayListModel, type TodayListModel } from "./todayListModel";
import type {
  TodoAnnouncement,
  TodoControllerState,
  TodoPendingMutation,
  TodoUndoNotice,
} from "./todoController";
import { todoLoadErrorCopy, todoMutationErrorCopy, type TodoLoadStatus } from "./todoUiState";

export type TodayListDay = "Today" | "Tomorrow";

/** What the Today list renders: one day's rows plus the shared write status. */
export interface TodayListViewState {
  readonly loadStatus: TodoLoadStatus;
  readonly model: TodayListModel;
  readonly loadError: string | null;
  readonly mutationError: string | null;
  readonly pendingMutation: TodoPendingMutation | null;
  readonly undoNotice: TodoUndoNotice | null;
  readonly announcement: TodoAnnouncement;
}

function withProjectTitles(
  rows: readonly TodayTodo[],
  projects: readonly ProjectSummary[],
): TodayTodo[] {
  const titles = new Map(projects.map((project) => [project.id, project.title]));
  return rows.map((row) => ({
    ...row,
    projectTitle: row.projectId === null ? null : (titles.get(row.projectId) ?? row.projectTitle),
  }));
}

/**
 * Today comes from the ranked RPC slice. Tomorrow is a plain selection over the
 * workspace rows: the Today RPC rejects future dates and Tomorrow has no ranks.
 */
export function selectTodayList(
  state: TodoControllerState,
  day: TodayListDay,
  today: SqlDate,
  projects: readonly ProjectSummary[],
): TodayListViewState {
  // Only trailing view words change; a task title containing "Today" never does.
  const dayCopy = (message: string) =>
    message.replace(/ (out of|no longer in) Today\.$/, ` $1 ${day}.`);
  const model =
    day === "Today"
      ? buildTodayListModel(withProjectTitles(state.today.todos, projects), state.today.localDate)
      : buildTodayListModel(
          withProjectTitles(
            state.todos.flatMap((todo) => {
              const tomorrow = addSqlDateDays(today, 1);
              return !todo.completed && todo.dueDate === tomorrow
                ? [
                    {
                      ...todo,
                      completed: false as const,
                      completedAt: null,
                      dueDate: tomorrow,
                      isOverdue: false,
                      isManuallyOrdered: todo.todayRank !== null,
                      projectTitle: null,
                    },
                  ]
                : [];
            }),
            projects,
          ),
          addSqlDateDays(today, 1),
        );
  const loadStatus = day === "Today" ? state.todayStatus : state.workspaceStatus;
  return {
    loadStatus,
    model,
    loadError: loadStatus === "error" ? todoLoadErrorCopy(day) : null,
    mutationError: state.mutationError ? todoMutationErrorCopy(state.mutationError) : null,
    pendingMutation: state.pending[0] ?? null,
    undoNotice: state.undoNotice,
    announcement: { ...state.announcement, message: dayCopy(state.announcement.message) },
  };
}
