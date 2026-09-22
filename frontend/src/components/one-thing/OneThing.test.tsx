// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TodoService } from "../../features/todos/todoService";
import { OneThing, ONE_THING_EVENT } from "./OneThing";

afterEach(cleanup);

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

function serviceWith(texts: string[]) {
  const loadToday = vi.fn(async () => texts.map((text, index) => ({ id: String(index), text })));
  return { service: { loadToday } as unknown as TodoService, loadToday };
}

function press(keys: string[], target: Window | Element = window) {
  for (const key of keys) fireEvent.keyDown(target, { key });
}

it("opens on the Konami code with the day's first task, and only reads", async () => {
  const { service, loadToday } = serviceWith(["Return the library books", "Problem set 3"]);
  render(<OneThing service={service} />);
  expect(screen.queryByRole("dialog")).toBeNull();

  await act(async () => press(KONAMI));

  expect(await screen.findByRole("heading", { name: "Return the library books" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start two minutes" })).toBeTruthy();
  expect(loadToday).toHaveBeenCalledTimes(1);
});

it("ignores the sequence while you are typing in a field", async () => {
  const { service } = serviceWith(["Anything"]);
  render(
    <>
      <input aria-label="note" />
      <OneThing service={service} />
    </>,
  );
  await act(async () => press(KONAMI, screen.getByRole("textbox", { name: "note" })));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("opens from the mark's taps, says so when nothing is due, and closes on Escape", async () => {
  const { service } = serviceWith([]);
  render(<OneThing service={service} />);

  await act(async () => {
    window.dispatchEvent(new CustomEvent(ONE_THING_EVENT));
  });
  expect(await screen.findByRole("heading", { name: "Nothing is due today." })).toBeTruthy();

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("says when today's tasks fail to load, and tries again", async () => {
  const loadToday = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([{ id: "1", text: "Problem set 3" }]);
  render(<OneThing service={{ loadToday } as unknown as TodoService} />);

  await act(async () => press(KONAMI));
  expect(await screen.findByRole("heading", { name: "Today’s tasks didn’t load." })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Nothing is due today." })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Problem set 3" })).toBeTruthy();
  expect(loadToday).toHaveBeenCalledTimes(2);
});

it("takes focus while the task is still loading, and keeps Tab inside", async () => {
  const loadToday = vi.fn(() => new Promise(() => {}));
  render(
    <>
      <button type="button">Behind</button>
      <OneThing service={{ loadToday } as unknown as TodoService} />
    </>,
  );
  screen.getByRole("button", { name: "Behind" }).focus();

  await act(async () => press(KONAMI));
  const notNow = screen.getByRole("button", { name: "Not now" });
  expect(document.activeElement).toBe(notNow);

  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(notNow);
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(notNow);
});
