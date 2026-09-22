// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

it("saves the chosen theme preset, so Paper is reachable from classic", () => {
  const store = renderPage(createMemoryWorkspacePreferencesStore({ theme: "classic" }));
  const paper = screen.getByRole("radio", { name: "Paper" });
  expect((paper as HTMLInputElement).checked).toBe(false);
  fireEvent.click(paper);
  expect(store.read().theme).toBe("paper");
  expect(document.documentElement.getAttribute("data-theme")).toBe("paper");
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

it("falls back to Crisp for a theme this build does not know", () => {
  expect(normalizeWorkspacePreferences({ theme: "sepia", sidebarCollapsed: true })).toEqual({
    theme: "crisp",
    calendarEvents: "raised",
    sidebarCollapsed: true,
  });
});
