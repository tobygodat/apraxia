import type { ClassService, Course } from "../features/classes/classService";
import type { ClassNote, NoteService } from "../features/classes/noteService";
import { prepareUpload } from "../features/classes/noteService";
import type { PersonalSnapshotNote } from "./personalSnapshot";
/** Fictional services only. Retained across navigation, reset on QA reload. */
/**
 * A full course load, so a scenario can exercise a surface that groups by
 * class. Two classes cannot produce the ragged column layout a real term does.
 */
const DENSE_COURSES: Course[] = [
  { id: "cs1332", name: "CS1332", updatedAt: "seed" },
  { id: "cs2340", name: "CS2340", updatedAt: "seed" },
  { id: "math2551", name: "MATH2551", updatedAt: "seed" },
  { id: "phys2211", name: "PHYS2211", updatedAt: "seed" },
];

export function createClassPersistenceFixture(
  empty = false,
  dense = false,
  /** The `personal` scenario's classes and saved notes, in place of the fictional ones. */
  seed?: {
    owner: string;
    classes: { id: string; name: string | null }[];
    notes: PersonalSnapshotNote[];
  },
): {
  classes: ClassService;
  notes: NoteService;
} {
  const owners = new Map<string, Course[]>();
  const notes = new Map<string, ClassNote>();
  const files = new Map<string, File>();
  let revision = 0;
  if (seed) {
    owners.set(
      seed.owner,
      seed.classes.map((course) => ({ ...course, updatedAt: "seed" })),
    );
    for (const note of seed.notes)
      notes.set(note.id, {
        id: note.id,
        user_id: seed.owner,
        course_id: note.courseId,
        name: note.name,
        source: note.source,
        // A placeholder: the snapshot never carries real Drive file ids.
        drive_file_id: note.source === "drive" ? `snapshot-${note.id}` : null,
        byte_size: note.byteSize,
        content_sha256: null,
        object_path: note.source === "upload" ? `${seed.owner}/${note.id}.pdf` : null,
        uploaded_at: note.saved && note.source === "upload" ? "2026-01-01T00:00:00.000Z" : null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      });
  }
  const rows = (owner: string) => {
    if (!owners.has(owner))
      owners.set(
        owner,
        empty
          ? []
          : [
              { id: "math3012", name: "MATH3012", updatedAt: "seed" },
              // A second, untouched class so the list shows both a class with
              // work in it and one with nothing saved yet.
              { id: "hist2111", name: "HIST2111", updatedAt: "seed" },
              ...(dense ? DENSE_COURSES : []),
            ],
      );
    return owners.get(owner)!;
  };
  return {
    classes: {
      async list(owner) {
        return rows(owner).map((row) => ({ ...row }));
      },
      async importLegacy() {
        /* QA never imports real browser records. */
      },
      async create(owner, value) {
        const existing = rows(owner).find((c) => c.id === value.id);
        if (existing) return { ...existing };
        const course = { ...value, updatedAt: String(++revision) };
        rows(owner).push(course);
        return { ...course };
      },
      async rename(owner, value, name) {
        const course = rows(owner).find((c) => c.id === value.id);
        if (!course || course.updatedAt !== value.updatedAt)
          throw new Error("This class changed elsewhere. Reload classes.");
        course.name = name;
        course.updatedAt = String(++revision);
        return { ...course };
      },
    },
    notes: {
      async list(owner, course) {
        return [...notes.values()]
          .filter((n) => n.user_id === owner && n.course_id === course)
          .map((n) => ({ ...n }));
      },
      async attachDrive(owner, course, file) {
        const existing = [...notes.values()].find(
          (n) => n.user_id === owner && n.course_id === course && n.drive_file_id === file.id,
        );
        if (existing) return existing;
        const note: ClassNote = {
          id: crypto.randomUUID(),
          user_id: owner,
          course_id: course,
          name: file.name,
          source: "drive",
          drive_file_id: file.id,
          byte_size: null,
          content_sha256: null,
          object_path: null,
          uploaded_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        notes.set(note.id, note);
        return note;
      },
      async reserve(owner, course, draft) {
        const existing = notes.get(draft.id);
        if (existing) {
          if (
            existing.user_id !== owner ||
            existing.course_id !== course ||
            existing.content_sha256 !== draft.sha256
          )
            throw new Error("Choose the original PDF to finish this upload.");
          return existing;
        }
        const note: ClassNote = {
          id: draft.id,
          user_id: owner,
          course_id: course,
          name: draft.name,
          source: "upload",
          drive_file_id: null,
          byte_size: draft.size,
          content_sha256: draft.sha256,
          object_path: `${owner}/${draft.id}.pdf`,
          uploaded_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        notes.set(note.id, note);
        return note;
      },
      async upload(note, file) {
        if ((await prepareUpload(file, note.id)).sha256 !== note.content_sha256)
          throw new Error("Choose the original PDF to finish this upload.");
        files.set(note.id, file);
        const saved = { ...note, uploaded_at: new Date().toISOString() };
        notes.set(note.id, saved);
        return saved;
      },
      async finish(note) {
        if (!files.has(note.id)) throw new Error("Choose the same PDF to finish the upload.");
        const saved = { ...note, uploaded_at: new Date().toISOString() };
        notes.set(note.id, saved);
        return saved;
      },
      async download(note) {
        const file = files.get(note.id);
        if (!file) throw new Error("PDF not found.");
        return file;
      },
    },
  };
}
