// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ClassesPage } from "./ClassesPage";
import { createClassPersistenceFixture } from "../../qa/classPersistenceFixture";
import { cacheNavigationService, NavigationCache } from "../../apps/navigationCache";
import { ColdLoadGate } from "../../apps/coldLoad";
import { addSqlDateDays, localToday } from "../todos/dateDomain";

const due = addSqlDateDays(localToday("America/New_York"), 1);
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
it("renders classes immediately from a warmed cache with no loading flash", async () => {
  const data = createClassPersistenceFixture();
  const cache = new NavigationCache();
  const classService = cacheNavigationService(
    data.classes,
    cache,
    "classes",
    ["list"],
    ["create", "rename", "importLegacy"],
  );
  await classService.list("user-a", new AbortController().signal);
  render(
    <MemoryRouter>
      <ClassesPage userId="user-a" classService={classService} noteService={data.notes} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "MATH3012" })).toBeTruthy();
  expect(screen.queryByText("Loading classes…")).toBeNull();
});
it("renders an empty warmed cache immediately with no loading flash", async () => {
  const data = createClassPersistenceFixture(true);
  const cache = new NavigationCache();
  const classService = cacheNavigationService(
    data.classes,
    cache,
    "classes",
    ["list"],
    ["create", "rename", "importLegacy"],
  );
  await classService.list("user-a", new AbortController().signal);
  render(
    <MemoryRouter>
      <ClassesPage userId="user-a" classService={classService} noteService={data.notes} />
    </MemoryRouter>,
  );
  expect(
    screen.getByText("No classes yet. Add a class to save assignments and notes."),
  ).toBeTruthy();
  expect(screen.queryByText("Loading classes…")).toBeNull();
});
it("shows the loading placeholder with a cold cache", async () => {
  const data = createClassPersistenceFixture();
  const cache = new NavigationCache();
  const classService = cacheNavigationService(
    data.classes,
    cache,
    "classes",
    ["list"],
    ["create", "rename", "importLegacy"],
  );
  render(
    <MemoryRouter>
      <ClassesPage userId="user-a" classService={classService} noteService={data.notes} />
    </MemoryRouter>,
  );
  expect(screen.getByText("Loading classes…")).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "MATH3012" })).toBeTruthy();
});
it("holds the cold-load gate while classes load and releases it once resolved", async () => {
  const data = createClassPersistenceFixture();
  let resolveList: ((value: Awaited<ReturnType<typeof data.classes.list>>) => void) | undefined;
  vi.spyOn(data.classes, "list").mockReturnValue(
    new Promise((resolve) => {
      resolveList = resolve;
    }),
  );
  const { container } = render(
    <MemoryRouter>
      <ColdLoadGate>
        <ClassesPage userId="user-a" classService={data.classes} noteService={data.notes} />
      </ColdLoadGate>
    </MemoryRouter>,
  );
  const gate = container.querySelector(".cold-load");
  expect(gate?.getAttribute("data-cold")).toBe("true");
  await act(async () => {
    resolveList?.([]);
    await Promise.resolve();
  });
  await waitFor(() => expect(gate?.getAttribute("data-cold")).toBeNull());
});
it("releases the cold-load gate immediately when classes fail to load", async () => {
  const data = createClassPersistenceFixture();
  vi.spyOn(data.classes, "list").mockRejectedValue(new Error("boom"));
  const { container } = render(
    <MemoryRouter>
      <ColdLoadGate>
        <ClassesPage userId="user-a" classService={data.classes} noteService={data.notes} />
      </ColdLoadGate>
    </MemoryRouter>,
  );
  const gate = container.querySelector(".cold-load");
  await waitFor(() => expect(gate?.getAttribute("data-cold")).toBeNull());
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
it("gives each class row its next due date, open count, and note count", async () => {
  const data = createClassPersistenceFixture();
  const overviewService = {
    list: async () => ({
      math3012: { assignments: 6, open: 4, notes: 2, nextDue: { title: "Problem set 4", due } },
    }),
  };
  render(
    <MemoryRouter>
      <ClassesPage
        userId="user-a"
        classService={data.classes}
        noteService={data.notes}
        overviewService={overviewService}
        timezone="America/New_York"
      />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Due tomorrow · Problem set 4")).toBeTruthy();
  expect(screen.getByText("4 open · 2 notes")).toBeTruthy();
  // A class the totals say nothing about is empty, not unknown.
  expect(screen.getByText("Nothing saved yet")).toBeTruthy();
  expect(screen.queryByText("Open class")).toBeNull();
});
it("keeps the class list readable when the totals cannot be read", async () => {
  const data = createClassPersistenceFixture();
  render(
    <MemoryRouter>
      <ClassesPage
        userId="user-a"
        classService={data.classes}
        noteService={data.notes}
        overviewService={{ list: () => Promise.reject(new Error("offline")) }}
      />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { name: "MATH3012" })).toBeTruthy();
  await waitFor(() => expect(screen.getAllByText("Open class").length).toBe(2));
  expect(screen.queryByRole("alert")).toBeNull();
});
it("summarizes the open class in its header and follows the table when one is completed", async () => {
  const { createFixtureAssignments } = await import("../../qa/ClassAssignmentsMock");
  const data = createClassPersistenceFixture();
  render(
    <MemoryRouter>
      <ClassesPage
        userId="user-a"
        courseId="math3012"
        classService={data.classes}
        noteService={data.notes}
        assignmentService={createFixtureAssignments()}
        timezone="America/New_York"
      />
    </MemoryRouter>,
  );
  // Problem set 3 is two days past due, and none of the six is a saved note.
  expect(await screen.findByText(/^Past due .* · Problem set 3$/)).toBeTruthy();
  expect(screen.getByText("5 open")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Mark Problem set 3 done" }));
  expect(await screen.findByText("Due tomorrow · Problem set 4")).toBeTruthy();
  expect(screen.getByText("4 open")).toBeTruthy();
});
it("leaves an unfinished upload out of the class header's note count", async () => {
  const { createFixtureAssignments } = await import("../../qa/ClassAssignmentsMock");
  const { prepareUpload } = await import("./noteService");
  const data = createClassPersistenceFixture();
  const pdf = new File([new TextEncoder().encode("%PDF-1.4 fixture")], "lecture.pdf", {
    type: "application/pdf",
  });
  const signal = new AbortController().signal;
  const draft = await prepareUpload(pdf);
  // Reserved, never uploaded: the list calls this one "Upload incomplete".
  await data.notes.reserve("user-a", "math3012", draft, signal);
  await data.notes.attachDrive(
    "user-a",
    "math3012",
    { id: "lecture-one", name: "Lecture 1.pdf", folder: false, modifiedTime: null, size: null },
    signal,
  );
  render(
    <MemoryRouter>
      <ClassesPage
        userId="user-a"
        courseId="math3012"
        classService={data.classes}
        noteService={data.notes}
        assignmentService={createFixtureAssignments()}
        timezone="America/New_York"
      />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Upload incomplete")).toBeTruthy();
  expect(screen.getByText("5 open · 1 note")).toBeTruthy();
});
