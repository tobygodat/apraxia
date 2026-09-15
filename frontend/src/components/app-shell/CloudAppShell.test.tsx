// @vitest-environment happy-dom

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AuthIdentity } from "../../auth/authPort";
import type { SignOutStatus } from "../../auth/AuthProvider";
import { ColdLoadGate, useColdLoad } from "../../apps/coldLoad";
import { CloudAppShell } from "./CloudAppShell";
import {
  WorkspacePreferencesProvider,
  createMemoryWorkspacePreferencesStore,
} from "../../apps/workspacePreferences";

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
      "projects",
      "classes",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/todos",
      "/ideas",
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

  it("collapses the sidebar when the collapse toggle is clicked", () => {
    const store = createMemoryWorkspacePreferencesStore({ sidebarCollapsed: false });
    const { container } = render(
      <WorkspacePreferencesProvider store={store}>
        <MemoryRouter>
          <CloudAppShell
            identity={IDENTITY}
            signOutStatus="idle"
            onSignOut={vi.fn(async () => undefined)}
            onOpenGlobalAdd={vi.fn()}
          >
            <section>Cloud content</section>
          </CloudAppShell>
        </MemoryRouter>
      </WorkspacePreferencesProvider>,
    );

    const shell = container.querySelector(".cloud-shell");
    expect(shell?.getAttribute("data-sidebar-collapsed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(shell?.getAttribute("data-sidebar-collapsed")).toBe("true");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });
});

describe("CloudAppShell loading bar", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stays hidden before the delay, appears after, and hides once revealed", () => {
    // Force the gate's setTimeout(0) fallback for its deferred reveal check,
    // so it advances deterministically alongside the bar's own fake timers.
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    vi.useFakeTimers();
    let releasePending: (() => void) | undefined;
    function Gated() {
      const [pending, setPending] = useState(true);
      useColdLoad(pending);
      releasePending = () => setPending(false);
      return null;
    }
    const { container } = renderShell({
      children: (
        <ColdLoadGate>
          <Gated />
        </ColdLoadGate>
      ),
    });
    const bar = () => container.querySelector(".cloud-shell__loading-bar");

    expect(bar()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(bar()).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(bar()).toBeTruthy();

    act(() => {
      releasePending?.();
    });
    // Reveal is deferred to the next frame, so the bar is still up right away...
    expect(bar()).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(bar()).toBeNull();
  });

  it("never shows the bar for a gate that reveals before the delay elapses", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    vi.useFakeTimers();
    const { container } = renderShell({
      children: (
        <ColdLoadGate>
          <p>ready immediately</p>
        </ColdLoadGate>
      ),
    });

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(container.querySelector(".cloud-shell__loading-bar")).toBeNull();
  });

  it("keeps the bar visible after a timeout reveal while the gate is still pending", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    vi.useFakeTimers();
    function StuckGated() {
      useColdLoad(true);
      return null;
    }
    const { container } = renderShell({
      children: (
        <ColdLoadGate timeoutMs={500}>
          <StuckGated />
        </ColdLoadGate>
      ),
    });

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(container.querySelector(".cloud-shell__loading-bar")).toBeTruthy();

    act(() => {
      // Gate's timeout fires and reveals its content, but the child never
      // stops registering as pending (a genuinely stuck load).
      vi.advanceTimersByTime(500 - 150);
    });
    expect(container.querySelector(".cloud-shell__loading-bar")).toBeTruthy();
  });
});
