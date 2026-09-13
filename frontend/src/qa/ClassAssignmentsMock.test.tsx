// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ClassAssignmentsMock } from "./ClassAssignmentsMock";
afterEach(cleanup);
function chooseType(label: string, type: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: type || "None" }));
}
it("opens the type list on the first click and applies choices directly without editing other fields", () => {
  render(<ClassAssignmentsMock />);
  const trigger = screen.getByRole("button", { name: "Edit type for Problem set 3" });
  fireEvent.click(trigger);
  expect(screen.getByRole("listbox", { name: "Assignment type" })).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("option", { name: "Homework" }));
  fireEvent.click(screen.getByRole("option", { name: "Quiz" }));
  expect(trigger.textContent).toBe("Quiz");
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole("listbox")).toBeNull();
  chooseType("Edit type for Problem set 3", "");
  expect(trigger.textContent).toBe("—");
});

it("supports keyboard navigation and dismissal without changing the saved type", () => {
  render(<ClassAssignmentsMock />);
  const trigger = screen.getByRole("button", { name: "Edit type for Problem set 3" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("option", { name: "Quiz" }));
  fireEvent.keyDown(document.activeElement!, { key: "r" });
  expect(document.activeElement).toBe(screen.getByRole("option", { name: "Reading" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(trigger.textContent).toBe("Homework");
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Assignments" }));
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(trigger.textContent).toBe("Homework");
});

it("closes the type list with Escape while retaining a new row's draft", () => {
  render(<ClassAssignmentsMock />);
  fireEvent.click(screen.getByRole("button", { name: "Add assignment" }));
  fireEvent.change(screen.getByLabelText("New assignment"), { target: { value: "Draft worksheet" } });
  fireEvent.click(screen.getByRole("button", { name: "New type" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect((screen.getByLabelText("New assignment") as HTMLInputElement).value).toBe("Draft worksheet");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "New type" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByLabelText("New assignment")).toBeNull();
});
it("discards an untouched blank row when leaving it without needing a cancel button", () => {
  render(<ClassAssignmentsMock />);
  fireEvent.click(screen.getByRole("button", { name: "Add assignment" }));
  fireEvent.blur(screen.getByLabelText("New assignment"));
  expect(screen.queryByLabelText("New assignment")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
it("shows plain cells and cancels or commits edits without changing completion", () => {
  render(<ClassAssignmentsMock />);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit title for Problem set 3" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Discard me" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Edit title for Problem set 3" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Updated assignment" } });
  fireEvent.blur(screen.getByRole("textbox"));
  expect(screen.getByRole("button", { name: "Edit title for Updated assignment" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Mark Updated assignment done" }));
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect((screen.getByRole("checkbox", { name: "Mark Updated assignment done" }) as HTMLInputElement).checked).toBe(false);
});
it("keeps the draft first until Enter saves and Escape discards a new row", () => {
  render(<ClassAssignmentsMock />);
  fireEvent.click(screen.getByRole("button", { name: "Add assignment" }));
  expect(within(screen.getAllByRole("row")[1]).getByLabelText("New assignment")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("New assignment"), { target: { value: "Read chapter 6" } });
  fireEvent.click(screen.getByLabelText("New due date"));
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  chooseType("New type", "Reading");
  fireEvent.keyDown(screen.getByLabelText("New assignment"), { key: "Enter" });
  expect(screen.getByRole("button", { name: "Edit title for Read chapter 6" })).toBeTruthy();
  expect(screen.queryByLabelText("New assignment")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add assignment" }));
  fireEvent.keyDown(screen.getByLabelText("New assignment"), { key: "Escape" });
  expect(screen.queryByLabelText("New assignment")).toBeNull();
});

it("validates a blank name, keeps the draft first through tabbing, and preserves focus when leaving the draft", () => {
  render(<ClassAssignmentsMock />);
  fireEvent.click(screen.getByRole("button", { name: "Add assignment" }));
  const name = screen.getByLabelText("New assignment");
  fireEvent.keyDown(name, { key: "Enter" });
  expect(screen.getByRole("alert").textContent).toBe("Name required");
  expect(document.activeElement).toBe(name);
  fireEvent.change(name, { target: { value: "New worksheet" } });
  fireEvent.keyDown(name, { key: "Tab" });
  expect(document.activeElement).toBe(screen.getByLabelText("New due date"));
  fireEvent.click(screen.getByLabelText("New due date"));
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  fireEvent.keyDown(screen.getByLabelText("New due date"), { key: "Tab" });
  expect(document.activeElement).toBe(screen.getByLabelText("New type"));
  expect(within(screen.getAllByRole("row")[1]).getByLabelText("New assignment")).toBeTruthy();
  chooseType("New type", "Homework");
  const next = screen.getByRole("checkbox", { name: "Mark Problem set 3 done" });
  act(() => next.focus());
  expect(document.activeElement).toBe(next);
  expect(screen.getByRole("button", { name: "Edit type for New worksheet" }).textContent).toBe("Homework");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByLabelText("New assignment")).toBeNull();
});

it("opens dates in one click, commits a choice immediately, and preserves focus after sorting", () => {
  render(<ClassAssignmentsMock />);
  fireEvent.click(screen.getByRole("button", { name: "Edit due for Problem set 4" }));
  expect(screen.getByRole("dialog", { name: "Choose assignment date" })).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
  const date = screen.getByRole("button", { name: "Edit due for Problem set 4" });
  expect(date.textContent).toBe("—");
  expect(document.activeElement).toBe(date);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(within(screen.getAllByRole("row")[4]).getByRole("button", { name: "Edit title for Problem set 4" })).toBeTruthy();
});

it("retains invalid edits and lets Escape restore the complete original row", () => {
  render(<ClassAssignmentsMock />);
  fireEvent.click(screen.getByRole("button", { name: "Edit title for Problem set 3" }));
  const name = screen.getByLabelText("Edit title for Problem set 3");
  fireEvent.change(name, { target: { value: "   " } });
  chooseType("Edit type for Problem set 3", "Exam");
  const other = screen.getByRole("button", { name: "Edit title for Problem set 4" });
  fireEvent.blur(name, { relatedTarget: other });
  fireEvent.click(other);
  expect(screen.getByRole("alert").textContent).toBe("Name required");
  expect((screen.getByLabelText("Edit title for Problem set 3") as HTMLInputElement).value).toBe("   ");
  fireEvent.keyDown(name, { key: "Escape" });
  expect(screen.getByRole("button", { name: "Edit type for Problem set 3" }).textContent).toBe("Homework");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit title for Problem set 3" }));
});
