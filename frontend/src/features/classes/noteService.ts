import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import type { DriveFile } from "./driveService";
import { ServiceError } from "../../lib/serviceError";
/** The columns the browser selects. The row also carries a search vector, which no client reads. */
export type ClassNote = Omit<Database["public"]["Tables"]["class_notes"]["Row"], "search_vector">;
export interface UploadDraft {
  id: string;
  name: string;
  size: number;
  sha256: string;
}
export interface NoteService {
  list(userId: string, courseId: string, signal: AbortSignal): Promise<ClassNote[]>;
  attachDrive(
    userId: string,
    courseId: string,
    file: DriveFile,
    signal: AbortSignal,
  ): Promise<ClassNote>;
  reserve(
    userId: string,
    courseId: string,
    draft: UploadDraft,
    signal: AbortSignal,
  ): Promise<ClassNote>;
  upload(note: ClassNote, file: File, signal: AbortSignal): Promise<ClassNote>;
  finish(note: ClassNote, signal: AbortSignal): Promise<ClassNote>;
  download(note: ClassNote, signal: AbortSignal): Promise<File>;
}
const PDF_MAX_BYTES = 50 * 1024 * 1024;
export async function prepareUpload(
  file: File,
  id: string = crypto.randomUUID(),
): Promise<UploadDraft> {
  if (
    !file.name.toLowerCase().endsWith(".pdf") ||
    (file.type && file.type !== "application/pdf") ||
    file.size < 5
  )
    throw new ServiceError("invalid_input", "Choose a PDF file.");
  if (file.size > PDF_MAX_BYTES)
    throw new ServiceError("invalid_input", "Choose a PDF smaller than 50 MB.");
  const bytes = await file.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    throw new ServiceError(
      "invalid_input",
      "This file is not a PDF. Choose a PDF exported from your notes app.",
    );
  const name = file.name.trim();
  if (!name || [...name].length > 255)
    throw new ServiceError("invalid_input", "Shorten the filename to 255 characters or fewer.");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return {
    id,
    name,
    size: file.size,
    sha256: Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join(""),
  };
}
const columns =
  "id,user_id,course_id,name,source,drive_file_id,byte_size,content_sha256,object_path,uploaded_at,created_at,updated_at";
