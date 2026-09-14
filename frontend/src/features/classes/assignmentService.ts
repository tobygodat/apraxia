import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import type { DeleteUndoToken, Todo } from "../../types/domain";
import { isSqlDate } from "../todos/dateDomain";
import { createSupabaseTodoService } from "../todos/supabaseTodoService";
import type { TodoService, UpdateTodoDetailsInput } from "../todos/todoService";
import { canonicalLocalTime } from "../todos/todoWorkspaceValidation";

export interface Assignment { id: string; title: string; type: string; due: string; dueTime?: string; done: boolean }
export type AssignmentPatch = Partial<Omit<Assignment, "id">>;
export interface AssignmentService {
  list(userId: string, courseId: string, signal: AbortSignal): Promise<Assignment[]>;
  create(userId: string, courseId: string, item: Assignment, signal: AbortSignal): Promise<Assignment>;
  update(userId: string, courseId: string, id: string, patch: AssignmentPatch, signal: AbortSignal): Promise<Assignment>;
  remove(userId: string, courseId: string, id: string, signal: AbortSignal): Promise<DeleteUndoToken>;
  restore(userId: string, courseId: string, id: string, token: DeleteUndoToken, signal: AbortSignal): Promise<boolean>;
}
function fromTodo(todo: Todo, courseId: string): Assignment {
  if (todo.classId !== courseId) throw new Error("Couldn’t load this assignment.");
  return { id: todo.id, title: todo.text, type: todo.assignmentType ?? "", due: todo.dueDate ?? "", dueTime: todo.dueTime ?? "", done: todo.completed };
}
function validate(patch: AssignmentPatch) {
  if (patch.title !== undefined && (!patch.title.trim() || patch.title.trim().length > 180)) throw new Error("Use an assignment name of 1–180 characters.");
  if (patch.due !== undefined && patch.due !== "" && !isSqlDate(patch.due)) throw new Error("Choose a valid date.");
  if (patch.dueTime && canonicalLocalTime(patch.dueTime) === null) throw new Error("Choose a valid time.");
  if (patch.dueTime && !patch.due) throw new Error("Choose a date for the time.");
  if (patch.type !== undefined && !["", "Homework", "Quiz", "Reading", "Exam", "Other"].includes(patch.type)) throw new Error("Choose an assignment type from the list.");
}
/** Classes retains its inline model; all storage and lifecycle operations use todos. */
export function createTodoAssignmentService(todos: TodoService): AssignmentService {
  async function list(userId: string, courseId: string, signal: AbortSignal) {
    const snapshot = await todos.loadWorkspace({ signal, classId: courseId });
    if (snapshot.profile.userId !== userId) throw new Error("Couldn’t load this assignment.");
    return snapshot.todos.filter(todo => todo.classId === courseId).map(todo => fromTodo(todo, courseId));
  }
  return {
    list,
    async create(_userId, courseId, item, signal) {
      validate(item);
      let saved = await todos.createTodo({ id: item.id, text: item.title.trim(), classId: courseId,
        assignmentType: item.type, ...(item.due ? { dueDate: item.due, dueTime: item.dueTime || null } : { dueDate: null, dueTime: null }),
      }, { signal, classId: courseId });
      if (item.done && !saved.completed) saved = await todos.setTodoCompleted(saved.id, true, { signal, classId: courseId });
      return fromTodo(saved, courseId);
    },
    async update(_userId, courseId, id, patch, signal) {
      validate(patch);
      const options = { signal, classId: courseId };
      // Completion is its own atomic operation; never replay a stale editor row.
      if (patch.done !== undefined) {
        if (Object.keys(patch).length !== 1) throw new Error("Save assignment details before changing completion.");
        return fromTodo(await todos.setTodoCompleted(id, patch.done, options), courseId);
      }
      const details = {
        ...(patch.title !== undefined && { text: patch.title.trim() }),
        ...(patch.type !== undefined && { assignmentType: patch.type }),
        ...(patch.due !== undefined && { dueDate: patch.due || null }),
        ...(patch.dueTime !== undefined && { dueTime: patch.dueTime || null }),
        ...(patch.due === "" && { dueTime: null }),
      } as UpdateTodoDetailsInput;
      return fromTodo(await todos.updateTodoDetails(id, details, options), courseId);
    },
    async remove(userId, courseId, id, signal) {
      if (!(await list(userId, courseId, signal)).some(item => item.id === id)) throw new Error("Assignment not found.");
      return todos.softDeleteTodo(id, { signal, classId: courseId });
    },
    async restore(_userId, courseId, id, token, signal) {
      return todos.restoreTodo(id, token, { signal, classId: courseId });
    },
  };
}
export function createAssignmentService(client: SupabaseClient<Database>): AssignmentService {
  return createTodoAssignmentService(createSupabaseTodoService(client));
}
