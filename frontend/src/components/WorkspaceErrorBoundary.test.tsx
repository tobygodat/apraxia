// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceErrorBoundary } from "./WorkspaceErrorBoundary";

function Boom(): never {
  throw new Error("render failed");
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs the caught error itself; the boundary adds its own line.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  cleanup();
});

describe("WorkspaceErrorBoundary", () => {
  it("shows the shared error card with a reload control instead of a blank page", () => {
    render(
      <WorkspaceErrorBoundary>
        <Boom />
      </WorkspaceErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something went wrong on this page.");
    expect(alert.closest(".workspace-error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it("keeps rendering its children when nothing throws", () => {
    render(
      <WorkspaceErrorBoundary>
        <p>Tasks</p>
      </WorkspaceErrorBoundary>,
    );

    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears a caught error when the reset key changes", () => {
    const view = render(
      <WorkspaceErrorBoundary resetKey="/todos">
        <Boom />
      </WorkspaceErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();

    view.rerender(
      <WorkspaceErrorBoundary resetKey="/projects">
        <p>Projects</p>
      </WorkspaceErrorBoundary>,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Projects")).toBeTruthy();
  });
});