const bounded = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
function checked(note: ClassNote, owner: string, course: string) {
  if (note.user_id !== owner || note.course_id !== course)
    throw new ServiceError("not_found", "Couldn’t load this note.");
  return note;
}
// Storage upload currently exposes no AbortSignal. Stop waiting on navigation or
// timeout; its immutable object can finish later and the pending row recovers it.
function waitForUpload<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export function createNoteService(client: SupabaseClient<Database>): NoteService {
  async function read(note: Pick<ClassNote, "id" | "user_id" | "course_id">, signal: AbortSignal) {
    const { data, error } = await client
      .from("class_notes")
      .select(columns)
      .eq("id", note.id)
      .eq("user_id", note.user_id)
      .eq("course_id", note.course_id)
      .abortSignal(bounded(signal))
      .single();
    if (error || !data)
      throw new ServiceError("unavailable", "Couldn’t confirm this note was saved. Try again.");
    return checked(data, note.user_id, note.course_id);
  }
  async function finish(note: ClassNote, signal: AbortSignal) {
    const { error } = await client
      .rpc("finish_class_pdf", { p_note_id: note.id })
      .abortSignal(bounded(signal));
    if (error)
      throw new ServiceError(
        "unavailable",
        "The PDF hasn’t finished saving. Try again, or choose the same PDF to finish the upload.",
      );
    return read(note, signal);
  }
  return {
    async list(userId, courseId, signal) {
      const notes: ClassNote[] = [];
      let after: string | undefined;
      for (;;) {
        let query = client
          .from("class_notes")
          .select(columns)
          .eq("user_id", userId)
          .eq("course_id", courseId)
          .order("id")
          .limit(200);
        if (after) query = query.gt("id", after);
        const { data, error } = await query.abortSignal(bounded(signal));
        if (error || !data)
          throw new ServiceError("unavailable", "Couldn’t load saved notes. Try again.");
        notes.push(...data.map((n) => checked(n, userId, courseId)));
        if (data.length < 200)
          return notes.sort(
            (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
          );
        after = data[data.length - 1]!.id;
      }
    },
    async attachDrive(userId, courseId, file, signal) {
      if (
        file.folder ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(file.id) ||
        !file.name.trim() ||
        [...file.name.trim()].length > 255
      )
        throw new ServiceError(
          "invalid_input",
          "Choose a PDF with a filename of 1–255 characters.",
        );
      const { error } = await client
        .from("class_notes")
        .upsert(
          {
            user_id: userId,
            course_id: courseId,
            name: file.name.trim(),
            source: "drive",
            drive_file_id: file.id,
          },
          { onConflict: "user_id,course_id,drive_file_id", ignoreDuplicates: true },
        )
        .abortSignal(bounded(signal));
      if (error)
        throw new ServiceError("unavailable", "Couldn’t save the Drive note. Try adding it again.");
      const result = await client
        .from("class_notes")
        .select(columns)
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .eq("drive_file_id", file.id)
        .abortSignal(bounded(signal))
        .single();
      if (result.error || !result.data)
        throw new ServiceError(
          "unavailable",
          "Couldn’t confirm the Drive note was saved. Try adding it again.",
        );
      return checked(result.data, userId, courseId);
    },
    async reserve(userId, courseId, draft, signal) {
      const { error } = await client
        .from("class_notes")
        .upsert(
          {
            id: draft.id,
            user_id: userId,
            course_id: courseId,
            name: draft.name,
            source: "upload",
            byte_size: draft.size,
            content_sha256: draft.sha256,
          },
          { onConflict: "id", ignoreDuplicates: true },
        )
        .abortSignal(bounded(signal));
      if (error)
        throw new ServiceError(
          "unavailable",
          "Couldn’t start saving this PDF. Your file is still selected; try again.",
        );
      const note = await read({ id: draft.id, user_id: userId, course_id: courseId }, signal);
      if (
        note.source !== "upload" ||
        note.byte_size !== draft.size ||
        note.content_sha256 !== draft.sha256
      )
        throw new ServiceError("invalid_input", "Choose the original PDF to finish this upload.");
      return note;
    },
    async upload(note, file, signal) {
      const draft = await prepareUpload(file, note.id);
      signal.throwIfAborted();
      if (
        draft.sha256 !== note.content_sha256 ||
        draft.size !== note.byte_size ||
        !note.object_path ||
        note.source !== "upload"
      )
        throw new ServiceError("invalid_input", "Choose the original PDF to finish this upload.");
      if (note.uploaded_at) return note;
      const uploadSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
      const pdf =
        file.type === "application/pdf"
          ? file
          : new File([file], file.name, { type: "application/pdf" });
      const result = await waitForUpload(
        client.storage.from("class-pdfs").upload(note.object_path, pdf, {
          contentType: "application/pdf",
          upsert: false,
          cacheControl: "0",
        }),
        uploadSignal,
      );
      signal.throwIfAborted();
      // A conflict or failed response may be a previous successful attempt.
      // Finalization verifies the object and expected size before claiming saved.
      try {
        return await finish(note, signal);
      } catch (cause) {
        if (result.error)
          throw new ServiceError(
            "unavailable",
            "Couldn’t finish uploading this PDF. Your file is still selected; try again.",
          );
        throw cause;
      }
    },
    finish,
    async download(note, signal) {
      if (note.source !== "upload" || !note.uploaded_at || !note.object_path)
        throw new ServiceError("invalid_input", "Finish saving this PDF before opening it.");
      const { data, error } = await client.storage
        .from("class-pdfs")
        .download(
          note.object_path,
          {},
          { signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), cache: "no-store" },
        );
      if (error || !data)
        throw new ServiceError("unavailable", "Couldn’t open the saved PDF. Try again.");
      return new File([data], note.name, { type: "application/pdf" });
    },
  };
}
