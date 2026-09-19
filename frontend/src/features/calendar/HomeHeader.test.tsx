// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HomeHeader } from "./HomeHeader";
import { validateAppearance, type HomeAppearanceService } from "./homeAppearance";
import { cacheNavigationService, NavigationCache } from "../../apps/navigationCache";
afterEach(cleanup);

it("saves the page name, preserving the draft after failure", async () => {
  const service: HomeAppearanceService = {
    load: vi.fn(async () => ({ title: "Studio" })),
    save: vi
      .fn()
      .mockRejectedValueOnce(new Error("Couldn’t save. Try again."))
      .mockImplementation(async (_user, value) => value),
  };
  render(<HomeHeader userId="owner" service={service} />);
  await screen.findByRole("heading", { name: "Studio" });
  fireEvent.click(screen.getByRole("button", { name: "Customize page" }));
  fireEvent.change(screen.getByLabelText("Page name"), { target: { value: "A quieter place" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("Page name") as HTMLInputElement).value).toBe("A quieter place");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("heading", { name: "A quieter place" });
  expect(service.save).toHaveBeenLastCalledWith(
    "owner",
    { title: "A quieter place" },
    expect.any(AbortSignal),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("offers the page name alone: there is no cover to upload or position", async () => {
  const service: HomeAppearanceService = {
    load: vi.fn(async () => ({ title: "Studio" })),
    save: vi.fn(),
  };
  render(<HomeHeader userId="owner" service={service} />);
  await screen.findByRole("heading", { name: "Studio" });
  fireEvent.click(screen.getByRole("button", { name: "Customize page" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.querySelectorAll("input")).toHaveLength(1);
  expect(screen.queryByLabelText("Cover image")).toBeNull();
  expect(screen.queryByRole("button", { name: /cover/i })).toBeNull();
});
it("renders the page name on first paint from a warmed navigation cache", async () => {
  const load = vi.fn(async () => ({ title: "Studio" }));
  const source: HomeAppearanceService = { load, save: vi.fn() };
  const cache = new NavigationCache();
  const service = cacheNavigationService(
    source,
    cache,
    "homeAppearance",
    ["load"],
    ["save"],
  ) as unknown as HomeAppearanceService;
  // Warm the cache the way an earlier navigation to Home would.
  await service.load("owner", new AbortController().signal);
  render(<HomeHeader userId="owner" service={service} />);
  expect(screen.getByRole("heading", { name: "Studio" })).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Customize page" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
it("discards late account loads and keeps personalization failure separate from the workspace", async () => {
  let resolve!: (value: { title: string }) => void;
  const service: HomeAppearanceService = {
    load: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockRejectedValueOnce(new Error("private provider response")),
    save: vi.fn(),
  };
  const { rerender } = render(<HomeHeader userId="first" service={service} />);
  rerender(<HomeHeader userId="second" service={service} />);
  await screen.findByRole("button", { name: "Try again" });
  await act(async () => resolve({ title: "First account title" }));
  expect(screen.queryByText("First account title")).toBeNull();
  expect(document.body.textContent).not.toContain("private provider response");
  expect(
    (screen.getByRole("button", { name: "Customize page" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("rejects an excessive page name and trims the one it keeps", () => {
  expect(() => validateAppearance({ title: "a".repeat(101) })).toThrow();
  expect(validateAppearance({ title: "  Studio  " })).toEqual({ title: "Studio" });
});
it("prints the given local date beside the page name, and nothing without one", async () => {
  const service: HomeAppearanceService = {
    load: vi.fn(async () => ({ title: "Studio" })),
    save: vi.fn(),
  };
  const { rerender } = render(<HomeHeader userId="owner" service={service} date="2026-09-18" />);
  await screen.findByRole("heading", { name: "Studio" });
  // The plain calendar date is read as written: no timezone conversion.
  expect(screen.getByText("Friday, September 18")).toBeTruthy();
  rerender(<HomeHeader userId="owner" service={service} />);
  await waitFor(() => expect(screen.queryByText("Friday, September 18")).toBeNull());
});
