import { useEffect, useRef, useState } from "react";
import { MarkdownField } from "../../components/markdown/MarkdownField";
import type { ClassService, Course } from "./classService";
import { serviceErrorMessage } from "../../lib/serviceError";

/**
 * What you write about a class, as one markdown document: the class's own page
 * rather than the PDFs saved beside it. Rendered at rest and source while you
 * write, so headings and lists read as headings and lists, and `copy` takes the
 * note somewhere else with its formatting intact.
 *
 * The text stays on screen whatever the save does, so a failed save leaves the
 * words in the field with the reason underneath rather than swallowing them.
 */
export function ClassNotes({
  userId,
  course,
  service,
  onSaved,
}: {
  userId: string;
  course: Course;
  service: ClassService;
  /** The saved class, so the list this page came from holds the new text too. */
  onSaved(course: Course): void;
}) {
  const [notes, setNotes] = useState(course.notes);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [service, userId, course.id],
  );
  // A class with no name cannot be written to: the update policy keeps a named
  // class named, so naming it comes first. The page says so above this field.
  const unnamed = course.name === null;
  async function save(next: string) {
    setNotes(next);
    // A second save supersedes the one still in flight rather than waiting
    // behind it: the field holds the whole document, so the later text is the
    // document and the earlier reply has nothing left to say.
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setSaved("Saving…");
    setError("");
    try {
      const row = await service.saveNotes(userId, course, next, controller.signal);
      if (!controller.signal.aborted) {
        setSaved("Saved");
        onSaved(row);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setSaved("");
        setError(serviceErrorMessage(cause, "Couldn’t save these notes. Try again."));
      }
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }
  return (
    <div className="classes-notes-written paper-measure">
      <MarkdownField
        value={notes}
        label={`${course.name ?? "Class"} notes`}
        placeholder="write notes"
        minRows={8}
        status={unnamed ? "Name this class before writing notes." : saved}
        disabled={unnamed}
        onCommit={(next) => void save(next)}
      />
      {error && (
        <p className="workspace-error paper-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
