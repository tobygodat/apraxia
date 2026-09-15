import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { ServiceError } from "../../lib/serviceError";
export interface Course {
  id: string;
  name: string | null;
  updatedAt: string;
}
export interface LegacyCourse {
  id: string;
  name: string;
}
export interface ClassService {
  list(userId: string, signal: AbortSignal): Promise<Course[]>;
  importLegacy(courses: LegacyCourse[], signal: AbortSignal): Promise<void>;
  create(userId: string, course: LegacyCourse, signal: AbortSignal): Promise<Course>;
  rename(userId: string, course: Course, name: string, signal: AbortSignal): Promise<Course>;
}
const columns = "user_id,id,name,updated_at";
const bounded = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
function fromRow(
  row: Pick<
    Database["public"]["Tables"]["classes"]["Row"],
    "user_id" | "id" | "name" | "updated_at"
  >,
  owner: string,
): Course {
  if (row.user_id !== owner) throw new ServiceError("not_found", "Couldn’t load this class.");
  return { id: row.id, name: row.name, updatedAt: row.updated_at };
}
function validName(name: string) {
  const value = name.trim();
  if (!value || [...value].length > 120)
    throw new ServiceError("invalid_input", "Use a class name of 1–120 characters.");
  return value;
}
/** Read only the current account's legacy payload. Never overwrite or erase it. */
export function readLegacyClasses(userId: string): LegacyCourse[] {
  const raw: unknown = JSON.parse(localStorage.getItem(`orbitos:classes:v1:${userId}`) ?? "[]");
  if (!Array.isArray(raw) || raw.length > 1000)
    throw new ServiceError("invalid_input", "Invalid saved classes");
  const ids = new Set<string>();
  return raw.map((item) => {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      item.id !== item.id.trim() ||
      [...item.id].length > 120 ||
      ids.has(item.id)
    )
      throw new ServiceError("invalid_input", "Invalid saved class");
    ids.add(item.id);
    const name = typeof item.code === "string" ? item.code : item.name;
    if (typeof name !== "string") throw new ServiceError("invalid_input", "Invalid class name");
    return { id: item.id, name: validName(name) };
  });
}
export function createClassService(client: SupabaseClient<Database>): ClassService {
  return {
    async list(userId, signal) {
      const result: Course[] = [];
      let after: string | undefined;
      for (;;) {
        let query = client
          .from("classes")
          .select(columns)
          .eq("user_id", userId)
          .order("id")
          .limit(200);
        if (after) query = query.gt("id", after);
        const { data, error } = await query.abortSignal(bounded(signal));
        if (error || !data)
          throw new ServiceError("unavailable", "Couldn’t load classes. Try again.");
        result.push(...data.map((row) => fromRow(row, userId)));
        if (data.length < 200)
          return result.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
        after = data[data.length - 1]!.id;
      }
    },
    async importLegacy(courses, signal) {
      if (!courses.length) return;
      const { error } = await client
        .rpc("import_classes", {
          p_classes: courses.map((c) => ({ id: c.id, name: validName(c.name) })),
        })
        .abortSignal(bounded(signal));
      if (error)
        throw new ServiceError(
          "unavailable",
          "Browser classes couldn’t be copied to your account. The original data is still here. Try again.",
        );
    },
    async create(userId, course, signal) {
      const { error } = await client
        .from("classes")
        .upsert(
          { user_id: userId, id: course.id, name: validName(course.name) },
          { onConflict: "user_id,id", ignoreDuplicates: true },
        )
        .abortSignal(bounded(signal));
      if (error)
        throw new ServiceError(
          "unavailable",
          "Couldn’t save this class. Your name is still here; try again.",
        );
      const { data, error: readError } = await client
        .from("classes")
        .select(columns)
        .eq("user_id", userId)
        .eq("id", course.id)
        .abortSignal(bounded(signal))
        .single();
      if (readError || !data)
        throw new ServiceError("unavailable", "Couldn’t confirm the save. Try again.");
      return fromRow(data, userId);
    },
    async rename(userId, course, name, signal) {
      const value = validName(name);
      const { data, error } = await client
        .from("classes")
        .update({ name: value })
        .eq("user_id", userId)
        .eq("id", course.id)
        .eq("updated_at", course.updatedAt)
        .select(columns)
        .abortSignal(bounded(signal))
        .maybeSingle();
      if (error) throw new ServiceError("unavailable", "Couldn’t save the class name. Try again.");
      if (data) return fromRow(data, userId);
      // A lost response may mean our earlier save succeeded. Confirm before
      // calling it a conflict, while never overwriting a newer remote name.
      const current = await client
        .from("classes")
        .select(columns)
        .eq("user_id", userId)
        .eq("id", course.id)
        .abortSignal(bounded(signal))
        .single();
      if (current.data?.name === value) return fromRow(current.data, userId);
      throw new ServiceError(
        "conflict",
        "This class changed elsewhere. Close this form and reload classes before editing again.",
      );
    },
  };
}
