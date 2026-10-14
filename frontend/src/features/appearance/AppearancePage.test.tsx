// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  WorkspacePreferencesProvider,
  createMemoryWorkspacePreferencesStore,
  normalizeWorkspacePreferences,
} from "../../apps/workspacePreferences";
import { AppearancePage } from "./AppearancePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(store = createMemoryWorkspacePreferencesStore()) {
  render(
    <WorkspacePreferencesProvider store={store}>
      <AppearancePage />
    </WorkspacePreferencesProvider>,
  );
  return store;
}

it("offers Crisp, Crisp light and Match device, and saves the choice", () => {
  const store = renderPage();
  const themes = screen.getByRole("radiogroup", { name: "Theme" });
  expect(
    within(themes)
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("value")),
  ).toEqual(["crisp", "crisp-light", "device"]);
  fireEvent.click(screen.getByRole("radio", { name: "Crisp light" }));
  expect(store.read().theme).toBe("crisp-light");
  expect(document.documentElement.getAttribute("data-theme")).toBe("crisp-light");
});

it("paints Match device with the Crisp preset the device asks for", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-color-scheme: light)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const store = renderPage();
  fireEvent.click(screen.getByRole("radio", { name: "Match device" }));
  expect(store.read().theme).toBe("device");
  // `data-theme` only ever carries a real preset, so Crisp's selectors match.
  expect(document.documentElement.getAttribute("data-theme")).toBe("crisp-light");
});

it("saves the calendar event style and puts it where the week's sheet reads it", () => {
  const store = renderPage();
  expect(document.documentElement.getAttribute("data-calendar-events")).toBe("raised");
  fireEvent.click(screen.getByRole("radio", { name: "Tinted" }));
  expect(store.read().calendarEvents).toBe("tinted");
  expect(document.documentElement.getAttribute("data-calendar-events")).toBe("tinted");
});

it("collapses the sidebar from the page", () => {
  const store = renderPage();
  fireEvent.click(screen.getByRole("radio", { name: "Icons only" }));
  expect(store.read().sidebarCollapsed).toBe(true);
});

it.each(["classic", "paper", "paper-light"])("opens a stored %s choice in Crisp", (theme) => {
  expect(normalizeWorkspacePreferences({ theme }).theme).toBe("crisp");
});

it("falls back to Crisp for a theme this build does not know", () => {
  expect(normalizeWorkspacePreferences({ theme: "sepia", sidebarCollapsed: true })).toEqual({
    theme: "crisp",
    calendarEvents: "raised",
    sidebarCollapsed: true,
  });
});
