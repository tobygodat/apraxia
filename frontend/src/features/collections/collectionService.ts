import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../../types/database";
import type { DeleteUndoToken, Idea, MediaItem, MediaStatus, MediaType, NewIdeaInput, NewMediaInput, NewProjectInput, Project, ProjectStatus, SearchResult, Todo } from "../../types/domain";
import { isDeleteUndoToken } from "../todos/todoWorkspaceValidation";
import { draftId, expectedUpdatedAt } from "../../lib/writeIntent";
export type CollectionKind = "project" | "idea" | "media";
export type CollectionRecord = Project | Idea | MediaItem;
export interface ListOptions {
    offset?: number;
    limit?: number;
    status?: string;
    mediaType?: string;
    projectId?: string;
    signal?: AbortSignal;
    cursor?: string | null;
    snapshotToken?: string | null;
}
export interface CollectionPage<T> {
    readonly items: readonly T[];
    readonly nextCursor: string | null;
    readonly snapshotToken: string;
}
export class CollectionConflictError extends Error {
    readonly code = "collection_conflict";
    constructor(message = "This record changed in another tab. Reload the latest version before saving.") { super(message); this.name = "CollectionConflictError"; }
}
export class CollectionUnavailableError extends Error {
    readonly code = "collection_unavailable";
    constructor(message = "This record is no longer available. Reload the latest collection.") { super(message); this.name = "CollectionUnavailableError"; }
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
    listProjectsPage?(options?: ListOptions): Promise<CollectionPage<Project>>;
    listIdeasPage?(options?: ListOptions): Promise<CollectionPage<Idea>>;
    listMediaPage?(options?: ListOptions): Promise<CollectionPage<MediaItem>>;
    projectTodosPage?(projectId: string, options?: ListOptions): Promise<CollectionPage<Todo>>;
}
const project = (r: Tables<"projects">): Project => ({ id: r.id, title: r.title, description: r.description, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });
const idea = (r: Tables<"ideas">): Idea => ({ id: r.id, title: r.title, body: r.body, projectId: r.project_id, createdAt: r.created_at, updatedAt: r.updated_at });
const media = (r: Tables<"media">): MediaItem => ({ id: r.id, title: r.title, mediaType: r.media_type, creator: r.creator, releaseYear: r.release_year, status: r.status, rating: r.rating, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at });
const todo = (r: Tables<"todos">): Todo => ({ id: r.id, text: r.text, completed: r.completed, completedAt: r.completed_at, dueDate: r.due_date, dueTime: r.due_time, projectId: r.project_id, todayRank: r.today_rank, createdAt: r.created_at, updatedAt: r.updated_at });
function data<T>(response: {
    data: T | null;
    error: unknown;
}): T {
    if (response.error || response.data === null)
        throw new Error("Couldn’t load or save this record. Try again.");
    return response.data;
}
function operationError(error: unknown): Error {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return code === "PGRST116" || code === "23505" ? new CollectionConflictError() : new CollectionUnavailableError();
}
const signal = (s?: AbortSignal) => s ? AbortSignal.any([s, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
export function ideaTitle(record: Pick<Idea, "title" | "body">): string { return record.title?.trim() || record.body.split(/\r?\n/).find(line => line.trim())?.trim() || "Untitled idea"; }
export function createCollectionService(client: SupabaseClient<Database>): CollectionService {
    async function page<T>(kind: CollectionKind | "todo", options: ListOptions = {}): Promise<CollectionPage<T>> {
        const response = await client.rpc("list_collection_page", {
            p_record_type: kind, p_project_id: options.projectId ?? null, p_status: options.status ?? "all",
            p_media_type: options.mediaType ?? "all", p_cursor: options.cursor ?? null,
            p_snapshot_token: options.snapshotToken ?? null, p_limit: options.limit ?? 50,
        } as never).abortSignal(signal(options.signal));
        if (response.error || !response.data || typeof response.data !== "object" || Array.isArray(response.data)) throw operationError(response.error);
        const value = response.data as Record<string, unknown>;
        if (!Array.isArray(value.items) || typeof value.snapshot_token !== "string" ||
            (value.next_cursor !== null && typeof value.next_cursor !== "string")) throw new CollectionUnavailableError();
        const map = kind === "project" ? project : kind === "idea" ? idea : kind === "media" ? media : todo;
        return { items: value.items.map((row) => map(row as never)) as T[], nextCursor: value.next_cursor as string | null, snapshotToken: value.snapshot_token };
    }
    async function reconcile<T>(kind: CollectionKind, id: string): Promise<T | null> {
        try {
            const value = kind === "project" ? await client.from("projects").select("*").eq("id", id).is("deleted_at", null).maybeSingle()
                : kind === "idea" ? await client.from("ideas").select("*").eq("id", id).is("deleted_at", null).maybeSingle()
                : await client.from("media").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
            if (value.error || !value.data) return null;
            return (kind === "project" ? project(value.data as never) : kind === "idea" ? idea(value.data as never) : media(value.data as never)) as T;
        } catch { return null; }
    }
    return {
        listProjectsPage: (o = {}) => page<Project>("project", o),
        listIdeasPage: (o = {}) => page<Idea>("idea", o),
        listMediaPage: (o = {}) => page<MediaItem>("media", o),
        projectTodosPage: (projectId, o = {}) => page<Todo>("todo", { ...o, projectId }),
        async listProjects(o = {}) {
            let q = client.from("projects").select("*").is("deleted_at", null).order("updated_at", { ascending: false }).order("id");
            if (o.status && o.status !== "all")
                q = q.eq("status", o.status as ProjectStatus);
            return data(await q.range(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 50) - 1).abortSignal(signal(o.signal))).map(project);
        },
        async listIdeas(o = {}) {
            let q = client.from("ideas").select("*").is("deleted_at", null).order("updated_at", { ascending: false }).order("id");
            if (o.projectId)
                q = q.eq("project_id", o.projectId);
            return data(await q.range(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 50) - 1).abortSignal(signal(o.signal))).map(idea);
        },
        async listMedia(o = {}) {
            let q = client.from("media").select("*").is("deleted_at", null).order("updated_at", { ascending: false }).order("id");
            if (o.status && o.status !== "all")
                q = q.eq("status", o.status as MediaStatus);
            if (o.mediaType && o.mediaType !== "all")
                q = q.eq("media_type", o.mediaType as MediaType);
            return data(await q.range(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 50) - 1).abortSignal(signal(o.signal))).map(media);
        },
        async getProject(id) { return project(data(await client.from("projects").select("*").eq("id", id).is("deleted_at", null).abortSignal(signal()).single())); },
        async getIdea(id) { return idea(data(await client.from("ideas").select("*").eq("id", id).is("deleted_at", null).abortSignal(signal()).single())); },
        async getMedia(id) { return media(data(await client.from("media").select("*").eq("id", id).is("deleted_at", null).abortSignal(signal()).single())); },
        async getTodo(id) { return todo(data(await client.from("todos").select("*").eq("id", id).is("deleted_at", null).abortSignal(signal()).single())); },
        async saveProject(input, id) {
            if (!input.title.trim())
                throw new Error("Add a project title.");
            const values = { title: input.title.trim(), description: input.description?.trim() || null, status: input.status ?? "active" as const };
            const newId = id ? undefined : draftId(input);
            if (newId) { const existing = await reconcile<Project>("project", newId); if (existing) return existing; }
            try {
                let q = id ? client.from("projects").update(values).eq("id", id).is("deleted_at", null) : client.from("projects").insert({ ...(newId ? { id: newId } : {}), ...values });
                const version = id ? expectedUpdatedAt(input) : undefined;
                if (version !== undefined) q = q.eq("updated_at", version);
                const response = version === undefined ? await q.select("*").abortSignal(signal()).single() : await q.select("*").abortSignal(signal()).maybeSingle();
                if (version !== undefined && !response.data && !response.error) throw new CollectionConflictError();
                return project(data(response));
            } catch (error) { if (newId) { const existing = await reconcile<Project>("project", newId); if (existing) return existing; } throw error instanceof Error ? error : operationError(error); }
        },
        async saveIdea(input, id) {
            if (!input.body.trim())
                throw new Error("Add some text to your idea.");
            const values = { title: input.title?.trim() || null, body: input.body.trim(), project_id: input.projectId ?? null };
            const newId = id ? undefined : draftId(input);
            if (newId) { const existing = await reconcile<Idea>("idea", newId); if (existing) return existing; }
            try {
                let q = id ? client.from("ideas").update(values).eq("id", id).is("deleted_at", null) : client.from("ideas").insert({ ...(newId ? { id: newId } : {}), ...values });
                const version = id ? expectedUpdatedAt(input) : undefined;
                if (version !== undefined) q = q.eq("updated_at", version);
                const response = version === undefined ? await q.select("*").abortSignal(signal()).single() : await q.select("*").abortSignal(signal()).maybeSingle();
                if (version !== undefined && !response.data && !response.error) throw new CollectionConflictError();
                return idea(data(response));
            } catch (error) { if (newId) { const existing = await reconcile<Idea>("idea", newId); if (existing) return existing; } throw error instanceof Error ? error : operationError(error); }
        },
        async saveMedia(input, id) {
            if (!input.title.trim())
                throw new Error("Add a title.");
            const values = { title: input.title.trim(), media_type: input.mediaType, creator: input.creator?.trim() || null, release_year: input.releaseYear ?? null, status: input.status ?? "saved" as const, rating: input.rating ?? null, notes: input.notes?.trim() || null };
            const newId = id ? undefined : draftId(input);
            if (newId) { const existing = await reconcile<MediaItem>("media", newId); if (existing) return existing; }
            try {
                let q = id ? client.from("media").update(values).eq("id", id).is("deleted_at", null) : client.from("media").insert({ ...(newId ? { id: newId } : {}), ...values });
                const version = id ? expectedUpdatedAt(input) : undefined;
                if (version !== undefined) q = q.eq("updated_at", version);
                const response = version === undefined ? await q.select("*").abortSignal(signal()).single() : await q.select("*").abortSignal(signal()).maybeSingle();
                if (version !== undefined && !response.data && !response.error) throw new CollectionConflictError();
                return media(data(response));
            } catch (error) { if (newId) { const existing = await reconcile<MediaItem>("media", newId); if (existing) return existing; } throw error instanceof Error ? error : operationError(error); }
        },
        async softDelete(kind, id) {
            const token = data(await client.rpc("soft_delete_record", { p_record_type: kind, p_record_id: id }).abortSignal(signal()));
            if (!isDeleteUndoToken(token))
                throw new Error("Couldn’t delete this record. Try again.");
            return token;
        },
        async restore(kind, id, token) { return data(await client.rpc("restore_record", { p_record_type: kind, p_record_id: id, p_deleted_at: token }).abortSignal(signal())); },
        async search(query, offset = 0, s) {
            return data(await client.rpc("search_records", { p_query: query, p_offset: offset, p_limit: 40 }).abortSignal(signal(s))).map(r => ({ recordType: r.record_type, recordId: r.record_id, title: r.title, snippet: r.snippet, updatedAt: r.updated_at, relevance: r.relevance, totalCount: r.total_count }));
        },
        async projectTodos(projectId, offset = 0) { return data(await client.from("todos").select("*").eq("project_id", projectId).is("deleted_at", null).order("completed").order("created_at").order("id").range(offset, offset + 49).abortSignal(signal())).map(todo); },
    };
}
