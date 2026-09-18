// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColdLoadGate } from "../../apps/coldLoad";
import type { DeleteUndoToken, Profile, Todo } from "../../types/domain";
import type { TodoService, TodoWorkspaceSnapshot } from "../todos/todoService";
import { WeeklyReviewPage } from "./WeeklyReviewPage";

const PROFILE: Profile = {
  userId: "11111111-1111-4111-8111-111111111111",
  timezone: "America/New_York",
  createdAt: "2026-09-01T12:00:00.000000Z",
  updatedAt: "2026-09-01T12:00:00.000000Z",
};
const BASE: Todo = {
  id: "22222222-2222-4222-8222-000000000000",
  text: "Base task",
  completed: false,
  completedAt: null,
  dueDate: null,
  dueTime: null,
  projectId: null,
  todayRank: null,
  createdAt: "2026-09-01T14:00:00.000000Z",
  updatedAt: "2026-09-01T14:00:00.000000Z",
};

function todo(overrides: Partial<Todo> & Pick<Todo, "id" | "text">): Todo {
  return { ...BASE, ...overrides };
}

const FINISHED = todo({
  id: "22222222-2222-4222-8222-000000000001",
  text: "Choose a paint sample",
  completed: true,
  completedAt: "2026-09-16T18:00:00.000000Z",
  projectId: "33333333-3333-4333-8333-000000000001",
});
const SLIPPED = todo({
  id: "22222222-2222-4222-8222-000000000002",
  text: "Return the library books",
  dueDate: "2026-09-11",
  classId: "class-a",
  className: "MATH3012",
});
const NEXT = todo({
  id: "22222222-2222-4222-8222-000000000003",
  text: "Measure the shelves",
  dueDate: "2026-09-24",
  dueTime: "17:00:00",
});

const SNAPSHOT: TodoWorkspaceSnapshot = {
  profile: PROFILE,
  projects: [{ id: "33333333-3333-4333-8333-000000000001", title: "Studio refresh" }],
  classes: [{ id: "class-a", name: "MATH3012" }],
  todos: [FINISHED, SLIPPED, NEXT],
};

function createService(overrides: Partial<TodoService> = {}): TodoService {
  return {
    loadWorkspace: vi.fn(async () => SNAPSHOT),
    createTodo: vi.fn(async () => BASE),
    updateTodoDetails: vi.fn(async () => BASE),
    setTodoCompleted: vi.fn(async () => ({ todo: BASE, spawned: null, withdrawn: null })),
    softDeleteTodo: vi.fn(async () => "2026-09-03T19:00:00.123456Z" as DeleteUndoToken),
    restoreTodo: vi.fn(async () => true),
    loadToday: vi.fn(async () => []),
    reorderToday: vi.fn(async () => []),
    ...overrides,
  };
}

function renderPage(service: TodoService = createService()) {
  return render(
    <MemoryRouter>
      <ColdLoadGate>
        <WeeklyReviewPage
          service={service}
          profile={PROFILE}
          workspaceSessionKey={PROFILE.userId}
        />
      </ColdLoadGate>
    </MemoryRouter>,
  );
}

function band(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

describe("WeeklyReviewPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Thursday 2026-09-17, 10:00 in New York: the week runs Sep 14 to Sep 20.
    vi.setSystemTime(new Date("2026-09-17T14:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("announces the page while the workspace is still loading", () => {
    renderPage(
      createService({ loadWorkspace: vi.fn(() => new Promise<TodoWorkspaceSnapshot>(() => {})) }),
    );
    expect(screen.getByRole("status").textContent).toContain("Loading your week");
  });

  it("offers a retry when the workspace could not be loaded", async () => {
    const loadWorkspace = vi.fn(async () => {
      throw new Error("offline");
    });
    renderPage(createService({ loadWorkspace }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Tasks could not be loaded. Try again.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(2));
  });

  it("shows the reviewed week and marks it as the current one", async () => {
    renderPage();
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Weekly review");
    expect(screen.getByText("Sep 14 – Sep 20 · This week")).toBeTruthy();
  });

  it("sorts each task into its section, grouped by project and class", async () => {
    renderPage();
    const finished = await waitFor(() => band("Finished"));
    expect(within(finished).getByRole("heading", { level: 3 }).textContent).toContain(
      "Studio refresh",
    );
    expect(within(finished).getByText("Choose a paint sample")).toBeTruthy();

    const slipped = band("Slipped");
    expect(within(slipped).getByRole("link", { name: "MATH3012" }).getAttribute("href")).toBe(
      "/classes/class-a",
    );
    expect(within(slipped).getByText("Return the library books")).toBeTruthy();
    expect(within(slipped).getByText("6 days late")).toBeTruthy();

    const next = band("Next");
    expect(within(next).getByText("Measure the shelves")).toBeTruthy();
    expect(within(next).getByText("5:00 PM")).toBeTruthy();
  });

  it("keeps ruling an empty section with copy instead of leaving it blank", async () => {
    renderPage(
      createService({ loadWorkspace: vi.fn(async () => ({ ...SNAPSHOT, todos: [SLIPPED] })) }),
    );
    const finished = await waitFor(() => band("Finished"));
    expect(within(finished).getByText("Nothing was finished in this week.")).toBeTruthy();
    expect(within(finished).queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("links the standing's tallies to their bands", async () => {
    renderPage();
    const standing = await waitFor(() =>
      screen.getByRole("navigation", { name: "Review sections" }),
    );
    const finished = within(standing).getByRole("link", { name: /Finished/ });
    expect(finished.getAttribute("href")).toBe("#weekly-review-finished-band");
    expect(finished.textContent).toContain("1");
  });

  it("steps back a week and returns, and never offers a week that has not happened", async () => {
    renderPage();
    const nav = await waitFor(() =>
      screen.getByRole("navigation", { name: "Review week navigation" }),
    );
    expect(within(nav).getByRole<HTMLButtonElement>("button", { name: "Next week" }).disabled).toBe(
      true,
    );
    expect(within(nav).getByRole<HTMLButtonElement>("button", { name: "This week" }).disabled).toBe(
      true,
    );

    fireEvent.click(within(nav).getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(screen.getByText("Sep 7 – Sep 13")).toBeTruthy());
    // The Sep 16 completion belongs to the week just left, not this one.
    expect(within(band("Finished")).getByText("Nothing was finished in this week.")).toBeTruthy();
    expect(within(nav).getByRole<HTMLButtonElement>("button", { name: "Next week" }).disabled).toBe(
      false,
    );

    fireEvent.click(within(nav).getByRole("button", { name: "This week" }));
    await waitFor(() => expect(screen.getByText("Sep 14 – Sep 20 · This week")).toBeTruthy());
  });
});
