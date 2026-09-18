import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { ServiceError } from "../../lib/serviceError";
import { summarizeClasses, type ClassOverview, type OverviewAssignment } from "./classOverview";
import { isNoteSaved } from "./noteService";

export interface ClassOverviewService {
  /** Every class's totals in two reads, so the Classes list stays one request pair. */
  list(userId: string, signal: AbortSignal): Promise<Record<string, ClassOverview>>;
}

const PAGE = 200;
const bounded = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
const UNAVAILABLE = "Couldn’t load class totals. Try again.";

/** Keyset pages, matching the other class reads, so a long history still loads. */
async function collect<Row extends { id: string; user_id: string }>(
  read: (after: string | undefined) => PromiseLike<{ data: Row[] | null; error: unknown }>,
  owner: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  let after: string | undefined;
  for (;;) {
    const { data, error } = await read(after);
    if (error || !data) throw new ServiceError("unavailable", UNAVAILABLE);
    for (const row of data) {
      if (row.user_id !== owner) throw new ServiceError("not_found", UNAVAILABLE);
      rows.push(row);
    }
    if (data.length < PAGE) return rows;
    after = data[data.length - 1]!.id;
  }
}

export function createClassOverviewService(client: SupabaseClient<Database>): ClassOverviewService {
  return {
    async list(userId, signal) {
      const [assignments, notes] = await Promise.all([
        collect((after) => {
          let query = client
            .from("todos")
            .select("id,user_id,text,due_date,class_id,completed")
            .eq("user_id", userId)
            .not("class_id", "is", null)
            .is("deleted_at", null)
            .order("id")
            .limit(PAGE);
          if (after) query = query.gt("id", after);
          return query.abortSignal(bounded(signal));
        }, userId),
        collect((after) => {
          let query = client
            .from("class_notes")
            .select("id,user_id,course_id,source,uploaded_at")
            .eq("user_id", userId)
            .order("id")
            .limit(PAGE);
          if (after) query = query.gt("id", after);
          return query.abortSignal(bounded(signal));
        }, userId),
      ]);
      const noteCounts: Record<string, number> = {};
      // An upload still waiting on its PDF is not a saved note yet.
      for (const note of notes.filter(isNoteSaved))
        noteCounts[note.course_id] = (noteCounts[note.course_id] ?? 0) + 1;
      const rows: OverviewAssignment[] = assignments.map((row) => ({
        id: row.id,
        classId: row.class_id!,
        title: row.text,
        due: row.due_date,
        done: row.completed,
      }));
      return summarizeClasses(rows, noteCounts);
    },
  };
}
