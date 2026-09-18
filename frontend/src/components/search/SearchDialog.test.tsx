// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../../types/domain";
import { SearchDialog } from "./SearchDialog";
import { WorkspaceContext, type WorkspaceStore } from "../../apps/workspaceStore";

afterEach(cleanup);
const row = (id: string, title: string, totalCount = 1): SearchResult => ({
  recordId: id,
  recordType: "idea",
  parentId: null,
  title,
  snippet: `Notes for ${title}`,
  updatedAt: "2026-09-04",
  relevance: 1,
  totalCount,
});
const enter = (text: string) =>
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: text } });
const store = (revision: number): WorkspaceStore => ({
  profile: null,
  profileError: false,
  projects: [],
  classes: [],
  projectError: false,
  revision,
  invalidate: vi.fn(),
  retryProfile: vi.fn(),
  dialogs: { isOpen: () => false, register: () => () => undefined },
});
describe("Search dialog", () => {
  it("refreshes the same query after a saved record changes while preserving the query", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([row("id", "Old title")])
      .mockResolvedValueOnce([row("id", "Updated title")]);
    const props = { service: { search }, onClose: vi.fn(), onSelect: vi.fn() };
    const view = render(
      <WorkspaceContext.Provider value={store(0)}>
        <SearchDialog open {...props} />
      </WorkspaceContext.Provider>,
    );
    enter("title");
    await screen.findByText("Old title");
    view.rerender(
      <WorkspaceContext.Provider value={store(1)}>
        <SearchDialog open={false} {...props} />
      </WorkspaceContext.Provider>,
    );
    expect(search).toHaveBeenCalledTimes(1);
    view.rerender(
      <WorkspaceContext.Provider value={store(1)}>
        <SearchDialog open {...props} />
      </WorkspaceContext.Provider>,
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("title");
    await screen.findByText("Updated title");
    expect(screen.queryByText("Old title")).toBeNull();
    expect(search).toHaveBeenCalledTimes(2);
  });
  it("names every record kind and shows the class a result belongs to", async () => {
    const kinds: SearchResult[] = [
      { ...row("t1", "Buy milk"), recordType: "todo", snippet: "" },
      {
        ...row("a1", "Problem set 4"),
        recordType: "assignment",
        parentId: "MATH3012",
        snippet: "",
      },
      { ...row("i1", "Garden thought"), recordType: "idea", snippet: "" },
      { ...row("p1", "Kitchen"), recordType: "project", snippet: "" },
      { ...row("MATH3012", "Linear Algebra"), recordType: "class", snippet: "" },
      {
        ...row("n1", "Week 3 slides"),
        recordType: "class_note",
        parentId: "MATH3012",
        snippet: "",
      },
    ];
    const search = vi
      .fn()
      .mockResolvedValue(kinds.map((r) => ({ ...r, totalCount: kinds.length })));
    render(<SearchDialog open service={{ search }} onClose={vi.fn()} onSelect={vi.fn()} />);
    enter("a");
    await screen.findByText("Linear Algebra");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "taskBuy milk",
      "assignmentProblem set 4MATH3012",
      "ideaGarden thought",
      "projectKitchen",
      "classLinear Algebra",
      "noteWeek 3 slidesMATH3012",
    ]);
  });
  it("focuses search, traps Tab, closes with Escape, and restores the opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open search";
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const props = { service: { search: vi.fn() }, onClose, onSelect: vi.fn() };
    const view = render(<SearchDialog open {...props} />);
    const input = screen.getByRole("searchbox");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    view.rerender(<SearchDialog open={false} {...props} />);
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });
  it("debounces queries and ignores stale responses that arrive after a newer result", async () => {
    let finishOld!: (value: SearchResult[]) => void;
    const search = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<SearchResult[]>((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce([row("new", "Newest thought")]);
    render(<SearchDialog open service={{ search }} onClose={vi.fn()} onSelect={vi.fn()} />);
    enter("old");
    expect(search).not.toHaveBeenCalled();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    enter("new");
    await screen.findByText("Newest thought");
    await act(async () => finishOld([row("old", "Outdated thought")]));
    expect(screen.queryByText("Outdated thought")).toBeNull();
    expect(screen.getByText("Newest thought")).toBeTruthy();
  });
  it("opens the exact selected type and ID and waits for the parent to close", async () => {
    const result = row("precise-id", "A thought");
    const search = vi.fn().mockResolvedValue([result]);
    const onSelect = vi.fn().mockResolvedValue(undefined),
      onClose = vi.fn();
    render(<SearchDialog open service={{ search }} onClose={onClose} onSelect={onSelect} />);
    enter("thought");
    fireEvent.click(await screen.findByRole("button", { name: /A thought/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(result));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("appends the next 40-result page and retains its place across close and reopen", async () => {
    const first = Array.from({ length: 40 }, (_, i) => row(`id-${i}`, `Thought ${i}`, 41));
    const search = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([row("last", "Final thought", 41)]);
    const props = { service: { search }, onClose: vi.fn(), onSelect: vi.fn() };
    const view = render(<SearchDialog open {...props} />);
    enter("thought");
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByText("Final thought");
    expect(search).toHaveBeenLastCalledWith("thought", 40, expect.any(AbortSignal));
    expect(screen.getByText("Thought 0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    view.rerender(<SearchDialog open={false} {...props} />);
    view.rerender(<SearchDialog open {...props} />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("thought");
    expect(screen.getByText("Final thought")).toBeTruthy();
    expect(search).toHaveBeenCalledTimes(2);
  });
  it("keeps the failed query and previous results and recovers on retry", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([row("one", "Saved thought")])
      .mockRejectedValueOnce(new Error("secret upstream details"))
      .mockResolvedValueOnce([row("two", "Recovered thought")]);
    render(<SearchDialog open service={{ search }} onClose={vi.fn()} onSelect={vi.fn()} />);
    enter("saved");
    await screen.findByText("Saved thought");
    enter("recovered");
    await screen.findByRole("alert");
    expect(screen.getByText("Saved thought")).toBeTruthy();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("recovered");
    expect(screen.queryByText(/secret upstream/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry search" }));
    await screen.findByText("Recovered thought");
    expect(screen.queryByText("Saved thought")).toBeNull();
  });
  it("keeps the dialog open after a selection failure and exposes a safe message", async () => {
    const search = vi.fn().mockResolvedValue([row("id", "A thought")]);
    render(
      <SearchDialog
        open
        service={{ search }}
        onClose={vi.fn()}
        onSelect={vi.fn().mockRejectedValue(new Error("internal"))}
      />,
    );
    enter("thought");
    fireEvent.click(await screen.findByRole("button", { name: /A thought/ }));
    await screen.findByText("Couldn’t open this record. It may have changed. Try again.");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText("internal")).toBeNull();
  });
});
