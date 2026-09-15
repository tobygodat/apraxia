// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigationCache } from "./navigationCache";
import {
  FOCUS_REVALIDATE_TTL,
  useDialogPresence,
  useWorkspace,
  WorkspaceProvider,
} from "./workspaceStore";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const identity = { userId: "user-a", email: "a@example.com", expiresAt: null };
function Witness() {
  const { profile, projects, revision, dialogs } = useWorkspace();
  const [, tick] = useState(0);
  return (
    <>
      <output>{`${profile?.timezone ?? "-"}|${projects.map((p) => p.title).join(",")}|${revision}|${dialogs.isOpen()}`}</output>
      <button onClick={() => tick((v) => v + 1)}>Check</button>
    </>
  );
}
function Dialog() {
  useDialogPresence();
  return null;
}
function fixture() {
  const cache = new NavigationCache();
  const profile = vi.fn().mockResolvedValue({
    userId: "user-a",
    timezone: "America/New_York",
    createdAt: "",
    updatedAt: "",
  });
  const projects = vi.fn().mockResolvedValue([{ id: "p", title: "Garden" }]);
  return { cache, data: { profile, projects }, profile, projects };
}

describe("workspace store", () => {
  it("loads profile and projects once through the shared cache", async () => {
    const f = fixture();
    await f.cache.read("workspace:projects", () => f.data.projects());
    render(
      <WorkspaceProvider identity={identity} workspaceData={f.data} cache={f.cache}>
        <Witness />
      </WorkspaceProvider>,
    );
    await screen.findByText("America/New_York|Garden|0|false");
    expect(f.profile).toHaveBeenCalledTimes(1);
    expect(f.projects).toHaveBeenCalledTimes(1);
  });

  it("revalidates on window focus only after the cache is older than the TTL", async () => {
    vi.useFakeTimers();
    const f = fixture();
    render(
      <WorkspaceProvider identity={identity} workspaceData={f.data} cache={f.cache}>
        <Witness />
      </WorkspaceProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("status", { hidden: true }).textContent).toContain("|0|");
    fireEvent(window, new Event("focus"));
    expect(screen.getByRole("status", { hidden: true }).textContent).toContain("|0|");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FOCUS_REVALIDATE_TTL);
    });
    fireEvent(window, new Event("focus"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("status", { hidden: true }).textContent).toContain("|1|");
    expect(f.projects).toHaveBeenCalledTimes(2);
  });

  it("tracks open dialogs without a DOM query", async () => {
    const f = fixture();
    const view = render(
      <WorkspaceProvider identity={identity} workspaceData={f.data} cache={f.cache}>
        <Witness />
        <Dialog />
      </WorkspaceProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("status", { hidden: true }).textContent).toContain("|true"),
    );
    view.rerender(
      <WorkspaceProvider identity={identity} workspaceData={f.data} cache={f.cache}>
        <Witness />
      </WorkspaceProvider>,
    );
    // The flag is ref-backed; read it again on the next render.
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByRole("status", { hidden: true }).textContent).toContain("|false");
  });
});
