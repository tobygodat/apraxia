import type { Todo } from "../../types/domain";
import { WorkspaceIcon } from "../../components/WorkspaceIcon";
import { describeRecurrence, formatRecurrence } from "./todoRecurrence";
import "./TodoRepeatMark.css";

/** How a task says it repeats everywhere outside the editor. */
export function TodoRepeatMark({ recurrence }: { recurrence: Todo["recurrence"] }) {
  if (!recurrence) return null;
  const description = describeRecurrence(recurrence);
  return (
    <span className="todo-repeat-mark" title={description}>
      <WorkspaceIcon name="repeat" className="todo-repeat-mark__icon" />
      <span className="todo-repeat-mark__assistive">{description}</span>
      <span aria-hidden="true">{formatRecurrence(recurrence)}</span>
    </span>
  );
}
