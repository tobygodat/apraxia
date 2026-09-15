// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AuthIdentity } from "../../auth/authPort";
import type { SignOutStatus } from "../../auth/AuthProvider";
import { CloudAppShell } from "./CloudAppShell";

const IDENTITY: AuthIdentity = {
  userId: "private-user-id-never-rendered",
  email: "toby@example.com",
  expiresAt: 1_800_000_000,
};

afterEach(() => {
  cleanup();
});

function renderShell({
  route = "/",
  signOutStatus = "idle",
  onSignOut = vi.fn(async () => undefined),
  onOpenGlobalAdd = vi.fn(),
  children = <section>Cloud content</section>,
}: {
  route?: string;
  signOutStatus?: SignOutStatus;
  onSignOut?: () => Promise<void>;
  onOpenGlobalAdd?: () => void;
  children?: React.ReactNode;
} = {}) {
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <CloudAppShell
        identity={IDENTITY}
        signOutStatus={signOutStatus}
        onSignOut={onSignOut}
        onOpenGlobalAdd={onOpenGlobalAdd}
      >
        {children}
      </CloudAppShell>
    </MemoryRouter>,
  );

  return { ...result, onSignOut, onOpenGlobalAdd };
}

describe("CloudAppShell", () => {
  it("renders the primary destinations and marks the active route", () => {
    renderShell({ route: "/ideas" });

    const primaryNavigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    const links = within(primaryNavigation).getAllByRole("link");

    expect(links.map((link) => link.textContent)).toEqual([
      "home",
      "tasks",
      "ideas",
      "media",
      "projects",
      "classes",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/todos",
      "/ideas",
      "/media",
      "/projects",
      "/classes",
    ]);
    expect(
      within(primaryNavigation).getByRole("link", { name: "ideas" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(within(primaryNavigation).queryByRole("link", { name: /settings/i })).toBeNull();
  });

  it("keeps the global Add control available and invokes its callback", () => {
    const onOpenGlobalAdd = vi.fn();
    renderShell({ onOpenGlobalAdd });

    fireEvent.click(screen.getByRole("button", { name: /\+ add/i }));

    expect(onOpenGlobalAdd).toHaveBeenCalledTimes(1);
  });

  it("shows Settings and only the sanitized email inside the account popover", async () => {
    const { container } = renderShell();

    expect(screen.queryByRole("link", { name: /settings/i })).toBeNull();
    const trigger = screen.getByRole("button", { name: /account/i });
    fireEvent.click(trigger);

    const popover = screen.getByRole("group", { name: "Account options" });
    expect(within(popover).getByText("toby@example.com")).toBeTruthy();
    expect(within(popover).getByRole("link", { name: "settings" }).getAttribute("href")).toBe(
      "/settings",
    );
    expect(container.textContent).not.toContain(IDENTITY.userId);
    expect(container.textContent).not.toContain(String(IDENTITY.expiresAt));

    await waitFor(() => {
      expect(document.activeElement).toBe(within(popover).getByRole("link", { name: "settings" }));
    });
  });

  it("closes the account menu on Escape and returns focus to its trigger", async () => {
    renderShell();
    const trigger = screen.getByRole("button", { name: /account/i });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole("group", { name: "Account options" })).toBeTruthy(),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("group", { name: "Account options" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes without trapping focus when focus or a pointer moves outside", () => {
    renderShell({ children: <button type="button">Outside control</button> });
    const trigger = screen.getByRole("button", { name: /account/i });
    const outside = screen.getByRole("button", { name: "Outside control" });

    fireEvent.click(trigger);
    outside.focus();
    fireEvent.focusIn(outside);
    expect(screen.queryByRole("group", { name: "Account options" })).toBeNull();
    expect(document.activeElement).toBe(outside);

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("group", { name: "Account options" })).toBeNull();
  });

  it("disables sign-out while pending and announces a safe failure state", () => {
    const { rerender } = render(
      <MemoryRouter>
        <CloudAppShell
          identity={IDENTITY}
          signOutStatus="pending"
          onSignOut={vi.fn(async () => undefined)}
          onOpenGlobalAdd={vi.fn()}
        >
          <section>Private workspace</section>
        </CloudAppShell>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /account/i }));
    const pendingButton = screen.getByRole("button", { name: "Signing out…" });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("closing this private workspace");

    rerender(
      <MemoryRouter>
        <CloudAppShell
          identity={IDENTITY}
          signOutStatus="error"
          onSignOut={vi.fn(async () => undefined)}
          onOpenGlobalAdd={vi.fn()}
        >
          <section>Private workspace</section>
        </CloudAppShell>
      </MemoryRouter>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("workspace remains open");
    expect(screen.getByText("Private workspace")).toBeTruthy();
  });

  it("handles rejected sign-out requests without exposing raw errors", async () => {
    const onSignOut = vi.fn(async () => {
      throw new Error("provider-token-secret");
    });
    const { container } = renderShell({ onSignOut });
    fireEvent.click(screen.getByRole("button", { name: /account/i }));

    fireEvent.click(screen.getByRole("button", { name: "sign out" }));

    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
    expect(container.textContent).not.toContain("provider-token-secret");
  });

  it("renders nested route content through a real Outlet when children are omitted", () => {
    render(
      <MemoryRouter initialEntries={["/todos"]}>
        <Routes>
          <Route
            element={
              <CloudAppShell
                identity={IDENTITY}
                signOutStatus="idle"
                onSignOut={vi.fn(async () => undefined)}
                onOpenGlobalAdd={vi.fn()}
              />
            }
          >
            <Route path="todos" element={<h1>Nested todos</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Nested todos" })).toBeTruthy();
  });

  it("offers a skip link wired to the semantic main content region", () => {
    renderShell();

    expect(screen.getByRole("link", { name: "Skip to main content" }).getAttribute("href")).toBe(
      "#cloud-main-content",
    );
    const main = screen.getByRole("main");
    expect(main.id).toBe("cloud-main-content");
    expect(main.textContent).toContain("Cloud content");
  });
});
