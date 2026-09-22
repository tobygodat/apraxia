/**
 * Reads and writes for the career prep pages.
 *
 * Two things the pages show are derived here rather than stored: an
 * application's next step is the earliest round that is not done, and the
 * counts under the heading are a tally over stage. Keeping them out of the
 * tables means there is no second copy to keep true.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { isSqlDate } from "../todos/dateDomain";
import { hasServiceErrorCode, ServiceError } from "../../lib/serviceError";
import type { Database, Json } from "../../types/database";
import { nextStepOf, orderApplications } from "./careerOrdering";
import type { CareerStage } from "./careerOrdering";

export type { CareerStage } from "./careerOrdering";
export { CAREER_STAGES, countByStage, nextStepOf, orderApplications } from "./careerOrdering";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

export type CareerResourceKind = Enums["career_resource_kind"];

export interface CareerApplication {
  id: string;
  company: string;
  role: string;
  appliedOn: string | null;
  stage: CareerStage;
  postingUrl: string | null;
  location: string | null;
  processNotes: string | null;
  updatedAt: string;
}

/** One round of the process. `scheduledOn` null reads as "not scheduled". */
export interface CareerStep {
  id: string;
  applicationId: string;
  name: string;
  scheduledOn: string | null;
  position: number;
  doneAt: string | null;
  notes: string | null;
}

export interface CareerQuestion {
  id: string;
  applicationId: string;
  body: string;
  answer: string | null;
  tags: string[];
  askedOn: string | null;
  createdAt: string;
}

export interface CareerPrepItem {
  id: string;
  applicationId: string;
  body: string;
  dueOn: string | null;
  doneAt: string | null;
  todoId: string | null;
  position: number;
}

/** One reviewed, client-identified action in an atomic plan import. */
export interface CareerPrepImportItem {
  id: string;
  body: string;
  dueOn: string | null;
}

/**
 * True when an import was rejected outright. The import is one transaction, so
 * nothing from it was saved and the draft may change before the next attempt.
 */
export function isDefiniteRejection(cause: unknown): boolean {
  return hasServiceErrorCode(cause, "not_found", "conflict", "invalid_input");
}

/**
 * A behavioural story. It belongs to the account rather than to one
 * application, because a story is written once and told at every company.
 */
export interface CareerStory {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: string;
}

/** Where one story has been told. */
export interface CareerStoryUse {
  storyId: string;
  applicationId: string;
  usedOn: string | null;
}

/** A file uploaded from this computer, or a link worth keeping. */
export interface CareerResource {
  id: string;
  applicationId: string;
  kind: CareerResourceKind;
  title: string;
  url: string | null;
  contentType: string | null;
  byteSize: number | null;
  contentSha256: string | null;
  objectPath: string | null;
  uploadedAt: string | null;
  createdAt: string;
}

/** An application with the next step read from its own rounds. */
export interface CareerApplicationRow extends CareerApplication {
  nextStep: CareerStep | null;
}

/** The file the browser has chosen, measured before anything is reserved. */
export interface CareerUploadDraft {
  id: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
}

export interface CareerApplicationDraft {
  company: string;
  role: string;
  appliedOn?: string | null;
  stage?: CareerStage;
  postingUrl?: string | null;
  location?: string | null;
  processNotes?: string | null;
}

/** A soft delete and the exact revision undo has to name. */
export interface CareerDeletion {
  id: string;
  deletedAt: string;
}

export interface CareerService {
  listApplications(userId: string, signal: AbortSignal): Promise<CareerApplicationRow[]>;
  getApplication(
    userId: string,
    applicationId: string,
    signal: AbortSignal,
  ): Promise<CareerApplication>;
  createApplication(
    userId: string,
    draft: CareerApplicationDraft,
    signal: AbortSignal,
  ): Promise<CareerApplication>;
  updateApplication(
    userId: string,
    applicationId: string,
    changes: Partial<CareerApplicationDraft>,
    signal: AbortSignal,
  ): Promise<CareerApplication>;
  deleteApplication(applicationId: string, signal: AbortSignal): Promise<CareerDeletion>;
  restoreApplication(deletion: CareerDeletion, signal: AbortSignal): Promise<boolean>;

  listSteps(userId: string, applicationId: string, signal: AbortSignal): Promise<CareerStep[]>;
  saveStep(
    userId: string,
    applicationId: string,
    step: Partial<CareerStep> & { name: string },
    signal: AbortSignal,
  ): Promise<CareerStep>;
  removeStep(userId: string, stepId: string, signal: AbortSignal): Promise<void>;

