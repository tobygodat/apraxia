// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AssignmentDatePicker } from "./AssignmentDatePicker";

afterEach(cleanup);
function Example({ initial = "2026-09-13" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><AssignmentDatePicker label="Assignment date" value={value} onChange={setValue} /><button>Outside</button><output>{value}</output></>;
}
const trigger = () => screen.getByRole("button", { name: "Assignment date" });

it("shows month and day, opens the selected month in one click, and saves a date without a confirmation action", () => {
  render(<Example />);
  expect(trigger().textContent).toBe("Sep 13");
  fireEvent.click(trigger());
  expect(screen.getByText("Sep 2026")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Sunday, September 13, 2026" }));
  fireEvent.click(screen.getByRole("button", { name: "Wednesday, September 16, 2026" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger().textContent).toBe("Sep 16");
  expect(screen.getByRole("status").textContent).toBe("2026-09-16");
  expect(document.activeElement).toBe(trigger());
});

it("navigates across years and allows dates in the adjacent month", () => {
  render(<Example initial="2026-12-31" />);
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.getByText("Jan 2027")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  fireEvent.click(screen.getByRole("button", { name: "Friday, January 1, 2027" }));
  expect(trigger().textContent).toBe("Jan 1");
  expect(screen.getByRole("status").textContent).toBe("2027-01-01");
});

it("supports arrow navigation through leap day, Escape cancellation, and clearing the date", () => {
  render(<Example initial="2028-02-28" />);
  fireEvent.click(trigger());
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Tuesday, February 29, 2028" }));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Wednesday, March 1, 2028" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(trigger().textContent).toBe("Feb 28");
  expect(document.activeElement).toBe(trigger());
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
  expect(trigger().textContent).toBe("—");
});

it("dismisses on outside clicks without changing the date", () => {
  render(<Example />);
  fireEvent.click(trigger());
  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(trigger().textContent).toBe("Sep 13");
});
