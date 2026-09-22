// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectionPage } from "./CollectionPage";
import { ColdLoadGate } from "../../apps/coldLoad";
import type { CollectionService } from "./collectionService";
import type { TodoService } from "../todos/todoService";
import { WorkspaceContext, type WorkspaceStore } from "../../apps/workspaceStore";
import type { ProjectSummary } from "../../types/domain";
import { cacheNavigationService, NavigationCache } from "../../apps/navigationCache";
import {
  createMemoryWorkspacePreferencesStore,
  WorkspacePreferencesProvider,
} from "../../apps/workspacePreferences";
afterEach(cleanup);
type PageProps = Parameters<typeof CollectionPage>[0] & {
  projects?: readonly ProjectSummary[];
  onChanged?: () => void;
};
/** The page reads projects and the change signal from the workspace store. */
function Page({ projects = [], onChanged = vi.fn(), ...props }: PageProps) {
  const store: WorkspaceStore = {
    profile: null,
    profileError: false,
    projects,
    classes: [],
    projectError: false,
    revision: 0,
    invalidate: onChanged,
    retryProfile: vi.fn(),
    dialogs: { isOpen: () => false, register: () => () => undefined },
  };
  return (
    <WorkspaceContext.Provider value={store}>
      <CollectionPage {...props} />
    </WorkspaceContext.Provider>
  );
}
describe("Collection pages", () => {
  it("keeps Undo explicitly attached to deletion after a later record save", async () => {
    const project = {
      id: "p",
      title: "Home",
      description: "Make space",
      status: "active",
      createdAt: "",
      updatedAt: "",
    };
    const service = {
      listProjects: vi.fn().mockResolvedValue([project]),
      softDelete: vi.fn().mockResolvedValue("exact-token"),
      saveProject: vi.fn().mockResolvedValue(project),
    } as unknown as CollectionService;
    render(
      <Page
        kind="project"
        service={service}
        todoService={{} as TodoService}
        projects={[]}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete Home" }));
    await screen.findByRole("button", { name: "Undo deletion" });
    fireEvent.click(screen.getByRole("button", { name: /Home Make space/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Saved.")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo deletion" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
  it("hides an unavailable project badge without losing the idea and restores it with the project", async () => {
    const listIdeas = vi.fn().mockResolvedValue([
      {
        id: "idea",
        title: "Keep this thought",
        body: "Details",
        projectId: "project",
        createdAt: "",
        updatedAt: "",
      },
    ]);
    const service = { listIdeas } as unknown as CollectionService;
    const props = {
      kind: "idea" as const,
      service,
      todoService: {} as TodoService,
      onChanged: vi.fn(),
    };
    const view = render(<Page {...props} projects={[{ id: "project", title: "Garden" }]} />);
    await screen.findByText("Garden");
    view.rerender(<Page {...props} projects={[]} />);
    expect(screen.queryByText("Garden")).toBeNull();
    expect(screen.getByText("Keep this thought")).toBeTruthy();
    view.rerender(<Page {...props} projects={[{ id: "project", title: "Garden" }]} />);
    expect(screen.getByText("Garden")).toBeTruthy();
  });
  it("organizes ideas into project sections and leaves unassigned ideas at the end", async () => {
    const listIdeas = vi.fn().mockResolvedValue([
      {
        id: "unassigned",
        title: "A loose thought",
        body: "Keep it nearby.",
        projectId: null,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "studio-idea",
        title: "Move the lamp",
        body: "Try it beside the chair.",
        projectId: "studio",
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "garden-idea",
        title: "Plant thyme",
        body: "Along the sunny edge.",
        projectId: "garden",
        createdAt: "",
        updatedAt: "",
      },
    ]);
    render(
      <Page
        kind="idea"
        service={{ listIdeas } as unknown as CollectionService}
        todoService={{} as TodoService}
        projects={[
          { id: "studio", title: "Studio" },
          { id: "garden", title: "Garden" },
        ]}
        onOpenProject={vi.fn()}
      />,
    );

    const garden = await screen.findByRole("region", { name: "Garden" });
    const studio = screen.getByRole("region", { name: "Studio" });
    const unassigned = screen.getByRole("region", { name: "Unassigned" });
    expect(within(garden).getByText("Plant thyme")).toBeTruthy();
    expect(within(studio).getByText("Move the lamp")).toBeTruthy();
    expect(within(unassigned).getByText("A loose thought")).toBeTruthy();
    expect(
      screen
        .getAllByRole("region")
        .filter((region) => region.classList.contains("collection-idea-group"))
        .map((region) => within(region).getByRole("heading").textContent),
    ).toEqual(["Garden", "Studio", "Unassigned"]);
  });
  it("loads another 50-record page without dropping the first page or duplicating rows", async () => {
    const records = Array.from({ length: 51 }, (_, index) => ({
      id: `idea-${index}`,
      title: `Thought ${index}`,
      body: "Notes",
      projectId: null,
      createdAt: "",
      updatedAt: "",
    }));
    const listIdeas = vi.fn((options: { offset: number }) =>
      Promise.resolve(records.slice(options.offset, options.offset + 50)),
    );
    render(
      <Page
        kind="idea"
        service={{ listIdeas } as unknown as CollectionService}
        todoService={{} as TodoService}
        projects={[]}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await screen.findByText("Thought 50");
    expect(screen.getAllByRole("listitem")).toHaveLength(51);
    expect(screen.getAllByText("Thought 0")).toHaveLength(1);
    expect(listIdeas).toHaveBeenCalledWith(expect.objectContaining({ offset: 50 }));
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
  it("shows project tasks and ideas and deletes only the selected project with Undo", async () => {
    const project = {
      id: "p",
      title: "Home",
      description: "Make space",
      status: "active",
      createdAt: "",
      updatedAt: "",
    };
    const listProjects = vi.fn().mockResolvedValue([project]);
    const softDelete = vi.fn().mockResolvedValue("exact-token");
    const restore = vi.fn().mockResolvedValue(true);
    const onChanged = vi.fn();
    render(
      <Page
        kind="project"
        service={{ listProjects, softDelete, restore } as unknown as CollectionService}
        todoService={{} as TodoService}
        projects={[]}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete Home" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo deletion" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith("project", "p", "exact-token"));
    expect(softDelete).toHaveBeenCalledWith("project", "p");
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
  it("offers Undo for a task deleted from the project detail page", async () => {
    const getProject = vi
      .fn()
      .mockResolvedValue({ id: "p", title: "Home", description: null, status: "active" });
    const projectTodos = vi
      .fn()
      .mockResolvedValueOnce([{ id: "t", text: "Draft the plan", completed: false, dueDate: null }])
      .mockResolvedValue([]);
    const listIdeas = vi.fn().mockResolvedValue([]);
    const softDeleteTodo = vi.fn().mockResolvedValue("exact-token");
    const restoreTodo = vi.fn().mockResolvedValue(true);
    render(
      <Page
        kind="project"
        recordId="p"
        service={{ getProject, projectTodos, listIdeas } as unknown as CollectionService}
        todoService={{ softDeleteTodo, restoreTodo } as unknown as TodoService}
        projects={[{ id: "p", title: "Home" }]}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete Draft the plan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo deletion" }));
    await waitFor(() =>
      expect(restoreTodo).toHaveBeenCalledWith("t", "exact-token", expect.anything()),
    );
    expect(softDeleteTodo).toHaveBeenCalledWith("t", expect.anything());
  });
  it("offers Undo for an idea deleted from the project detail page", async () => {
    const getProject = vi
      .fn()
      .mockResolvedValue({ id: "p", title: "Home", description: null, status: "active" });
    const projectTodos = vi.fn().mockResolvedValue([]);
    const listIdeas = vi
      .fn()
      .mockResolvedValueOnce([{ id: "i", title: "Keep this", body: "Keep this", projectId: "p" }])
      .mockResolvedValue([]);
    const softDelete = vi.fn().mockResolvedValue("exact-token");
    const restore = vi.fn().mockResolvedValue(true);
    render(
      <Page
        kind="project"
        recordId="p"
        service={
          {
            getProject,
            projectTodos,
            listIdeas,
            softDelete,
            restore,
          } as unknown as CollectionService
        }
        todoService={{} as TodoService}
        projects={[{ id: "p", title: "Home" }]}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete Keep this" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo deletion" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith("idea", "i", "exact-token"));
    expect(softDelete).toHaveBeenCalledWith("idea", "i");
  });
  it("keeps the routine save notice off the project detail page", async () => {
    const getProject = vi
      .fn()
      .mockResolvedValue({ id: "p", title: "Home", description: null, status: "active" });
    const projectTodos = vi.fn().mockResolvedValue([]);
    const listIdeas = vi.fn().mockResolvedValue([]);
    const saveIdea = vi.fn().mockResolvedValue({ id: "i", title: "Keep this", projectId: "p" });
    render(
      <Page
        kind="project"
        recordId="p"
        service={{ getProject, projectTodos, listIdeas, saveIdea } as unknown as CollectionService}
        todoService={{} as TodoService}
        projects={[{ id: "p", title: "Home" }]}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Add idea" }));
    fireEvent.change(screen.getByLabelText("Idea"), { target: { value: "Keep this" } });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add idea" }));
    await waitFor(() => expect(saveIdea).toHaveBeenCalled());
    expect(screen.queryByText("Saved.")).toBeNull();
  });
  it("uses project context when creating an idea and presents completed tasks separately", async () => {
    const getProject = vi
      .fn()
      .mockResolvedValue({ id: "p", title: "Home", description: null, status: "active" });
    const projectTodos = vi
      .fn()
      .mockResolvedValue([{ id: "t", text: "Finished action", completed: true, dueDate: null }]);
    const listIdeas = vi
      .fn()
      .mockResolvedValue([{ id: "i", title: "Keep this", body: "Keep this", projectId: "p" }]);
    render(
      <Page
        kind="project"
        recordId="p"
        service={{ getProject, projectTodos, listIdeas } as unknown as CollectionService}
        todoService={{} as TodoService}
        projects={[{ id: "p", title: "Home" }]}
        onChanged={vi.fn()}
      />,
    );
    await screen.findByRole("button", { name: "Show completed (1)" });
    expect(screen.getByText("Keep this")).toBeTruthy();
    expect(
      screen.queryAllByText("Home").filter((el) => el.closest(".collection-meta")),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add idea" }));
    expect((screen.getByLabelText("Project (optional)") as HTMLSelectElement).value).toBe("p");
  });
  it("shows the description, omits project status, and reveals completed tasks on demand", async () => {
    const getProject = vi
      .fn()
      .mockResolvedValue({ id: "p", title: "Home", description: "Make space", status: "active" });
    const projectTodos = vi
      .fn()
      .mockResolvedValue([{ id: "t", text: "Finished action", completed: true, dueDate: null }]);
    const listIdeas = vi.fn().mockResolvedValue([]);
    render(
      <Page
        kind="project"
        recordId="p"
        service={{ getProject, projectTodos, listIdeas } as unknown as CollectionService}
        todoService={{} as TodoService}
        projects={[{ id: "p", title: "Home" }]}
        onChanged={vi.fn()}
      />,
    );
    await screen.findByText("Make space");
    expect(screen.queryByText("Active project")).toBeNull();
    expect(screen.queryByRole("button", { name: "Finished action" })).toBeNull();
    const toggle = await screen.findByRole("button", { name: "Show completed (1)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    screen.getByRole("button", { name: "Finished action" });
    expect(
      screen.getByRole("button", { name: "Hide completed (1)" }).getAttribute("aria-expanded"),
    ).toBe("true");
    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "Finished action" })).toBeNull();
  });
  it("settles the row with a strike before completing an open task", async () => {
    const getProject = vi
      .fn()
      .mockResolvedValue({ id: "p", title: "Home", description: null, status: "active" });
    const openTask = { id: "t", text: "Draft the plan", completed: false, dueDate: null };
    const completedTask = { id: "t", text: "Draft the plan", completed: true, dueDate: null };
    const projectTodos = vi
      .fn()
      .mockResolvedValueOnce([openTask])
      .mockResolvedValueOnce([completedTask]);
    const listIdeas = vi.fn().mockResolvedValue([]);
    let resolveCompleted: (() => void) | undefined;
    const setTodoCompleted = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCompleted = resolve;
        }),
    );
    render(
      <Page
        kind="project"
        recordId="p"
        service={{ getProject, projectTodos, listIdeas } as unknown as CollectionService}
        todoService={{ setTodoCompleted } as unknown as TodoService}
        projects={[{ id: "p", title: "Home" }]}
        onChanged={vi.fn()}
      />,
    );
    const checkbox = await screen.findByRole("checkbox", { name: "Complete Draft the plan" });
    vi.useFakeTimers();
    fireEvent.click(checkbox);
    expect(checkbox.closest(".collection-task")?.getAttribute("data-settling")).toBe("true");
    expect(setTodoCompleted).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(setTodoCompleted).toHaveBeenCalledWith("t", true, expect.anything());
    expect(checkbox.closest(".collection-task")?.getAttribute("data-settling")).toBe("true");
    vi.useRealTimers();
    await act(async () => {
      resolveCompleted?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(projectTodos).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      const reopened = screen.getByRole("checkbox", {
        name: "Reopen Draft the plan",
        hidden: true,
      });
      expect(reopened.closest(".collection-task")?.getAttribute("data-settling")).toBeNull();
    });
  });
  it("does not show a Loading status while project content is still visible after completing a task", async () => {
    const getProject = vi
      .fn()
      .mockResolvedValue({ id: "p", title: "Home", description: null, status: "active" });
    const openTask = { id: "t", text: "Draft the plan", completed: false, dueDate: null };
    const completedTask = { id: "t", text: "Draft the plan", completed: true, dueDate: null };
    const projectTodos = vi
      .fn()
      .mockResolvedValueOnce([openTask])
      .mockResolvedValueOnce([completedTask]);
    const listIdeas = vi.fn().mockResolvedValue([]);
    const setTodoCompleted = vi.fn().mockResolvedValue(undefined);
    render(
      <Page
        kind="project"
        recordId="p"
        service={{ getProject, projectTodos, listIdeas } as unknown as CollectionService}
        todoService={{ setTodoCompleted } as unknown as TodoService}
        projects={[{ id: "p", title: "Home" }]}
        onChanged={vi.fn()}
      />,
    );
    const checkbox = await screen.findByRole("checkbox", { name: "Complete Draft the plan" });
    vi.useFakeTimers();
    fireEvent.click(checkbox);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    vi.useRealTimers();
    expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
    await waitFor(() => expect(projectTodos).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });
  it("labels non-active projects and leaves the default list unfiltered", async () => {
    const records = ["active", "someday", "completed", "archived"].map((status, index) => ({
      id: `p-${index}`,
      title: `Project ${index}`,
      description: null,
      status,
    }));
    const listProjects = vi.fn().mockResolvedValue(records);
    render(
      <Page
        kind="project"
        service={{ listProjects } as unknown as CollectionService}
        todoService={{} as TodoService}
      />,
    );
    await screen.findByRole("button", { name: /^Project 3/ });
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    // The service drops archived rows itself, so the default call stays
    // byte-identical to the route prefetch's and shares its cache entry.
    expect(listProjects.mock.calls[0][0]).not.toHaveProperty("status");
    // "Active" is the ordinary state, so only the other three carry a badge.
    const list = screen.getByRole("list");
    expect(within(list).queryByText("Active")).toBeNull();
    for (const label of ["Someday", "Completed", "Archived"])
      expect(within(list).getByText(label)).toBeTruthy();
  });
  it("asks the service for one status when the filter changes", async () => {
    const listProjects = vi.fn().mockResolvedValue([]);
    render(
      <Page
        kind="project"
        service={{ listProjects } as unknown as CollectionService}
        todoService={{} as TodoService}
      />,
    );
    const filter = await screen.findByLabelText("Status");
    fireEvent.change(filter, { target: { value: "archived" } });
    await waitFor(() =>
      expect(listProjects).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 0, status: "archived" }),
      ),
    );
  });
  it("saves project details without a lingering Saved message", async () => {
    let project = { id: "p", title: "Home", description: null, status: "someday" };
    const service = {
      getProject: vi.fn(async () => project),
      projectTodos: vi.fn().mockResolvedValue([]),
      listIdeas: vi.fn().mockResolvedValue([]),
      saveProject: vi.fn(async (input) => (project = { ...project, ...input })),
    } as unknown as CollectionService;
    render(<Page kind="project" recordId="p" service={service} todoService={{} as TodoService} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit project" }));
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("someday");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Reading room" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { name: "Reading room" });
    expect(screen.queryByText("Saved.")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("renders project detail immediately from a warmed navigation cache with no Loading flash", async () => {
    const project = {
      id: "p",
      title: "Home",
      description: null,
      status: "active",
      createdAt: "",
      updatedAt: "",
    };
    const openTask = { id: "t", text: "Draft the plan", completed: false, dueDate: null };
    const source = {
      getProject: vi.fn().mockResolvedValue(project),
      projectTodos: vi.fn().mockResolvedValue([openTask]),
      listIdeas: vi.fn().mockResolvedValue([]),
    } as unknown as CollectionService;
    const cache = new NavigationCache();
    const service = cacheNavigationService(
      source,
      cache,
      "collection",
      ["getProject", "projectTodos", "listIdeas"],
      [],
    ) as unknown as CollectionService;
    // Warm the cache the way an earlier visit or a prefetch would.
    await service.getProject("p");
    await service.projectTodos("p", 0);
    await service.listIdeas({ projectId: "p", offset: 0 });
    render(
      <Page
        kind="project"
        recordId="p"
        service={service}
        todoService={{} as TodoService}
        projects={[{ id: "p", title: "Home" }]}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
    expect(screen.getByText("Draft the plan")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });
  it("renders the Tasks/Ideas section frame immediately on a cold detail open with no Loading row and no counts", async () => {
    let resolveProject: ((value: unknown) => void) | undefined;
    const getProject = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveProject = resolve;
        }),
    );
    const projectTodos = vi.fn().mockResolvedValue([]);
    const listIdeas = vi.fn().mockResolvedValue([]);
    render(
      <Page
        kind="project"
        recordId="p"
        service={{ getProject, projectTodos, listIdeas } as unknown as CollectionService}
        todoService={{} as TodoService}
        projects={[{ id: "p", title: "Home" }]}
        onChanged={vi.fn()}
      />,
    );
    // Cold detail: the numeric counts are withheld until real data lands.
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ideas" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Tasks \d/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Ideas \d/ })).toBeNull();
    const status = screen.getByText("Loading…");
    expect(status.className).toContain("cloud-shell__sr-only");
    expect(status.getAttribute("role")).toBe("status");
    expect(
      (screen.getByRole("button", { name: "Edit project" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      resolveProject?.({ id: "p", title: "Home", description: null, status: "active" });
      await Promise.resolve();
    });
    // Warm render: counts return once the detail has loaded.
    expect(screen.getByRole("heading", { name: "Tasks 0" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Ideas 0" })).toBeTruthy();
  });
  it("shows the workspace project title instead of Project while a cold detail load is in flight", async () => {
    let resolveProject: ((value: unknown) => void) | undefined;
    const getProject = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveProject = resolve;
        }),
    );
    const projectTodos = vi.fn().mockResolvedValue([]);
    const listIdeas = vi.fn().mockResolvedValue([]);
    render(
      <Page
        kind="project"
        recordId="p"
        service={{ getProject, projectTodos, listIdeas } as unknown as CollectionService}
        todoService={{} as TodoService}
        projects={[{ id: "p", title: "Home" }]}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Project" })).toBeNull();
    await act(async () => {
      resolveProject?.({ id: "p", title: "Home", description: null, status: "active" });
      await Promise.resolve();
    });
  });
  it("prefetches project detail reads after a short hover debounce", async () => {
    const project = {
      id: "p",
      title: "Home",
      description: null,
      status: "active",
      createdAt: "",
      updatedAt: "",
    };
    const listProjects = vi.fn().mockResolvedValue([project]);
    const getProject = vi.fn().mockResolvedValue(project);
    const projectTodos = vi.fn().mockResolvedValue([]);
    const listIdeas = vi.fn().mockResolvedValue([]);
    render(
      <Page
        kind="project"
        service={
          { listProjects, getProject, projectTodos, listIdeas } as unknown as CollectionService
        }
        todoService={{} as TodoService}
        projects={[]}
        onChanged={vi.fn()}
      />,
    );
    const openButton = await screen.findByRole("button", { name: "Home" });
    vi.useFakeTimers();
    fireEvent.pointerEnter(openButton);
    fireEvent.pointerEnter(openButton);
    fireEvent.pointerEnter(openButton);
    expect(getProject).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    vi.useRealTimers();
    expect(getProject).toHaveBeenCalledTimes(1);
    expect(getProject).toHaveBeenCalledWith("p");
    expect(projectTodos).toHaveBeenCalledWith("p", 0);
    expect(listIdeas).toHaveBeenCalledWith({ projectId: "p", offset: 0 });
  });
  it("cancels the hover prefetch when the pointer leaves before the debounce fires", async () => {
    const project = {
      id: "p",
      title: "Home",
      description: null,
      status: "active",
      createdAt: "",
      updatedAt: "",
    };
    const listProjects = vi.fn().mockResolvedValue([project]);
    const getProject = vi.fn().mockResolvedValue(project);
    const projectTodos = vi.fn().mockResolvedValue([]);
    const listIdeas = vi.fn().mockResolvedValue([]);
    render(
      <Page
        kind="project"
        service={
          { listProjects, getProject, projectTodos, listIdeas } as unknown as CollectionService
        }
        todoService={{} as TodoService}
        projects={[]}
        onChanged={vi.fn()}
      />,
    );
    const openButton = await screen.findByRole("button", { name: "Home" });
    vi.useFakeTimers();
    fireEvent.pointerEnter(openButton);
    fireEvent.pointerLeave(openButton);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    vi.useRealTimers();
    expect(getProject).not.toHaveBeenCalled();
  });
  it("clears settling when the task refetch fails, so the row does not stay struck", async () => {
    const getProject = vi
      .fn()
      .mockResolvedValue({ id: "p", title: "Home", description: null, status: "active" });
    const openTask = { id: "t", text: "Draft the plan", completed: false, dueDate: null };
    const projectTodos = vi
      .fn()
      .mockResolvedValueOnce([openTask])
      .mockRejectedValueOnce(new Error("network"));
    const listIdeas = vi.fn().mockResolvedValue([]);
    const setTodoCompleted = vi.fn().mockResolvedValue(undefined);
    render(
      <Page
        kind="project"
        recordId="p"
        service={{ getProject, projectTodos, listIdeas } as unknown as CollectionService}
        todoService={{ setTodoCompleted } as unknown as TodoService}
        projects={[{ id: "p", title: "Home" }]}
        onChanged={vi.fn()}
      />,
    );
    const checkbox = await screen.findByRole("checkbox", { name: "Complete Draft the plan" });
    vi.useFakeTimers();
    fireEvent.click(checkbox);
    expect(checkbox.closest(".collection-task")?.getAttribute("data-settling")).toBe("true");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    vi.useRealTimers();
    await waitFor(() => expect(projectTodos).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(checkbox.closest(".collection-task")?.getAttribute("data-settling")).toBeNull();
    });
  });
  it("holds the cold-load gate while the list loads and releases it once rows resolve", async () => {
    let resolveRows: ((value: unknown) => void) | undefined;
    const listProjects = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRows = resolve;
        }),
    );
    const { container } = render(
      <ColdLoadGate>
        <Page
          kind="project"
          service={{ listProjects } as unknown as CollectionService}
          todoService={{} as TodoService}
        />
      </ColdLoadGate>,
    );
    const gate = container.querySelector(".cold-load");
    expect(gate?.getAttribute("data-cold")).toBe("true");
    await act(async () => {
      resolveRows?.([]);
      await Promise.resolve();
    });
    await waitFor(() => expect(gate?.getAttribute("data-cold")).toBeNull());
  });
  it("releases the cold-load gate immediately when the list load fails", async () => {
    const listProjects = vi.fn().mockRejectedValue(new Error("boom"));
    const { container } = render(
      <ColdLoadGate>
        <Page
          kind="project"
          service={{ listProjects } as unknown as CollectionService}
          todoService={{} as TodoService}
        />
      </ColdLoadGate>,
    );
    const gate = container.querySelector(".cold-load");
    await waitFor(() => expect(gate?.getAttribute("data-cold")).toBeNull());
  });

  it("states the status filter as a row of words under Paper, and keeps the select in classic", async () => {
    const project = {
      id: "p",
      title: "Home",
      description: null,
      status: "someday",
      createdAt: "",
      updatedAt: "",
    };
    const listProjects = vi.fn().mockResolvedValue([project]);
    const props = {
      kind: "project" as const,
      service: { listProjects } as unknown as CollectionService,
      todoService: {} as TodoService,
    };

    render(
      <WorkspacePreferencesProvider
        store={createMemoryWorkspacePreferencesStore({ theme: "paper" })}
      >
        <Page {...props} />
      </WorkspacePreferencesProvider>,
    );
    await screen.findByText("Home");
    expect(screen.queryByRole("combobox")).toBeNull();
    const words = screen.getByRole("group", { name: "Status" });
    expect(
      within(words).getByRole("button", { name: "Current" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(within(words).getByRole("button", { name: "Archived" }));
    await waitFor(() =>
      expect(listProjects).toHaveBeenCalledWith(expect.objectContaining({ status: "archived" })),
    );
    // A row's actions are words in Paper, and the deletion keeps its own name.
    expect(screen.getByRole("button", { name: "Delete Home" }).textContent).toBe("delete");

    cleanup();
    render(
      <WorkspacePreferencesProvider
        store={createMemoryWorkspacePreferencesStore({ theme: "classic" })}
      >
        <Page {...props} />
      </WorkspacePreferencesProvider>,
    );
    await screen.findByText("Home");
    expect(screen.getByRole("combobox", { name: "Status" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Status" })).toBeNull();
  });
});
