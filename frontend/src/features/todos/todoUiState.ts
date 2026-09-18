/** The single home for task error copy shown by the board and the Today panel. */

export type TodoLoadStatus = "idle" | "loading" | "ready" | "error";

export type TodoMutationErrorKind =
  | "completion_failed"
  | "delete_failed"
  | "update_failed"
  | "reorder_failed"
  | "reorder_too_large"
  | "cancelled";

export function todoLoadErrorCopy(scope: "Tasks" | "Today" | "Tomorrow"): string {
  return `${scope} could not be loaded. Try again.`;
}

export function todoMutationErrorCopy(kind: TodoMutationErrorKind): string {
  switch (kind) {
    case "completion_failed":
      return "The completion change was not saved. The prior state remains.";
    case "delete_failed":
      return "The task could not be deleted. Try again.";
    case "update_failed":
      return "The task changes were not saved. Your entered details can be retried.";
    // The write may have committed before the response was lost, so this copy
    // must not claim the previous order is what Today now holds.
    case "reorder_failed":
      return "We couldn't confirm that order. Reload to see what was saved.";
    case "reorder_too_large":
      return "Today has too many tasks to reorder at once.";
    case "cancelled":
      return "The change was cancelled. Refresh to confirm its saved state.";
  }
}

export const TODO_UNDO_COPY = {
  unavailable: "Undo is no longer available for this task.",
  interrupted: "The restore was interrupted. Try Undo again.",
  failed: "The task could not be restored. Try Undo again.",
} as const;
