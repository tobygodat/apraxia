// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ClassesPage } from "./ClassesPage";

vi.mock("./PdfReader", () => ({ default: ({ file, showTools }: { file: File; showTools: boolean }) => <div data-testid="reader">{file.name}{showTools && <span>PDF toolbar</span>}</div> }));

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const mount = (courseId?: string, userId = "user-a") => render(<MemoryRouter><ClassesPage userId={userId} courseId={courseId} /></MemoryRouter>);

it("saves added classes across mounts and isolates accounts", () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Add class" }));
  fireEvent.change(screen.getByLabelText("Class name"), { target: { value: "CS1332" } });
  fireEvent.click(screen.getByRole("button", { name: "Save class" }));
  view.unmount(); mount();
  expect(screen.getByRole("heading", { name: "CS1332" })).toBeTruthy();
  cleanup(); mount(undefined, "user-b");
  expect(screen.queryByRole("heading", { name: "CS1332" })).toBeNull();
});

it("rejects duplicate classes without closing the form", () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "Add class" }));
  fireEvent.change(screen.getByLabelText("Class name"), { target: { value: " math3012 " } });
  fireEvent.click(screen.getByRole("button", { name: "Save class" }));
  expect(screen.getByRole("alert").textContent).toContain("already exists");
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("preserves unreadable saved data and reports the problem", () => {
  localStorage.setItem("orbitos:classes:v1:user-a", "broken");
  mount(); expect(screen.getByRole("alert").textContent).toContain("couldn’t be read");
  expect(localStorage.getItem("orbitos:classes:v1:user-a")).toBe("broken");
});

it("uses the existing class code as the single name and saves the simplified record", () => {
  localStorage.setItem("orbitos:classes:v1:user-a", JSON.stringify([{ id: "math3012", code: "MATH3012", name: "Combinatorics" }]));
  mount("math3012");
  fireEvent.click(screen.getByRole("button", { name: "Edit class" }));
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect((screen.getByLabelText("Class name") as HTMLInputElement).value).toBe("MATH3012");
  fireEvent.click(screen.getByRole("button", { name: "Save class" }));
  expect(JSON.parse(localStorage.getItem("orbitos:classes:v1:user-a")!)).toEqual([{ id: "math3012", name: "MATH3012" }]);
});

it("keeps the custom reader mounted when its toolbar changes", async () => {
  mount("math3012");
  fireEvent.change(screen.getByLabelText("Choose PDF"), { target: { files: [new File(["%PDF-1.4"], "Lecture.pdf", { type: "application/pdf" })] } });
  await waitFor(() => expect(screen.getByTestId("reader")).toBeTruthy());
  const reader = screen.getByTestId("reader");
  fireEvent.click(screen.getByRole("button", { name: "Show PDF toolbar" }));
  expect(screen.getByText("PDF toolbar")).toBeTruthy();
  expect(screen.getByTestId("reader")).toBe(reader);
  fireEvent.click(screen.getByRole("button", { name: "Hide PDF toolbar" }));
  expect(screen.queryByText("PDF toolbar")).toBeNull();
  expect(screen.getByTestId("reader")).toBe(reader);
});

it("handles unknown course links", () => {
  mount("missing"); expect(screen.getByRole("heading", { name: "Class not found" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "All classes" }).getAttribute("href")).toBe("/classes");
});

it("keeps assignment notes compact until a local PDF is chosen, including invalid-file recovery", async () => {
  render(<MemoryRouter><ClassesPage userId="user-a" courseId="math3012" assignmentService={{ list: async () => [], create: async (_u, _c, item) => item, update: async () => { throw new Error("Unused"); } }} /></MemoryRouter>);
  expect(screen.queryByRole("region", { name: "MATH3012 notes reader" })).toBeNull();
  expect(screen.getByRole("button", { name: "From device" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Choose PDF"), { target: { files: [new File(["text"], "Notes.txt", { type: "text/plain" })] } });
  expect(screen.getByRole("alert").textContent).toContain("Choose a PDF");
  fireEvent.change(screen.getByLabelText("Choose PDF"), { target: { files: [new File(["%PDF-1.4"], "Lecture.pdf", { type: "application/pdf" })] } });
  await waitFor(() => expect(screen.getByTestId("reader")).toBeTruthy());
  expect(screen.getByRole("region", { name: "MATH3012 notes reader" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
