// @vitest-environment happy-dom
import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SavedClassNotes } from "./SavedClassNotes";
import { createClassPersistenceFixture } from "../../qa/classPersistenceFixture";
import type { NoteService } from "./noteService";
vi.stubGlobal("crypto", webcrypto);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const course = { id: "math3012", name: "MATH3012", notes: "", updatedAt: "seed" };
const pdf = () =>
  new File(["%PDF-1.7\nfictional notes"], "Lecture.pdf", { type: "application/pdf" });
const mount = (service: NoteService) =>
  render(
    <SavedClassNotes
      userId="owner"
      course={course}
      service={service}
      renderReader={(file) => <div data-testid="reader">{file.name}</div>}
    />,
  );
async function choose(file: File) {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Upload PDF" }).hasAttribute("disabled")).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("Choose PDF"), { target: { files: [file] } });
}
it("saves a device PDF and reopens it after remount without the original selection", async () => {
  const { notes } = createClassPersistenceFixture();
  const view = mount(notes);
  await choose(pdf());
  await screen.findByText("Saved PDF");
  expect(screen.getByTestId("reader").textContent).toBe("Lecture.pdf");
  view.unmount();
  mount(notes);
  fireEvent.click(await screen.findByRole("button", { name: "Lecture.pdf" }));
  expect(await screen.findByTestId("reader")).toBeTruthy();
});
it("keeps a failed upload pending and retries with the same note ID", async () => {
  const { notes } = createClassPersistenceFixture();
  const upload = vi.spyOn(notes, "upload").mockRejectedValueOnce(new Error("Upload interrupted"));
  mount(notes);
  await choose(pdf());
  expect(await screen.findByText("Upload incomplete")).toBeTruthy();
  expect(screen.queryByText("Saved PDF")).toBeNull();
  expect(screen.queryByTestId("reader")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));
  await screen.findByText("Saved PDF");
  expect(upload.mock.calls[0][0].id).toBe(upload.mock.calls[1][0].id);
  expect(await notes.list("owner", course.id, new AbortController().signal)).toHaveLength(1);
});
it("rejects a disguised non-PDF before creating any database record", async () => {
  const { notes } = createClassPersistenceFixture();
  const reserve = vi.spyOn(notes, "reserve");
  mount(notes);
  await choose(new File(["not a pdf"], "Fake.pdf", { type: "application/pdf" }));
  expect((await screen.findByRole("alert")).textContent).toContain("not a PDF");
  expect(reserve).not.toHaveBeenCalled();
});
it("recovers an incomplete note after remount and refuses a different file", async () => {
  const { notes } = createClassPersistenceFixture();
  vi.spyOn(notes, "upload").mockRejectedValueOnce(new Error("Upload interrupted"));
  const view = mount(notes);
  await choose(pdf());
  await screen.findByText("Upload incomplete");
  view.unmount();
  mount(notes);
  fireEvent.click(await screen.findByRole("button", { name: "Choose PDF again" }));
  await choose(
    new File(["%PDF-1.7\ndifferent content"], "Lecture.pdf", { type: "application/pdf" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain("original PDF");
  expect(screen.queryByText("Saved PDF")).toBeNull();
});
