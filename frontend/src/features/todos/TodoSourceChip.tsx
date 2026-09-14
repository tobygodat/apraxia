import type { Todo } from "../../types/domain";
import "./TodoSourceChip.css";

export function TodoSourceChip({ todo, projectTitle }: { todo: Pick<Todo, "classId" | "className" | "assignmentType" | "projectId">; projectTitle?: string | null }) {
  const label = todo.classId
    ? [todo.className ?? todo.classId, todo.assignmentType].filter(Boolean).join(" · ")
    : projectTitle ?? (todo.projectId ? "Project" : null);
  return label ? <span className="todo-source-chip" title={label}>{label}</span> : null;
}
