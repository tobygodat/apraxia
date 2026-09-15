// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceContext, type WorkspaceStore } from "../../apps/workspaceStore";
import { Dialog } from "./Dialog";

afterEach(() => cleanup());

function Harness({
  open = true,
  closeLocked = false,
  onClose = vi.fn(),
  autofocus = false,
}: {
  open?: boolean;
  closeLocked?: boolean;
  onClose?: () => void;
  autofocus?: boolean;
}) {
  return (
    <>
      <button type="button">Opener</button>
      <Dialog open={open} onClose={onClose} closeLocked={closeLocked} label="Sample">
        <input aria-label="First" />
        <input aria-label="Second" data-autofocus={autofocus || undefined} />
        <button type="button">Last</button>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("renders a labelled modal, focuses the first control, and cycles Tab both ways", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "Sample" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("First"));
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("First"));
  });

  it("prefers a data-autofocus control for initial focus", () => {
    render(<Harness autofocus />);
    expect(document.activeElement).toBe(screen.getByLabelText("Second"));
  });

  it("closes on Escape unless closing is locked", () => {
    const onClose = vi.fn();
    const view = render(<Harness onClose={onClose} closeLocked />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(<Harness onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the opener when it closes and locks page scroll while open", () => {
    const view = render(<Harness open={false} />);
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    view.rerender(<Harness open />);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(screen.getByLabelText("First"));
    view.rerender(<Harness open={false} />);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
  });

  it("counts itself in the workspace dialog presence while open", () => {
    const register = vi.fn(() => vi.fn());
    const store = {
      profile: null,
      profileError: false,
      projects: [],
      projectError: false,
      revision: 0,
      invalidate: vi.fn(),
      retryProfile: vi.fn(),
      dialogs: { isOpen: () => false, register },
    } satisfies WorkspaceStore;
    const view = render(
      <WorkspaceContext.Provider value={store}>
        <Harness />
      </WorkspaceContext.Provider>,
    );
    expect(register).toHaveBeenCalledTimes(1);
    const release = register.mock.results[0]!.value as ReturnType<typeof vi.fn>;
    view.rerender(
      <WorkspaceContext.Provider value={store}>
        <Harness open={false} />
      </WorkspaceContext.Provider>,
    );
    expect(release).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