  listQuestions(
    userId: string,
    applicationId: string,
    signal: AbortSignal,
  ): Promise<CareerQuestion[]>;
  /** Every question carrying a tag, across applications. */
  listQuestionsByTag(userId: string, tag: string, signal: AbortSignal): Promise<CareerQuestion[]>;
  saveQuestion(
    userId: string,
    applicationId: string,
    question: Partial<CareerQuestion> & { body: string },
    signal: AbortSignal,
  ): Promise<CareerQuestion>;
  removeQuestion(userId: string, questionId: string, signal: AbortSignal): Promise<void>;

  listPrep(userId: string, applicationId: string, signal: AbortSignal): Promise<CareerPrepItem[]>;
  /**
   * Create a reviewed batch atomically. Reusing the same IDs is a read-only
   * replay, so an uncertain retry cannot overwrite later task edits.
   */
  importPrep(
    userId: string,
    applicationId: string,
    items: readonly CareerPrepImportItem[],
    signal: AbortSignal,
  ): Promise<CareerPrepItem[]>;
  savePrep(
    userId: string,
    applicationId: string,
    item: Partial<CareerPrepItem>,
    signal: AbortSignal,
  ): Promise<CareerPrepItem>;
  removePrep(userId: string, itemId: string, signal: AbortSignal): Promise<void>;

  listStories(userId: string, signal: AbortSignal): Promise<CareerStory[]>;
  saveStory(
    userId: string,
    story: Partial<CareerStory> & { title: string; body: string },
    signal: AbortSignal,
  ): Promise<CareerStory>;
  removeStory(userId: string, storyId: string, signal: AbortSignal): Promise<void>;
  /** Which applications each story has been told at. */
  listStoryUses(userId: string, signal: AbortSignal): Promise<CareerStoryUse[]>;
  recordStoryUse(userId: string, use: CareerStoryUse, signal: AbortSignal): Promise<CareerStoryUse>;
  removeStoryUse(
    userId: string,
    storyId: string,
    applicationId: string,
    signal: AbortSignal,
  ): Promise<void>;

  listResources(
    userId: string,
    applicationId: string,
    signal: AbortSignal,
  ): Promise<CareerResource[]>;
  addLink(
    userId: string,
    applicationId: string,
    link: { title: string; url: string },
    signal: AbortSignal,
  ): Promise<CareerResource>;
  reserveFile(
    userId: string,
    applicationId: string,
    draft: CareerUploadDraft,
    signal: AbortSignal,
  ): Promise<CareerResource>;
  uploadFile(resource: CareerResource, file: File, signal: AbortSignal): Promise<CareerResource>;
  downloadFile(resource: CareerResource, signal: AbortSignal): Promise<File>;
  removeResource(userId: string, resource: CareerResource, signal: AbortSignal): Promise<void>;
}

const FILE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
};

const FILE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Measure a chosen file before anything is reserved. Files come from this
 * computer only; there is no Drive picker here.
 */
export async function prepareFile(
  file: File,
  id: string = crypto.randomUUID(),
): Promise<CareerUploadDraft> {
  const name = file.name.trim();
  if (!name || [...name].length > 255)
    throw new ServiceError("invalid_input", "Use a filename of 1–255 characters.");
  const contentType = FILE_CONTENT_TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
  if (!contentType)
    throw new ServiceError("invalid_input", "Choose a PDF, Word, Markdown, or text file.");
  if (file.size < 1)
    throw new ServiceError("invalid_input", "This file is empty. Choose another one.");
  if (file.size > FILE_MAX_BYTES)
    throw new ServiceError("invalid_input", "Choose a file smaller than 25 MB.");
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return {
    id,
    name,
    contentType,
    size: file.size,
    sha256: Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join(""),
  };
}

/** A reservation is a row before it is a file: nothing can open it yet. */
export function isResourceReady(resource: Pick<CareerResource, "kind" | "uploadedAt">): boolean {
  return resource.kind === "link" || !!resource.uploadedAt;
}

const APPLICATION_COLUMNS =
  "id,user_id,company,role,applied_on,stage,posting_url,location,process_notes,updated_at";
