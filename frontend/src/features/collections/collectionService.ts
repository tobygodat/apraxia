import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../../types/database";
import type {
  DeleteUndoToken,
  Idea,
  MediaItem,
  MediaStatus,
  MediaType,
  NewIdeaInput,
  NewMediaInput,
  NewProjectInput,
  Project,
  ProjectStatus,
  SearchResult,
  Todo,
} from "../../types/domain";
import { isDeleteUndoToken } from "../todos/todoWorkspaceValidation";
import { ServiceError } from "../../lib/serviceError";
export type CollectionKind = "project" | "idea" | "media";
export type CollectionRecord = Project | Idea | MediaItem;
export interface ListOptions {
  offset?: number;
  limit?: number;
  status?: string;
  mediaType?: string;
  projectId?: string;
  signal?: AbortSignal;
}
export interface CollectionService {
  listProjects(options?: ListOptions): Promise<Project[]>;
  listIdeas(options?: ListOptions): Promise<Idea[]>;
  listMedia(options?: ListOptions): Promise<MediaItem[]>;
  getProject(id: string): Promise<Project>;
  getIdea(id: string): Promise<Idea>;
  getMedia(id: string): Promise<MediaItem>;
  getTodo(id: string): Promise<Todo>;
  saveProject(input: NewProjectInput, id?: string): Promise<Project>;
  saveIdea(input: NewIdeaInput, id?: string): Promise<Idea>;
  saveMedia(input: NewMediaInput, id?: string): Promise<MediaItem>;
  softDelete(kind: CollectionKind, id: string): Promise<DeleteUndoToken>;
  restore(kind: CollectionKind, id: string, token: DeleteUndoToken): Promise<boolean>;
  search(query: string, offset?: number, signal?: AbortSignal): Promise<SearchResult[]>;
  projectTodos(projectId: string, offset?: number): Promise<Todo[]>;
}
const project = (r: Tables<"projects">): Project => ({
  id: r.id,
  title: r.title,
  description: r.description,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const idea = (r: Tables<"ideas">): Idea => ({
  id: r.id,
  title: r.title,
  body: r.body,
  projectId: r.project_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const media = (r: Tables<"media">): MediaItem => ({
  id: r.id,
  title: r.title,
  mediaType: r.media_type,
  creator: r.creator,
  releaseYear: r.release_year,
  status: r.status,
  rating: r.rating,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const todo = (r: Tables<"todos">): Todo => ({
  id: r.id,
  text: r.text,
  completed: r.completed,
  completedAt: r.completed_at,
  dueDate: r.due_date,
  dueTime: r.due_time,
  projectId: r.project_id,
  todayRank: r.today_rank,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
function data<T>(response: { data: T | null; error: unknown }): T {
  if (response.error || response.data === null)
    throw new ServiceError("unavailable", "Couldn’t load or save this record. Try again.");
  return response.data;
}
const signal = (s?: AbortSignal) =>
  s ? AbortSignal.any([s, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
export function ideaTitle(record: Pick<Idea, "title" | "body">): string {
  return (
    record.title?.trim() ||
    record.body
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ||
    "Untitled idea"
  );
}
export function createCollectionService(client: SupabaseClient<Database>): CollectionService {
  return {
    async listProjects(o = {}) {
      let q = client
        .from("projects")
        .select("*")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .order("id");
      if (o.status && o.status !== "all") q = q.eq("status", o.status as ProjectStatus);
      return data(
        await q
          .range(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 50) - 1)
          .abortSignal(signal(o.signal)),
      ).map(project);
    },
    async listIdeas(o = {}) {
      let q = client
        .from("ideas")
        .select("*")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .order("id");
      if (o.projectId) q = q.eq("project_id", o.projectId);
      return data(
        await q
          .range(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 50) - 1)
          .abortSignal(signal(o.signal)),
      ).map(idea);
    },
    async listMedia(o = {}) {
      let q = client
        .from("media")
        .select("*")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .order("id");
      if (o.status && o.status !== "all") q = q.eq("status", o.status as MediaStatus);
      if (o.mediaType && o.mediaType !== "all") q = q.eq("media_type", o.mediaType as MediaType);
      return data(
        await q
          .range(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 50) - 1)
          .abortSignal(signal(o.signal)),
      ).map(media);
    },
    async getProject(id) {
      return project(
        data(
          await client
            .from("projects")
            .select("*")
            .eq("id", id)
            .is("deleted_at", null)
            .abortSignal(signal())
            .single(),
        ),
      );
    },
    async getIdea(id) {
      return idea(
        data(
          await client
            .from("ideas")
            .select("*")
            .eq("id", id)
            .is("deleted_at", null)
            .abortSignal(signal())
            .single(),
        ),
      );
    },
    async getMedia(id) {
      return media(
        data(
          await client
            .from("media")
            .select("*")
            .eq("id", id)
            .is("deleted_at", null)
            .abortSignal(signal())
            .single(),
        ),
      );
    },
    async getTodo(id) {
      return todo(
        data(
          await client
            .from("todos")
            .select("*")
            .eq("id", id)
            .is("deleted_at", null)
            .abortSignal(signal())
            .single(),
        ),
      );
    },
    async saveProject(input, id) {
      if (!input.title.trim()) throw new ServiceError("invalid_input", "Add a project title.");
      const values = {
        title: input.title.trim(),
        description: input.description?.trim() || null,
        status: input.status ?? ("active" as const),
      };
      const q = id
        ? client.from("projects").update(values).eq("id", id).is("deleted_at", null)
        : client.from("projects").insert(values);
      return project(data(await q.select("*").abortSignal(signal()).single()));
    },
    async saveIdea(input, id) {
      if (!input.body.trim())
        throw new ServiceError("invalid_input", "Add some text to your idea.");
      const values = {
        title: input.title?.trim() || null,
        body: input.body.trim(),
        project_id: input.projectId ?? null,
      };
      const q = id
        ? client.from("ideas").update(values).eq("id", id).is("deleted_at", null)
        : client.from("ideas").insert(values);
      return idea(data(await q.select("*").abortSignal(signal()).single()));
    },
    async saveMedia(input, id) {
      if (!input.title.trim()) throw new ServiceError("invalid_input", "Add a title.");
      const values = {
        title: input.title.trim(),
        media_type: input.mediaType,
        creator: input.creator?.trim() || null,
        release_year: input.releaseYear ?? null,
        status: input.status ?? ("saved" as const),
        rating: input.rating ?? null,
        notes: input.notes?.trim() || null,
      };
      const q = id
        ? client.from("media").update(values).eq("id", id).is("deleted_at", null)
        : client.from("media").insert(values);
      return media(data(await q.select("*").abortSignal(signal()).single()));
    },
    async softDelete(kind, id) {
      const token = data(
        await client
          .rpc("soft_delete_record", { p_record_type: kind, p_record_id: id })
          .abortSignal(signal()),
      );
      if (!isDeleteUndoToken(token))
        throw new ServiceError("unavailable", "Couldn’t delete this record. Try again.");
      return token;
    },
    async restore(kind, id, token) {
      return data(
        await client
          .rpc("restore_record", { p_record_type: kind, p_record_id: id, p_deleted_at: token })
          .abortSignal(signal()),
      );
    },
    async search(query, offset = 0, s) {
      return data(
        await client
          .rpc("search_records", { p_query: query, p_offset: offset, p_limit: 40 })
          .abortSignal(signal(s)),
      ).map((r) => ({
        recordType: r.record_type,
        recordId: r.record_id,
        title: r.title,
        snippet: r.snippet,
        updatedAt: r.updated_at,
        relevance: r.relevance,
        totalCount: r.total_count,
      }));
    },
    async projectTodos(projectId, offset = 0) {
      return data(
        await client
          .from("todos")
          .select("*")
          .eq("project_id", projectId)
          .is("deleted_at", null)
          .order("completed")
          .order("created_at")
          .order("id")
          .range(offset, offset + 49)
          .abortSignal(signal()),
      ).map(todo);
    },
  };
}
