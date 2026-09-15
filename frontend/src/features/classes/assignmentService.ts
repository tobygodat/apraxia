import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { isSqlDate } from "../todos/dateDomain";
import { ServiceError } from "../../lib/serviceError";

export interface Assignment {
  id: string;
  title: string;
  type: string;
  due: string;
  done: boolean;
}
export type AssignmentPatch = Partial<Omit<Assignment, "id">>;
export interface AssignmentService {
  list(userId: string, courseId: string, signal: AbortSignal): Promise<Assignment[]>;
  create(
    userId: string,
    courseId: string,
    item: Assignment,
    signal: AbortSignal,
  ): Promise<Assignment>;
  update(
    userId: string,
    courseId: string,
    id: string,
    patch: AssignmentPatch,
    signal: AbortSignal,
  ): Promise<Assignment>;
}
const columns = "id,user_id,course_id,title,assignment_type,due_date,completed";
type Row = Database["public"]["Tables"]["class_assignments"]["Row"];
function fromRow(row: Row, userId: string, courseId: string): Assignment {
  if (row.user_id !== userId || row.course_id !== courseId)
    throw new ServiceError("not_found", "Couldn’t load this assignment.");
  return {
    id: row.id,
    title: row.title,
    type: row.assignment_type,
    due: row.due_date ?? "",
    done: row.completed,
  };
}
function values(patch: AssignmentPatch) {
  if (patch.title !== undefined && (!patch.title.trim() || patch.title.trim().length > 180))
    throw new ServiceError("invalid_input", "Use an assignment name of 1–180 characters.");
  if (patch.due !== undefined && patch.due !== "" && !isSqlDate(patch.due))
    throw new ServiceError("invalid_input", "Choose a valid date.");
  if (
    patch.type !== undefined &&
    !["", "Homework", "Quiz", "Reading", "Exam", "Other"].includes(patch.type)
  )
    throw new ServiceError("invalid_input", "Choose an assignment type from the list.");
  return {
    ...(patch.title !== undefined && { title: patch.title.trim() }),
    ...(patch.due !== undefined && { due_date: patch.due || null }),
    ...(patch.type !== undefined && { assignment_type: patch.type }),
    ...(patch.done !== undefined && { completed: patch.done }),
  };
}
const requestSignal = (signal: AbortSignal) =>
  AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
export function createAssignmentService(client: SupabaseClient<Database>): AssignmentService {
  return {
    async list(userId, courseId, signal) {
      const items: Assignment[] = [];
      let after: string | undefined;
      for (;;) {
        let query = client
          .from("class_assignments")
          .select(columns)
          .eq("user_id", userId)
          .eq("course_id", courseId)
          .order("id")
          .limit(200);
        if (after) query = query.gt("id", after);
        const { data, error } = await query.abortSignal(requestSignal(signal));
        if (error || !data)
          throw new ServiceError("unavailable", "Couldn’t load assignments. Try again.");
        items.push(...data.map((row) => fromRow(row, userId, courseId)));
        if (data.length < 200) return items;
        after = data[data.length - 1]!.id;
      }
    },
    async create(userId, courseId, item, signal) {
      // Keep the draft UUID on retries: an interrupted response must not create duplicates.
      const { error } = await client
        .from("class_assignments")
        .upsert(
          {
            ...values(item),
            title: item.title.trim(),
            id: item.id,
            user_id: userId,
            course_id: courseId,
          },
          { onConflict: "id", ignoreDuplicates: true },
        )
        .abortSignal(requestSignal(signal));
      if (error)
        throw new ServiceError(
          "unavailable",
          "Couldn’t save assignment. Your draft is still here; try again.",
        );
      const { data, error: readError } = await client
        .from("class_assignments")
        .select(columns)
        .eq("id", item.id)
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .abortSignal(requestSignal(signal))
        .single();
      if (readError || !data)
        throw new ServiceError(
          "unavailable",
          "Couldn’t confirm the save. Try again to check this assignment.",
        );
      return fromRow(data, userId, courseId);
    },
    async update(userId, courseId, id, patch, signal) {
      const { data, error } = await client
        .from("class_assignments")
        .update(values(patch))
        .eq("id", id)
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .select(columns)
        .abortSignal(requestSignal(signal))
        .single();
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t save the change. Try again.");
      return fromRow(data, userId, courseId);
    },
  };
}
