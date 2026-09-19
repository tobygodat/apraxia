// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClassNotes } from "./ClassNotes";
import { ServiceError } from "../../lib/serviceError";
import { createClassPersistenceFixture } from "../../qa/classPersistenceFixture";
import type { ClassService, Course } from "./classService";
afterEach(cleanup);
const course: Course = { id: "math3012", name: "MATH3012", notes: "", updatedAt: "seed" };
const mount = (
  service: ClassService,
  value: Course = course,
  onSaved: (row: Course) => void = () => {},
) => render(<ClassNotes userId="owner" course={value} service={service} onSaved={onSaved} />);

async function write(text: string) {
  fireEvent.click(await screen.findByRole("button", { name: "write notes" }));
  const source = await screen.findByLabelText("MATH3012 notes");
  fireEvent.change(source, { target: { value: text } });
  fireEvent.blur(source);
  return source;
}

it("renders a written note as markdown rather than its source", async () => {
  const { classes } = createClassPersistenceFixture();
  const view = mount(classes, { ...course, notes: "# Week 6\n\n- [ ] read chapter 2" });
  expect((await screen.findByRole("heading", { name: "Week 6" })).tagName).toBe("H3");
  // The box mirrors the note's text, so it is hidden from a reader and the
  // words beside it carry the meaning.
  expect(view.container.querySelector(".markdown__list--tasks")).toBeTruthy();
  expect(screen.getByText("read chapter 2")).toBeTruthy();
  expect(screen.queryByText("# Week 6")).toBeNull();
});

it("saves what was written and hands the saved class back", async () => {
  const { classes } = createClassPersistenceFixture();
  const saved: Course[] = [];
  mount(classes, course, (row) => saved.push(row));
  await write("## Lecture 1\n\nGenerating functions.");
  await screen.findByText("Saved");
  await waitFor(() => expect(saved.at(-1)?.notes).toBe("## Lecture 1\n\nGenerating functions."));
  expect(
    (await classes.list("owner", new AbortController().signal)).find((c) => c.id === course.id)
      ?.notes,
  ).toBe("## Lecture 1\n\nGenerating functions.");
});

it("keeps the words on screen when the save fails, and says why", async () => {
  const { classes } = createClassPersistenceFixture();
  vi.spyOn(classes, "saveNotes").mockRejectedValueOnce(
    new ServiceError("unavailable", "Couldn’t save these notes. Try again."),
  );
  mount(classes);
  await write("Everything I just typed");
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Couldn’t save these notes. Try again.",
  );
  expect(screen.getByText("Everything I just typed")).toBeTruthy();
});

it("waits for a name before a recovered class can be written to", async () => {
  const { classes } = createClassPersistenceFixture();
  mount(classes, { ...course, name: null });
  const start = await screen.findByRole("button", { name: "write notes" });
  expect(start.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Name this class before writing notes.")).toBeTruthy();
});
