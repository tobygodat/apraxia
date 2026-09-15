// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionService } from "../features/collections/collectionService";
import type { CalendarService } from "../features/calendar/calendarService";
import type { TodoService } from "../features/todos/todoService";
import type { Idea, SearchResult, Todo } from "../types/domain";
import { MainWorkspace, type MainWorkspaceProps } from "./MainWorkspace";
import { cacheNavigationService, NavigationCache } from "./navigationCache";

afterEach(cleanup);
const todo: Todo = {
  id: "a6754c75-3acd-48d2-9539-5dc18299137c",
  text: "Book the appointment",
  completed: false,
  completedAt: null,
  dueDate: null,
  dueTime: null,
  projectId: null,
  todayRank: null,
  createdAt: "2026-09-04T12:00:00Z",
  updatedAt: "2026-09-04T12:00:00Z",
};
const idea: Idea = {
  id: "a0754c75-3acd-48d2-9539-5dc18299137c",
  title: "Garden thought",
  body: "Try herbs by the window",
  projectId: null,
  createdAt: "2026-09-04T12:00:00Z",
  updatedAt: "2026-09-04T12:00:00Z",
};
function fixture(userId = "user-a") {
  const createTodo = vi.fn().mockResolvedValue(todo);
  const listMedia = vi.fn().mockResolvedValue([]);
  const search = vi.fn().mockResolvedValue([]);
  const getTodo = vi.fn().mockResolvedValue(todo);
  const getIdea = vi.fn().mockResolvedValue(idea);
  const projects = vi.fn().mockResolvedValue([]);
  const props: MainWorkspaceProps = {
    identity: { userId, email: `${userId}@example.com`, expiresAt: null },
    signOutStatus: "idle",
    onSignOut: vi.fn().mockResolvedValue(undefined),
    todoService: { createTodo } as unknown as TodoService,
    collectionService: { listMedia, search, getTodo, getIdea } as unknown as CollectionService,
    calendarService: {} as CalendarService,
    workspaceData: {
      projects,
      profile: vi
        .fn()
        .mockResolvedValue({ userId, timezone: "America/New_York", createdAt: "", updatedAt: "" }),
    },
  };
  return { props, createTodo, listMedia, search, getTodo, getIdea, projects };
}
function RouteWitness() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}
function mount(props: MainWorkspaceProps) {
  return render(
    <MemoryRouter initialEntries={["/media"]}>
      <MainWorkspace {...props} />
      <RouteWitness />
    </MemoryRouter>,
  );
}
async function openSearch(query: string) {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  const input = await screen.findByRole("searchbox");
  fireEvent.change(input, { target: { value: query } });
}
describe("Main workspace integration", () => {
  it("reuses a preloaded collection while navigating away and back", async () => {
    const f = fixture();
    const listIdeas = vi.fn().mockResolvedValue([idea]);
    const service = cacheNavigationService(
      { ...f.props.collectionService, listIdeas },
      new NavigationCache(),
      "collections",
      ["listMedia", "listIdeas"],
      [],
    );
    await service.listMedia({
      status: "all",
      mediaType: "all",
      offset: 0,
      signal: new AbortController().signal,
    });
    mount({ ...f.props, collectionService: service });
    await screen.findByText("No books or movies in this view.");
    fireEvent.click(screen.getByRole("link", { name: "ideas" }));
    await screen.findByText("Garden thought");
    fireEvent.click(screen.getByRole("link", { name: "media" }));
    await screen.findByText("No books or movies in this view.");
    expect(f.listMedia).toHaveBeenCalledTimes(1);
    expect(listIdeas).toHaveBeenCalledTimes(1);
  });

  it("captures a Todo from Media, stays on Media, and refreshes visible data once", async () => {
    const f = fixture();
    mount(f.props);
    await screen.findByText("No books or movies in this view.");
    fireEvent.click(screen.getByRole("button", { name: "+ add" }));
    fireEvent.click(screen.getByRole("button", { name: "Task" }));
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: todo.text } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await screen.findByText("Task added");
    expect(screen.getByLabelText("Current route").textContent).toBe("/media");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(f.createTodo).toHaveBeenCalledTimes(1);
    expect(f.createTodo).toHaveBeenCalledWith(
      expect.objectContaining({ text: todo.text, dueDate: null }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await waitFor(() => expect(f.listMedia).toHaveBeenCalledTimes(2));
    expect(f.projects).toHaveBeenCalledTimes(2);
  });

  it.each(["todo", "idea"] as const)(
    "Ctrl+K opens the exact %s editor and returns to the same search",
    async (kind) => {
      const f = fixture();
      const result: SearchResult = {
        recordType: kind,
        recordId: kind === "todo" ? todo.id : idea.id,
        title: "Search match",
        snippet: "The selected record",
        updatedAt: "",
        relevance: 1,
        totalCount: 1,
      };
      f.search.mockResolvedValue([result]);
      mount(f.props);
      await openSearch("match");
      fireEvent.click(await screen.findByRole("button", { name: /Search match/ }));
      await screen.findByRole("dialog", { name: kind === "todo" ? "Edit task" : "Edit idea" });
      if (kind === "todo") {
        expect(f.getTodo).toHaveBeenCalledWith(todo.id);
        expect((screen.getByLabelText("Task") as HTMLInputElement).value).toBe(todo.text);
      } else {
        expect(f.getIdea).toHaveBeenCalledWith(idea.id);
        expect((screen.getByLabelText("Idea") as HTMLTextAreaElement).value).toBe(idea.body);
      }
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      const restored = await screen.findByRole("searchbox");
      expect((restored as HTMLInputElement).value).toBe("match");
      expect(screen.getByRole("button", { name: /Search match/ })).toBeTruthy();
      expect(f.search).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current route").textContent).toBe("/media");
    },
  );

  it("keeps Ctrl+K closed while the Add dialog is open", async () => {
    const f = fixture();
    mount(f.props);
    await screen.findByText("No books or movies in this view.");
    fireEvent.click(screen.getByRole("button", { name: "+ add" }));
    await screen.findByRole("dialog", { name: "Add to orbitOS" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await openSearch("");
    expect(screen.getByRole("searchbox")).toBeTruthy();
  });

  it("serves nested routes through the shell outlet with trailing-slash tolerance", async () => {
    const f = fixture();
    const collectionService = {
      ...f.props.collectionService,
      listIdeas: vi.fn().mockResolvedValue([]),
    } as unknown as CollectionService;
    render(
      <MemoryRouter initialEntries={["/ideas/"]}>
        <MainWorkspace {...f.props} collectionService={collectionService} />
        <RouteWitness />
      </MemoryRouter>,
    );
    await screen.findByText("No ideas yet. Keep your first thought here.");
    expect(screen.getByRole("link", { name: "ideas" }).className).toContain(
      "cloud-shell__nav-link--active",
    );
    expect(
      screen
        .getByRole("main")
        .contains(screen.getByText("No ideas yet. Keep your first thought here.")),
    ).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "media" }));
    await screen.findByText("No books or movies in this view.");
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("discards a pending selected record when the authenticated workspace unmounts", async () => {
    const first = fixture();
    let resolveIdea!: (value: Idea) => void;
    first.getIdea.mockImplementation(
      () =>
        new Promise<Idea>((resolve) => {
          resolveIdea = resolve;
        }),
    );
    first.search.mockResolvedValue([
      {
        recordType: "idea",
        recordId: idea.id,
        title: "Private idea",
        snippet: "",
        updatedAt: "",
        relevance: 1,
        totalCount: 1,
      },
    ]);
    const view = mount(first.props);
    await openSearch("private");
    fireEvent.click(await screen.findByRole("button", { name: /Private idea/ }));
    await waitFor(() => expect(first.getIdea).toHaveBeenCalledTimes(1));
    view.unmount();
    const next = fixture("user-b");
    mount(next.props);
    await act(async () => resolveIdea(idea));
    expect(screen.queryByRole("dialog")).toBeNull();
    await openSearch("");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("Private idea")).toBeNull();
    expect(screen.queryByText(idea.body)).toBeNull();
    expect(next.search).not.toHaveBeenCalled();
  });
});
