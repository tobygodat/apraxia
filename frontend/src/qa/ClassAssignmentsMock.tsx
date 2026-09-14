import { useMemo } from "react";
import { ClassAssignments } from "../features/classes/ClassAssignments";
import { createTodoAssignmentService, type AssignmentService } from "../features/classes/assignmentService";
import { addSqlDateDays, localToday } from "../features/todos/dateDomain";

import type { TodoService } from "../features/todos/todoService";
import type { Todo, DeleteUndoToken } from "../types/domain";

export function fixtureAssignmentTodos(empty = false): Todo[] {
  const today = localToday("America/New_York");
  const now = new Date().toISOString();
  return empty ? [] : [
    ["Problem set 3", "Homework", -2, false], ["Problem set 4", "Homework", 1, false],
    ["Counting principles", "Quiz", 5, false], ["Midterm review problems", "Other", 10, false],
    ["Read chapter 5", "Reading", null, false], ["Problem set 2", "Homework", -9, true],
  ].map(([text, assignmentType, offset, completed], index) => ({
    id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
    text: text as string, assignmentType: assignmentType as string,
    dueDate: offset === null ? null : addSqlDateDays(today, offset as number), dueTime: null,
    completed: completed as boolean, completedAt: completed ? now : null,
    classId: "math3012", className: "MATH3012", projectId: null, todayRank: null,
    createdAt: now, updatedAt: now,
  }));
}
export function createFixtureAssignments(empty = false): AssignmentService {
  let rows = fixtureAssignmentTodos(empty);
  const deleted = new Map<string, Todo>();
  const token = "2026-09-14T12:00:00.123456Z" as DeleteUndoToken;
  const now = new Date().toISOString();
  function find(id: string) { const row = rows.find(row => row.id === id); if (!row) throw new Error("Assignment not found."); return row; }
  const todos: TodoService = {
    async loadWorkspace() { return { profile: { userId: "qa", timezone: "America/New_York", createdAt: now, updatedAt: now }, projects: [], todos: rows.map(row => ({ ...row })) }; },
    async createTodo(input) {
      const existing = rows.find(row => row.id === input.id); if (existing) return { ...existing };
      const row: Todo = { id: input.id!, text: input.text, classId: input.classId, assignmentType: input.assignmentType, dueDate: input.dueDate ?? null, dueTime: input.dueTime ?? null, completed: false, completedAt: null, projectId: null, todayRank: null, createdAt: now, updatedAt: now };
      rows.push(row); return { ...row };
    },
    async updateTodoDetails(id, patch) { const row = find(id); Object.assign(row, patch); return { ...row }; },
    async setTodoCompleted(id, completed) { const row = find(id); Object.assign(row, { completed, completedAt: completed ? now : null }); return { ...row }; },
    async softDeleteTodo(id) { deleted.set(id, find(id)); rows = rows.filter(row => row.id !== id); return token; },
    async restoreTodo(id, supplied) { const row = deleted.get(id); if (!row || supplied !== token) return false; rows.push(row); deleted.delete(id); return true; },
    async loadToday() { return []; }, async reorderToday() { return []; },
  };
  const adapter = createTodoAssignmentService(todos);
  // Standalone component tests use several fictional account IDs.
  return { ...adapter, list: (_userId, courseId, signal) => adapter.list("qa", courseId, signal), remove: (_userId, courseId, id, signal) => adapter.remove("qa", courseId, id, signal) };
}
/** Fictional service, shared production UI. Data resets on fixture reload. */
export function ClassAssignmentsMock({ empty = false }: { empty?: boolean }) {
  const service = useMemo(() => createFixtureAssignments(empty), [empty]);
  return <ClassAssignments userId="qa" courseId="math3012" service={service} timezone="America/New_York" />;
}
