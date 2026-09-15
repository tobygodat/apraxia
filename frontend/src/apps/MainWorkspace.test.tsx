// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollectionService } from "../features/collections/collectionService";
import type { CalendarService } from "../features/calendar/calendarService";
import type { TodoService } from "../features/todos/todoService";
import type { Idea, SearchResult, Todo } from "../types/domain";
import { localToday } from "../features/todos/dateDomain";
import { startOfWeekSunday } from "../features/calendar/eventLayout";
import { MainWorkspace, type MainWorkspaceProps } from "./MainWorkspace";
import { cacheNavigationService, NavigationCache } from "./navigationCache";
import { WorkspaceRuntime } from "./WorkspaceRuntime";

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
  const listProjects = vi.fn().mockResolvedValue([]);
  const search = vi.fn().mockResolvedValue([]);
  const getTodo = vi.fn().mockResolvedValue(todo);
  const getIdea = vi.fn().mockResolvedValue(idea);
  const projects = vi.fn().mockResolvedValue([]);
  const props: MainWorkspaceProps = {
    identity: { userId, email: `${userId}@example.com`, expiresAt: null },
    signOutStatus: "idle",
    onSignOut: vi.fn().mockResolvedValue(undefined),
    todoService: { createTodo } as unknown as TodoService,
    collectionService: { listProjects, search, getTodo, getIdea } as unknown as CollectionService,
    calendarService: {} as CalendarService,
    workspaceData: {
      projects,
      profile: vi
        .fn()
        .mockResolvedValue({ userId, timezone: "America/New_York", createdAt: "", updatedAt: "" }),
    },
  };
  return { props, createTodo, listProjects, search, getTodo, getIdea, projects };
}
function RouteWitness() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}
function mount(props: MainWorkspaceProps) {
  return render(
    <MemoryRouter initialEntries={["/projects"]}>
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
  it("removes Media navigation, creation, and the old route", async () => {
    const f = fixture();
    render(
      <MemoryRouter initialEntries={["/media"]}>
        <MainWorkspace {...f.props} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /media/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ add" }));
    expect(await screen.findByRole("button", { name: "Idea" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Project" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Media" })).toBeNull();
  });

  it("reuses the runtime project preload when opening Projects and returning to it", async () => {
    const f = fixture();
    const listProjects = vi.fn().mockResolvedValue([
      {
        id: "garden-project",
        title: "Garden plans",
        description: "Make space for herbs",
        status: "someday",
        createdAt: "",
        updatedAt: "",
      },
    ]);
    render(
      <MemoryRouter initialEntries={["/ideas"]}>
        <WorkspaceRuntime
          {...f.props}
          todoService={{
            ...f.props.todoService,
            loadWorkspace: vi.fn().mockResolvedValue({}),
          }}
          collectionService={{
            ...f.props.collectionService,
            listProjects,
            listIdeas: vi.fn().mockResolvedValue([]),
          }}
        />
      </MemoryRouter>,
    );
    await screen.findByText("No ideas yet. Keep your first thought here.");
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("link", { name: "projects" }));
    await screen.findByText("Garden plans");
    fireEvent.click(screen.getByRole("link", { name: "ideas" }));
    await screen.findByText("No ideas yet. Keep your first thought here.");
    fireEvent.click(screen.getByRole("link", { name: "projects" }));
    await screen.findByText("Garden plans");
    expect(listProjects).toHaveBeenCalledTimes(1);
  });

  it("reuses a preloaded collection while navigating away and back", async () => {
    const f = fixture();
    const listIdeas = vi.fn().mockResolvedValue([idea]);
    const service = cacheNavigationService(
      { ...f.props.collectionService, listIdeas },
      new NavigationCache(),
      "collections",
      ["listProjects", "listIdeas"],
      [],
    );
    await service.listProjects({
      offset: 0,
      signal: new AbortController().signal,
    });
    mount({ ...f.props, collectionService: service });
    await screen.findByText("No projects in this view.");
    fireEvent.click(screen.getByRole("link", { name: "ideas" }));
    await screen.findByText("Garden thought");
    fireEvent.click(screen.getByRole("link", { name: "projects" }));
    await screen.findByText("No projects in this view.");
    expect(f.listProjects).toHaveBeenCalledTimes(1);
    expect(listIdeas).toHaveBeenCalledTimes(1);
  });

  it("captures a Todo from Projects, stays on Projects, and refreshes visible data once", async () => {
    const f = fixture();
    mount(f.props);
    await screen.findByText("No projects in this view.");
    fireEvent.click(screen.getByRole("button", { name: "+ add" }));
    fireEvent.click(screen.getByRole("button", { name: "Task" }));
    fireEvent.change(screen.getByLabelText("Task"), { target: { value: todo.text } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await screen.findByText("Task added");
    expect(screen.getByLabelText("Current route").textContent).toBe("/projects");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(f.createTodo).toHaveBeenCalledTimes(1);
    expect(f.createTodo).toHaveBeenCalledWith(
      expect.objectContaining({ text: todo.text, dueDate: null }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await waitFor(() => expect(f.listProjects).toHaveBeenCalledTimes(2));
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
      expect(screen.getByLabelText("Current route").textContent).toBe("/projects");
    },
  );

  it("keeps Ctrl+K closed while the Add dialog is open", async () => {
    const f = fixture();
    mount(f.props);
    await screen.findByText("No projects in this view.");
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
    fireEvent.click(screen.getByRole("link", { name: "projects" }));
    await screen.findByText("No projects in this view.");
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

  it("preloads appearance and Home's calendar/today reads once at startup from another route", async () => {
    const f = fixture();
    const load = vi.fn().mockResolvedValue({ title: "Studio", coverImage: null });
    const loadToday = vi.fn().mockResolvedValue([]);
    const status = vi.fn().mockResolvedValue({ connectionState: "connected" });
    const week = vi.fn().mockResolvedValue({
      range: { sunday: "2026-09-06" },
      timezone: "America/New_York",
      events: [],
      partialErrors: [],
      visibleCalendars: [],
    });
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <WorkspaceRuntime
          {...f.props}
          todoService={
            {
              ...f.props.todoService,
              loadToday,
              loadWorkspace: vi.fn().mockResolvedValue({}),
            } as unknown as TodoService
          }
          collectionService={
            {
              ...f.props.collectionService,
              listIdeas: vi.fn().mockResolvedValue([]),
            } as unknown as CollectionService
          }
          calendarService={{ status, week } as unknown as CalendarService}
          workspaceData={{ ...f.props.workspaceData, homeAppearance: { load, save: vi.fn() } }}
        />
      </MemoryRouter>,
    );
    await screen.findByText("No projects in this view.");
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledWith("user-a", expect.any(AbortSignal));
    const today = localToday("America/New_York");
    const sunday = startOfWeekSunday(today);
    await waitFor(() => expect(loadToday).toHaveBeenCalledTimes(1));
    expect(loadToday).toHaveBeenCalledWith(today, { signal: expect.any(AbortSignal) });
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(week).toHaveBeenCalledTimes(1));
    expect(week).toHaveBeenCalledWith(sunday, expect.any(AbortSignal));
  });

  it("prefetches each listed project's detail reads at startup", async () => {
    const f = fixture();
    const projectA = {
      id: "garden-project",
      title: "Garden plans",
      description: "Make space for herbs",
      status: "someday",
      createdAt: "",
      updatedAt: "",
    };
    const projectB = { ...projectA, id: "kitchen-project", title: "Kitchen remodel" };
    const listProjects = vi.fn().mockResolvedValue([projectA, projectB]);
    const getProject = vi.fn().mockResolvedValue(projectA);
    const projectTodos = vi.fn().mockResolvedValue([]);
    const listIdeas = vi.fn().mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <WorkspaceRuntime
          {...f.props}
          todoService={{
            ...f.props.todoService,
            loadWorkspace: vi.fn().mockResolvedValue({}),
          }}
          collectionService={{
            ...f.props.collectionService,
            listProjects,
            getProject,
            projectTodos,
            listIdeas,
          }}
        />
      </MemoryRouter>,
    );
    await screen.findByText("Garden plans");
    await waitFor(() => expect(getProject).toHaveBeenCalledTimes(2));
    expect(getProject).toHaveBeenCalledWith(projectA.id);
    expect(getProject).toHaveBeenCalledWith(projectB.id);
    expect(projectTodos).toHaveBeenCalledWith(projectA.id, 0);
    expect(projectTodos).toHaveBeenCalledWith(projectB.id, 0);
    expect(listIdeas).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: projectA.id, offset: 0 }),
    );
    expect(listIdeas).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: projectB.id, offset: 0 }),
    );
  });
});