const STEP_COLUMNS = "id,user_id,application_id,name,scheduled_on,position,done_at,notes";
const QUESTION_COLUMNS = "id,user_id,application_id,body,answer,tags,asked_on,created_at";
const PREP_COLUMNS = "id,user_id,application_id,body,due_on,done_at,todo_id,position";
const STORY_COLUMNS = "id,user_id,title,body,tags,updated_at";
const STORY_USE_COLUMNS = "user_id,story_id,application_id,used_on";
const RESOURCE_COLUMNS =
  "id,user_id,application_id,kind,title,url,content_type,byte_size,content_sha256,object_path,uploaded_at,created_at";

const PAGE = 200;
const bounded = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(20_000)]);

/** Every row a page reads is checked against the account that asked for it. */
function owned<T extends { user_id: string }>(row: T, userId: string): T {
  if (row.user_id !== userId) throw new ServiceError("not_found", "Couldn’t load this record.");
  return row;
}

function bounds(value: string, limit: number, message: string): string {
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > limit) throw new ServiceError("invalid_input", message);
  return trimmed;
}

function optional(value: string | null | undefined, limit: number, message: string) {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if ([...trimmed].length > limit) throw new ServiceError("invalid_input", message);
  return trimmed;
}

function link(value: string | null | undefined, required: boolean): string | null {
  const trimmed = optional(value, 2048, "Use a link of 2048 characters or fewer.");
  if (!trimmed) {
    if (required) throw new ServiceError("invalid_input", "Add a link to save this.");
    return null;
  }
  if (!/^https?:\/\/\S+$/.test(trimmed))
    throw new ServiceError("invalid_input", "Use a link that starts with http:// or https://.");
  return trimmed;
}

function toApplication(row: Tables["career_applications"]["Row"]): CareerApplication {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    appliedOn: row.applied_on,
    stage: row.stage,
    postingUrl: row.posting_url,
    location: row.location,
    processNotes: row.process_notes,
    updatedAt: row.updated_at,
  };
}

function toStep(row: Tables["career_steps"]["Row"]): CareerStep {
  return {
    id: row.id,
    applicationId: row.application_id,
    name: row.name,
    scheduledOn: row.scheduled_on,
    position: row.position,
    doneAt: row.done_at,
    notes: row.notes,
  };
}

function toQuestion(row: Tables["career_questions"]["Row"]): CareerQuestion {
  return {
    id: row.id,
    applicationId: row.application_id,
    body: row.body,
    answer: row.answer,
    tags: row.tags,
    askedOn: row.asked_on,
    createdAt: row.created_at,
  };
}

function toPrepItem(row: Tables["career_prep"]["Row"]): CareerPrepItem {
  return {
    id: row.id,
    applicationId: row.application_id,
    body: row.body,
    dueOn: row.due_on,
    doneAt: row.done_at,
    todoId: row.todo_id,
    position: row.position,
  };
}

function toStory(row: Tables["career_stories"]["Row"]): CareerStory {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags,
    updatedAt: row.updated_at,
  };
}

function toStoryUse(row: Tables["career_story_uses"]["Row"]): CareerStoryUse {
  return { storyId: row.story_id, applicationId: row.application_id, usedOn: row.used_on };
}

function toResource(row: Tables["career_resources"]["Row"]): CareerResource {
  return {
    id: row.id,
    applicationId: row.application_id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    contentType: row.content_type,
    byteSize: row.byte_size,
    contentSha256: row.content_sha256,
    objectPath: row.object_path,
    uploadedAt: row.uploaded_at,
    createdAt: row.created_at,
  };
}

