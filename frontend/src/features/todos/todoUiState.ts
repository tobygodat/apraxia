export type TodoLoadState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly kind: "load_failed" };

export type TodoMutationErrorKind =
  | "completion_failed"
  | "delete_failed"
  | "update_failed";

export function todoLoadErrorCopy(kind: "load_failed"): string {
  switch (kind) {
    case "load_failed":
      return "Tasks could not be loaded. Try again.";
  }
}

export function todoMutationErrorCopy(kind: TodoMutationErrorKind): string {
  switch (kind) {
    case "completion_failed":
      return "The completion change was not saved. The prior state remains.";
    case "delete_failed":
      return "The task could not be deleted. Try again.";
    case "update_failed":
      return "The task changes were not saved. Your entered details can be retried.";
  }
}
