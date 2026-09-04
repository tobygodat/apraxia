import {
  CloudAppShell,
  type CloudAppShellProps,
} from "../app-shell/CloudAppShell";
import { useGlobalAddTodo } from "./GlobalAddTodoController";

export type GlobalAddTodoShellProps = Omit<
  CloudAppShellProps,
  "onOpenGlobalAdd"
>;

/** Connects the authenticated shell's global + Add control to the Todo slice. */
export function GlobalAddTodoShell(props: GlobalAddTodoShellProps) {
  const { openTodoComposer } = useGlobalAddTodo();

  return (
    <CloudAppShell
      {...props}
      onOpenGlobalAdd={() => openTodoComposer()}
    />
  );
}

export default GlobalAddTodoShell;