// Storage upload exposes no AbortSignal. Stop waiting on navigation or timeout;
// the immutable object can finish later and the reserved row recovers it.
function waitForUpload<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function createCareerService(client: SupabaseClient<Database>): CareerService {
  /**
   * Read every row a query matches, following the page size out. The caller
   * builds its own query so each table keeps its real column types; `after` is
   * the last id already read, which is why every query orders by id.
   */
  async function page<Row extends { user_id: string }>(
    build: (after: string | undefined) => PromiseLike<{ data: unknown; error: unknown }>,
    key: (row: Row) => string,
    userId: string,
    failure: string,
  ): Promise<Row[]> {
    const rows: Row[] = [];
    let after: string | undefined;
    for (;;) {
      const { data, error } = await build(after);
      if (error || !data) throw new ServiceError("unavailable", failure);
      const batch = data as Row[];
      rows.push(...batch.map((row) => owned(row, userId)));
      if (batch.length < PAGE) return rows;
      after = key(batch[batch.length - 1]!);
    }
  }

  const byId = <Row extends { id: string }>(row: Row) => row.id;

  async function readResource(
    userId: string,
    resourceId: string,
    signal: AbortSignal,
  ): Promise<CareerResource> {
    const { data, error } = await client
      .from("career_resources")
      .select(RESOURCE_COLUMNS)
      .eq("id", resourceId)
      .eq("user_id", userId)
      .abortSignal(bounded(signal))
      .single();
    if (error || !data)
      throw new ServiceError("unavailable", "Couldn’t confirm this file was saved. Try again.");
    return toResource(owned(data as Tables["career_resources"]["Row"], userId));
  }

  async function finishFile(
    resource: CareerResource,
    userId: string,
    signal: AbortSignal,
  ): Promise<CareerResource> {
    const { error } = await client
      .rpc("finish_career_resource", { p_resource_id: resource.id })
      .abortSignal(bounded(signal));
    if (error)
      throw new ServiceError(
        "unavailable",
        "This file hasn’t finished saving. Try again, or choose the same file to finish the upload.",
      );
    return readResource(userId, resource.id, signal);
  }

  return {
    async listApplications(userId, signal) {
      const [applications, steps] = await Promise.all([
        page<Tables["career_applications"]["Row"]>(
          (after) => {
            let query = client
              .from("career_applications")
              .select(APPLICATION_COLUMNS)
              .eq("user_id", userId)
              .order("id")
              .limit(PAGE);
            if (after) query = query.gt("id", after);
            return query.abortSignal(bounded(signal));
          },
          byId,
          userId,
          "Couldn’t load your applications. Try again.",
        ),
        page<Tables["career_steps"]["Row"]>(
          (after) => {
            let query = client
              .from("career_steps")
              .select(STEP_COLUMNS)
              .eq("user_id", userId)
              .is("done_at", null)
              .order("id")
              .limit(PAGE);
            if (after) query = query.gt("id", after);
            return query.abortSignal(bounded(signal));
          },
          byId,
          userId,
          "Couldn’t load your applications. Try again.",
        ),
      ]);
      const open = new Map<string, CareerStep[]>();
      for (const row of steps) {
        const step = toStep(row);
        open.set(step.applicationId, [...(open.get(step.applicationId) ?? []), step]);
      }
      return orderApplications(
        applications.map((row) => ({
          ...toApplication(row),
          nextStep: nextStepOf(open.get(row.id) ?? []),
        })),
      );
    },

    async getApplication(userId, applicationId, signal) {
      const { data, error } = await client
        .from("career_applications")
        .select(APPLICATION_COLUMNS)
        .eq("id", applicationId)
        .eq("user_id", userId)
        .abortSignal(bounded(signal))
        .single();
      if (error || !data) throw new ServiceError("not_found", "Couldn’t load this application.");
      return toApplication(owned(data as Tables["career_applications"]["Row"], userId));
    },

    async createApplication(userId, draft, signal) {
      const { data, error } = await client
        .from("career_applications")
        .insert({
          user_id: userId,
          company: bounds(draft.company, 120, "Use a company name of 1–120 characters."),
          role: bounds(draft.role, 160, "Use a role of 1–160 characters."),
          applied_on: draft.appliedOn ?? null,
          stage: draft.stage ?? "interested",
          posting_url: link(draft.postingUrl, false),
          location: optional(draft.location, 120, "Use a location of 120 characters or fewer."),
          process_notes: draft.processNotes ?? null,
        })
        .select(APPLICATION_COLUMNS)
        .abortSignal(bounded(signal))
        .single();
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t save this application. Try again.");
      return toApplication(owned(data as Tables["career_applications"]["Row"], userId));
    },

    async updateApplication(userId, applicationId, changes, signal) {
      const patch: Tables["career_applications"]["Update"] = {};
      if (changes.company !== undefined)
        patch.company = bounds(changes.company, 120, "Use a company name of 1–120 characters.");
      if (changes.role !== undefined)
        patch.role = bounds(changes.role, 160, "Use a role of 1–160 characters.");
      if (changes.appliedOn !== undefined) patch.applied_on = changes.appliedOn;
      if (changes.stage !== undefined) patch.stage = changes.stage;
      if (changes.postingUrl !== undefined) patch.posting_url = link(changes.postingUrl, false);
      if (changes.location !== undefined)
        patch.location = optional(
          changes.location,
          120,
          "Use a location of 120 characters or fewer.",
        );
      if (changes.processNotes !== undefined) patch.process_notes = changes.processNotes;
      const { data, error } = await client
        .from("career_applications")
        .update(patch)
        .eq("id", applicationId)
        .eq("user_id", userId)
        .select(APPLICATION_COLUMNS)
        .abortSignal(bounded(signal))
        .single();
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t save your change. Try again.");
      return toApplication(owned(data as Tables["career_applications"]["Row"], userId));
    },

    // The browser never writes deleted_at: the shared RPC does, and it hands
    // back the exact revision undo has to name.
    async deleteApplication(applicationId, signal) {
      const { data, error } = await client
        .rpc("soft_delete_record", {
          p_record_type: "application",
          p_record_id: applicationId,
        })
        .abortSignal(bounded(signal));
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t delete this application. Try again.");
      return { id: applicationId, deletedAt: data };
    },

    async restoreApplication(deletion, signal) {
      const { data, error } = await client
        .rpc("restore_record", {
          p_record_type: "application",
          p_record_id: deletion.id,
          p_deleted_at: deletion.deletedAt,
        })
        .abortSignal(bounded(signal));
      if (error) throw new ServiceError("unavailable", "Couldn’t undo that. Try again.");
      return data === true;
    },

    async listSteps(userId, applicationId, signal) {
      const rows = await page<Tables["career_steps"]["Row"]>(
        (after) => {
          let query = client
            .from("career_steps")
            .select(STEP_COLUMNS)
            .eq("user_id", userId)
            .eq("application_id", applicationId)
            .order("id")
            .limit(PAGE);
          if (after) query = query.gt("id", after);
          return query.abortSignal(bounded(signal));
        },
        byId,
        userId,
        "Couldn’t load this process. Try again.",
      );
      return rows.map(toStep).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    },

    async saveStep(userId, applicationId, step, signal) {
      const { data, error } = await client
        .from("career_steps")
        .upsert(
          {
            id: step.id,
            user_id: userId,
            application_id: applicationId,
            name: bounds(step.name, 160, "Use a step name of 1–160 characters."),
            scheduled_on: step.scheduledOn ?? null,
            position: step.position ?? 0,
            done_at: step.doneAt ?? null,
            notes: step.notes ?? null,
          },
          { onConflict: "id" },
        )
        .select(STEP_COLUMNS)
        .abortSignal(bounded(signal))
        .single();
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t save this step. Try again.");
      return toStep(owned(data as Tables["career_steps"]["Row"], userId));
    },

    async removeStep(userId, stepId, signal) {
      const { error } = await client
        .from("career_steps")
        .delete()
        .eq("id", stepId)
        .eq("user_id", userId)
        .abortSignal(bounded(signal));
      if (error) throw new ServiceError("unavailable", "Couldn’t remove this step. Try again.");
    },

    async listQuestions(userId, applicationId, signal) {
      const rows = await page<Tables["career_questions"]["Row"]>(
        (after) => {
          let query = client
            .from("career_questions")
            .select(QUESTION_COLUMNS)
            .eq("user_id", userId)
            .eq("application_id", applicationId)
            .order("id")
            .limit(PAGE);
          if (after) query = query.gt("id", after);
          return query.abortSignal(bounded(signal));
        },
        byId,
        userId,
        "Couldn’t load these questions. Try again.",
      );
      return rows
        .map(toQuestion)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },

    // The tag is what reaches across applications, so it is matched exactly:
    // the database already lowercased and trimmed every stored tag.
    async listQuestionsByTag(userId, tag, signal) {
      const wanted = tag.trim().toLowerCase();
      if (!wanted) return [];
      const rows = await page<Tables["career_questions"]["Row"]>(
        (after) => {
          let query = client
            .from("career_questions")
            .select(QUESTION_COLUMNS)
            .eq("user_id", userId)
            // Quoted explicitly: a tag may hold a comma or a brace, which an
            // unquoted array literal would read as structure.
            .filter("tags", "cs", `{"${wanted.replace(/(["\\])/g, "\\$1")}"}`)
            .order("id")
            .limit(PAGE);
          if (after) query = query.gt("id", after);
          return query.abortSignal(bounded(signal));
        },
        byId,
        userId,
        "Couldn’t load questions for this tag. Try again.",
      );
      return rows
        .map(toQuestion)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    },

    async saveQuestion(userId, applicationId, question, signal) {
      const { data, error } = await client
        .from("career_questions")
        .upsert(
          {
            id: question.id,
            user_id: userId,
            application_id: applicationId,
            body: bounds(question.body, 4000, "Use a question of 1–4000 characters."),
            answer: question.answer ?? null,
            // Casing and duplicates are the database's to fix, so the page can
            // send what was typed.
            tags: question.tags ?? [],
            asked_on: question.askedOn ?? null,
          },
          { onConflict: "id" },
        )
        .select(QUESTION_COLUMNS)
        .abortSignal(bounded(signal))
        .single();
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t save this question. Try again.");
      return toQuestion(owned(data as Tables["career_questions"]["Row"], userId));
    },

    async removeQuestion(userId, questionId, signal) {
      const { error } = await client
        .from("career_questions")
        .delete()
        .eq("id", questionId)
        .eq("user_id", userId)
        .abortSignal(bounded(signal));
      if (error) throw new ServiceError("unavailable", "Couldn’t remove this question. Try again.");
    },

    async listPrep(userId, applicationId, signal) {
      const rows = await page<Tables["career_prep"]["Row"]>(
        (after) => {
          let query = client
            .from("career_prep")
            .select(PREP_COLUMNS)
            .eq("user_id", userId)
            .eq("application_id", applicationId)
            .order("id")
            .limit(PAGE);
          if (after) query = query.gt("id", after);
          return query.abortSignal(bounded(signal));
        },
        byId,
        userId,
        "Couldn’t load this prep list. Try again.",
      );
      return rows
        .map(toPrepItem)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    },

    async savePrep(userId, applicationId, item, signal) {
      // New rows use the create-only import path so a generated ID is the
      // idempotency key. Existing rows have a separate edit RPC: conflating the
      // two would let a retry overwrite a task changed from Today meanwhile.
      if (!item.id) {
        if (item.body === undefined)
          throw new ServiceError("invalid_input", "Add prep text before saving.");
        const [created] = await this.importPrep(
          userId,
          applicationId,
          [{ id: crypto.randomUUID(), body: item.body, dueOn: item.dueOn ?? null }],
          signal,
        );
        if (!created)
          throw new ServiceError("unavailable", "Couldn’t save this prep note. Try again.");
        return created;
      }

      const body = item.body?.trim();
      if (item.body !== undefined && !body)
        throw new ServiceError("invalid_input", "Add prep text before saving.");
      if (item.dueOn !== undefined && item.dueOn !== null && !isSqlDate(item.dueOn))
        throw new ServiceError("invalid_input", "Use a valid date for this prep item.");

      const payload: Record<string, Json | undefined> = { id: item.id };
      if (body !== undefined) payload.body = body;
      if (item.dueOn !== undefined) payload.due_on = item.dueOn;
      if (item.doneAt !== undefined) payload.completed = item.doneAt !== null;
      if (item.position !== undefined) payload.position = item.position;

      const { data, error } = await client
        .rpc("save_career_prep_item", {
          p_application_id: applicationId,
          p_item: payload,
        })
        .abortSignal(bounded(signal))
        .single();
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t save this prep note. Try again.");
      return toPrepItem(owned(data as Tables["career_prep"]["Row"], userId));
    },

    async importPrep(userId, applicationId, items, signal) {
      if (items.length < 1 || items.length > 50)
        throw new ServiceError("invalid_input", "Import 1–50 prep items at a time.");
      if (new Set(items.map((item) => item.id)).size !== items.length)
        throw new ServiceError("invalid_input", "Each prep item needs a unique ID.");

      const payload = items.map((item) => {
        if (!item.id) throw new ServiceError("invalid_input", "Each prep item needs a stable ID.");
        if (item.dueOn !== null && !isSqlDate(item.dueOn))
          throw new ServiceError("invalid_input", "Use a valid date for each prep item.");
        return {
          id: item.id,
          body: bounds(item.body, 2000, "Use a prep note of 1–2000 characters."),
          due_on: item.dueOn,
        };
      });

      const { data, error } = await client
        .rpc("import_career_prep_items", {
          p_application_id: applicationId,
          p_items: payload,
        })
        .abortSignal(bounded(signal));
      // The import is one transaction, so a rejection saved nothing. Only a
      // failure that could have hidden a commit is worth retrying unchanged.
      if (error?.code === "P0002")
        throw new ServiceError("not_found", "This application is no longer available.");
      if (error?.code === "23505")
        throw new ServiceError("conflict", "These tasks clash with saved ones. Save them again.");
      if (error?.code === "22023" || error?.code === "22007" || error?.code === "22008")
        throw new ServiceError(
          "invalid_input",
          "Check each task’s text and date, then save again.",
        );
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t import this prep plan. Try again.");
      return (data as Tables["career_prep"]["Row"][]).map((row) => toPrepItem(owned(row, userId)));
    },

    async removePrep(userId, itemId, signal) {
      // userId stays in the browser-facing interface for parity with the other
      // career children. Ownership itself is derived from the authenticated RPC.
      void userId;
      const { error } = await client
        .rpc("remove_career_prep_item", { p_item_id: itemId })
        .abortSignal(bounded(signal));
      if (error)
        throw new ServiceError("unavailable", "Couldn’t remove this prep note. Try again.");
    },

    // Stories belong to the account, so they are read once and shown on every
    // application's prep tab.
    async listStories(userId, signal) {
      const rows = await page<Tables["career_stories"]["Row"]>(
        (after) => {
          let query = client
            .from("career_stories")
            .select(STORY_COLUMNS)
            .eq("user_id", userId)
            .order("id")
            .limit(PAGE);
          if (after) query = query.gt("id", after);
          return query.abortSignal(bounded(signal));
        },
        byId,
        userId,
        "Couldn’t load your stories. Try again.",
      );
      // The story you last sharpened sorts first.
      return rows
        .map(toStory)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    },

    async saveStory(userId, story, signal) {
      const { data, error } = await client
        .from("career_stories")
        .upsert(
          {
            id: story.id,
            user_id: userId,
            title: bounds(story.title, 160, "Use a title of 1–160 characters."),
            body: bounds(story.body, 40000, "Write the story in 40000 characters or fewer."),
            tags: story.tags ?? [],
          },
          { onConflict: "id" },
        )
        .select(STORY_COLUMNS)
        .abortSignal(bounded(signal))
        .single();
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t save this story. Try again.");
      return toStory(owned(data as Tables["career_stories"]["Row"], userId));
    },

    async removeStory(userId, storyId, signal) {
      const { error } = await client
        .from("career_stories")
        .delete()
        .eq("id", storyId)
        .eq("user_id", userId)
        .abortSignal(bounded(signal));
      if (error) throw new ServiceError("unavailable", "Couldn’t remove this story. Try again.");
    },

    async listStoryUses(userId, signal) {
      const rows = await page<Tables["career_story_uses"]["Row"]>(
        (after) => {
          let query = client
            .from("career_story_uses")
            .select(STORY_USE_COLUMNS)
            .eq("user_id", userId)
            .order("story_id")
            .limit(PAGE);
          if (after) query = query.gt("story_id", after);
          return query.abortSignal(bounded(signal));
        },
        (row) => row.story_id,
        userId,
        "Couldn’t load where your stories were used. Try again.",
      );
      return rows.map(toStoryUse);
    },

    // The pair is the key, so recording the same use twice is one row.
    async recordStoryUse(userId, use, signal) {
      const { data, error } = await client
        .from("career_story_uses")
        .upsert(
          {
            user_id: userId,
            story_id: use.storyId,
            application_id: use.applicationId,
            used_on: use.usedOn ?? null,
          },
          { onConflict: "story_id,application_id" },
        )
        .select(STORY_USE_COLUMNS)
        .abortSignal(bounded(signal))
        .single();
      if (error || !data) throw new ServiceError("unavailable", "Couldn’t record that. Try again.");
      return toStoryUse(owned(data as Tables["career_story_uses"]["Row"], userId));
    },

    async removeStoryUse(userId, storyId, applicationId, signal) {
      const { error } = await client
        .from("career_story_uses")
        .delete()
        .eq("user_id", userId)
        .eq("story_id", storyId)
        .eq("application_id", applicationId)
        .abortSignal(bounded(signal));
      if (error) throw new ServiceError("unavailable", "Couldn’t remove that. Try again.");
    },

    async listResources(userId, applicationId, signal) {
      const rows = await page<Tables["career_resources"]["Row"]>(
        (after) => {
          let query = client
            .from("career_resources")
            .select(RESOURCE_COLUMNS)
            .eq("user_id", userId)
            .eq("application_id", applicationId)
            .order("id")
            .limit(PAGE);
          if (after) query = query.gt("id", after);
          return query.abortSignal(bounded(signal));
        },
        byId,
        userId,
        "Couldn’t load these resources. Try again.",
      );
      return rows
        .map(toResource)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },

    // A link reserves nothing and needs no bucket: it is saved in one write.
    async addLink(userId, applicationId, linkDraft, signal) {
      const { data, error } = await client
        .from("career_resources")
        .insert({
          user_id: userId,
          application_id: applicationId,
          kind: "link",
          title: bounds(linkDraft.title, 255, "Use a title of 1–255 characters."),
          url: link(linkDraft.url, true),
        })
        .select(RESOURCE_COLUMNS)
        .abortSignal(bounded(signal))
        .single();
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t save this link. Try again.");
      return toResource(owned(data as Tables["career_resources"]["Row"], userId));
    },

    // The row is reserved before the bytes are sent, so an interrupted upload
    // leaves something to resume rather than orphaned bytes.
    async reserveFile(userId, applicationId, draft, signal) {
      const { error } = await client
        .from("career_resources")
        .upsert(
          {
            id: draft.id,
            user_id: userId,
            application_id: applicationId,
            kind: "file",
            title: draft.name,
            content_type: draft.contentType,
            byte_size: draft.size,
            content_sha256: draft.sha256,
          },
          { onConflict: "id", ignoreDuplicates: true },
        )
        .abortSignal(bounded(signal));
      if (error)
        throw new ServiceError(
          "unavailable",
          "Couldn’t start saving this file. Your file is still selected; try again.",
        );
      const resource = await readResource(userId, draft.id, signal);
      if (
        resource.kind !== "file" ||
        resource.byteSize !== draft.size ||
        resource.contentSha256 !== draft.sha256 ||
        resource.contentType !== draft.contentType
      )
        throw new ServiceError("invalid_input", "Choose the original file to finish this upload.");
      return resource;
    },

    async uploadFile(resource, file, signal) {
      const draft = await prepareFile(file, resource.id);
      signal.throwIfAborted();
      if (
        resource.kind !== "file" ||
        !resource.objectPath ||
        !resource.contentType ||
        draft.sha256 !== resource.contentSha256 ||
        draft.size !== resource.byteSize ||
        draft.contentType !== resource.contentType
      )
        throw new ServiceError("invalid_input", "Choose the original file to finish this upload.");
      if (resource.uploadedAt) return resource;
      const owner = resource.objectPath.split("/")[0]!;
      const contentType = resource.contentType;
      const uploadSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
      const result = await waitForUpload(
        client.storage
          .from("career-resources")
          .upload(
            resource.objectPath,
            file.type === contentType ? file : new File([file], file.name, { type: contentType }),
            { contentType, upsert: false, cacheControl: "0" },
          ),
        uploadSignal,
      );
      signal.throwIfAborted();
      // A conflict or failed response may be a previous successful attempt.
      // Finalization verifies the object before claiming the file is saved.
      try {
        return await finishFile(resource, owner, signal);
      } catch (cause) {
        if (result.error)
          throw new ServiceError(
            "unavailable",
            "Couldn’t finish uploading this file. Your file is still selected; try again.",
          );
        throw cause;
      }
    },

    async downloadFile(resource, signal) {
      if (resource.kind !== "file" || !resource.uploadedAt || !resource.objectPath)
        throw new ServiceError("invalid_input", "Finish saving this file before opening it.");
      const { data, error } = await client.storage
        .from("career-resources")
        .download(
          resource.objectPath,
          {},
          { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), cache: "no-store" },
        );
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t open this file. Try again.");
      return new File([data], resource.title, { type: resource.contentType ?? "text/plain" });
    },

    // The stored object goes first: its policy authorizes it only while the row
    // it belongs to still exists, so the row has to outlive the bytes.
    async removeResource(userId, resource, signal) {
      if (resource.objectPath && resource.uploadedAt) {
        const { error } = await client.storage
          .from("career-resources")
          .remove([resource.objectPath]);
        if (error) throw new ServiceError("unavailable", "Couldn’t remove this file. Try again.");
      }
      const { error } = await client
        .from("career_resources")
        .delete()
        .eq("id", resource.id)
        .eq("user_id", userId)
        .abortSignal(bounded(signal));
      if (error) throw new ServiceError("unavailable", "Couldn’t remove this resource. Try again.");
    },
  };
}
