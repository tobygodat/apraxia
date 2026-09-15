// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ClassesPage } from "./ClassesPage";
import { createClassPersistenceFixture } from "../../qa/classPersistenceFixture";
vi.mock("./PdfReader", () => ({
  default: ({ file, showTools }: { file: File; showTools: boolean }) => (
    <div data-testid="reader">
      {file.name}
      {showTools && <span>PDF toolbar</span>}
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
const mount = (data = createClassPersistenceFixture(), courseId?: string, userId = "user-a") =>
  render(
    <MemoryRouter>
      <ClassesPage
        userId={userId}
        courseId={courseId}
        classService={data.classes}
        noteService={data.notes}
      />
    </MemoryRouter>,
  );
it("saves added classes through the service, survives remount, and isolates accounts without writing browser storage", async () => {
  const data = createClassPersistenceFixture();
  const view = mount(data);
  fireEvent.click(await screen.findByRole("button", { name: "Add class" }));
  fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "CS1332" } });
  fireEvent.click(screen.getByRole("button", { name: "Save class" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  view.unmount();
  mount(data);
  expect(await screen.findByRole("heading", { name: "CS1332" })).toBeTruthy();
  expect(localStorage.length).toBe(0);
  cleanup();
  mount(data, undefined, "user-b");
  await screen.findByRole("button", { name: "Add class" });
  expect(screen.queryByRole("heading", { name: "CS1332" })).toBeNull();
});
it("rejects duplicate classes and preserves the form on database failure", async () => {
  const data = createClassPersistenceFixture();
  const create = vi
    .spyOn(data.classes, "create")
    .mockRejectedValueOnce(new Error("Offline. Try again."));
  mount(data);
  fireEvent.click(await screen.findByRole("button", { name: "Add class" }));
  fireEvent.change(screen.getByLabelText("Class name"), { target: { value: " math3012 " } });
  fireEvent.click(screen.getByRole("button", { name: "Save class" }));
  expect(screen.getByRole("alert").textContent).toContain("already exists");
  fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "CS1332" } });
  fireEvent.click(screen.getByRole("button", { name: "Save class" }));
  await screen.findByText("Offline. Try again.");
  expect((screen.getByLabelText("Class name") as HTMLInputElement).value).toBe("CS1332");
  fireEvent.click(screen.getByRole("button", { name: "Save class" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(create.mock.calls[0][1].id).toBe(create.mock.calls[1][1].id);
});
it("preserves unreadable browser data while still showing account classes", async () => {
  localStorage.setItem("orbitos:classes:v1:user-a", "broken");
  mount();
  expect(await screen.findByRole("heading", { name: "MATH3012" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("couldn’t be read");
  expect(localStorage.getItem("orbitos:classes:v1:user-a")).toBe("broken");
});
it("normalizes the legacy class code for import without changing the recovery copy", async () => {
  const raw = JSON.stringify([{ id: "math3012", code: "MATH3012", name: "Combinatorics" }]);
  localStorage.setItem("orbitos:classes:v1:user-a", raw);
  const data = createClassPersistenceFixture();
  const imported = vi.spyOn(data.classes, "importLegacy");
  mount(data, "math3012");
  fireEvent.click(await screen.findByRole("button", { name: "Edit class" }));
  expect(imported).toHaveBeenCalledWith(
    [{ id: "math3012", name: "MATH3012" }],
    expect.any(AbortSignal),
  );
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(localStorage.getItem("orbitos:classes:v1:user-a")).toBe(raw);
});
it("distinguishes failed loading from an unknown class and retries", async () => {
  const data = createClassPersistenceFixture();
  vi.spyOn(data.classes, "list").mockRejectedValueOnce(
    new Error("Couldn’t load classes. Try again."),
  );
  mount(data, "missing");
  await screen.findByRole("alert");
  expect(screen.queryByText("Class not found")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reload classes" }));
  expect(await screen.findByRole("heading", { name: "Class not found" })).toBeTruthy();
});
it("starts a new account empty rather than creating a default class", async () => {
  mount(createClassPersistenceFixture(true));
  expect(
    await screen.findByText("No classes yet. Add a class to save assignments and notes."),
  ).toBeTruthy();
});
it("uses todo-backed assignments in the class detail while retaining the inline editor", async () => {
  const { createFixtureAssignments } = await import("../../qa/ClassAssignmentsMock");
  const data = createClassPersistenceFixture();
  const assignments = createFixtureAssignments();
  render(
    <MemoryRouter>
      <ClassesPage
        userId="user-a"
        courseId="math3012"
        classService={data.classes}
        noteService={data.notes}
        assignmentService={assignments}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Edit title for Problem set 3" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Updated assignment" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(
    await screen.findByRole("button", { name: "Edit title for Updated assignment" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Delete Updated assignment" }));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  expect(
    await screen.findByRole("button", { name: "Edit title for Updated assignment" }),
  ).toBeTruthy();
});
