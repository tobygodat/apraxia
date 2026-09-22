// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "../../lib/serviceError";
import { createFixtureCareer } from "../../qa/careerFixture";
import { CareerPlanHandoff } from "./CareerPlanHandoff";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function setup() {
  const today = "2026-09-22";
  const service = createFixtureCareer({ scenario: "realistic", today });
  const signal = new AbortController().signal;
  const [application] = await service.listApplications("user-a", signal);
  const [items, steps] = await Promise.all([
    service.listPrep("user-a", application.id, signal),
    service.listSteps("user-a", application.id, signal),
  ]);
  const onImported = vi.fn();
  const originalImport = service.importPrep.bind(service);
  const importPrep = vi.spyOn(service, "importPrep");
  const loadProject = vi.fn(async (id: string) => ({
    id,
    title: "Capstone",
    description: "Measured cache latency on held-out traffic.",
    status: "active" as const,
    createdAt: "2026-09-22T00:00:00Z",
    updatedAt: "2026-09-22T00:00:00Z",
  }));
  render(
    <CareerPlanHandoff
      userId="user-a"
      application={application}
      steps={steps}
      items={items}
      today={today}
      service={service}
      onImported={onImported}
      projects={[{ id: "project-one", title: "Capstone" }]}
      loadProject={loadProject}
    />,
  );
  return {
    service,
    application,
    steps,
    items,
    onImported,
    importPrep,
    originalImport,
    loadProject,
  };
}

function review(source: string) {
  fireEvent.click(screen.getByRole("button", { name: "import a plan" }));
  fireEvent.change(screen.getByLabelText("paste a plan"), { target: { value: source } });
  fireEvent.click(screen.getByRole("button", { name: "review tasks" }));
}

describe("Career plan handoff", () => {
  it("reviews, edits, and selects actions before creating any tasks", async () => {
    const { importPrep, onImported } = await setup();
    review("- [ ] Draft project introduction\n- [ ] Review company values");
    expect(importPrep).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("task 1"), {
      target: { value: "Practice the project introduction" },
    });
    fireEvent.change(screen.getByLabelText("due date 1"), { target: { value: "2026-09-22" } });
    fireEvent.click(screen.getByLabelText("include task 2"));
    fireEvent.click(screen.getByRole("button", { name: "save 1 task" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(importPrep.mock.calls[0]?.[2]).toEqual([
      { id: expect.any(String), body: "Practice the project introduction", dueOn: "2026-09-22" },
    ]);
    expect(screen.getByRole("status").textContent).toContain("1 task saved");
    expect(screen.queryByRole("region", { name: "import preparation plan" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "import a plan" })),
    );
  });

  it("rejects invalid imported dates before the review or any writes", async () => {
    const { importPrep } = await setup();
    review('{"tasks":[{"text":"Practice","due_date":"2026-02-30"}]}');
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByLabelText("task 1")).toBeNull();
    expect(importPrep).not.toHaveBeenCalled();
  });

  it("keeps Unicode character limits consistent between parsing, review, and save", async () => {
    const { importPrep, onImported } = await setup();
    const body = "📝".repeat(1500);
    review(body);
    fireEvent.click(screen.getByRole("button", { name: "save 1 task" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(importPrep.mock.calls[0]?.[2][0]?.body).toBe(body);
  });

  it("leaves exact matches unselected and lets the user cancel without writes", async () => {
    const { items, importPrep } = await setup();
    const existing = items[0];
    review(JSON.stringify({ tasks: [{ text: existing.body, due_date: existing.dueOn }] }));
    expect((screen.getByLabelText("include task 1") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Matches an existing prep item/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "save 0 tasks" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(importPrep).not.toHaveBeenCalled();
  });

  it("retries a lost response using the original IDs without duplicating committed tasks", async () => {
    const { service, application, importPrep, originalImport, onImported } = await setup();
    importPrep.mockImplementationOnce(async (...args) => {
      await originalImport(...args);
      throw new Error("lost response");
    });
    review("Practice the architecture story");
    fireEvent.click(screen.getByRole("button", { name: "save 1 task" }));
    await screen.findByRole("alert");
    expect(onImported).not.toHaveBeenCalled();
    expect((screen.getByLabelText("task 1") as HTMLTextAreaElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    fireEvent.click(screen.getByRole("button", { name: "import a plan" }));
    fireEvent.click(screen.getByRole("button", { name: "try saving again" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(importPrep.mock.calls[1]?.[2]).toEqual(importPrep.mock.calls[0]?.[2]);
    const rows = await service.listPrep("user-a", application.id, new AbortController().signal);
    expect(rows.filter((row) => row.body === "Practice the architecture story")).toHaveLength(1);
  });

  it("unlocks the review after a definite rejection and saves under fresh IDs", async () => {
    const { importPrep, onImported } = await setup();
    importPrep.mockRejectedValueOnce(
      new ServiceError("conflict", "These tasks clash with saved ones. Save them again."),
    );
    review("Practice the architecture story");
    fireEvent.click(screen.getByRole("button", { name: "save 1 task" }));
    expect((await screen.findByRole("alert")).textContent).toContain("clash");
    expect((screen.getByLabelText("task 1") as HTMLTextAreaElement).readOnly).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "save 1 task" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(importPrep.mock.calls[1]?.[2][0]?.id).not.toBe(importPrep.mock.calls[0]?.[2][0]?.id);
  });

  it("shares only chosen stories and projects and keeps the brief editable", async () => {
    const { service, loadProject } = await setup();
    const stories = await service.listStories("user-a", new AbortController().signal);
    fireEvent.click(screen.getByRole("button", { name: "brief for AI" }));
    await screen.findByLabelText(stories[0].title);
    expect(loadProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "review brief" }));
    let brief = (await screen.findByLabelText("brief to share")) as HTMLTextAreaElement;
    expect(brief.value).not.toContain(JSON.stringify(stories[0].body));
    expect(brief.value).not.toContain("Measured cache latency");
    fireEvent.click(screen.getByRole("button", { name: "change context" }));
    fireEvent.click(screen.getByLabelText(stories[0].title));
    fireEvent.click(screen.getByLabelText("Capstone"));
    fireEvent.click(screen.getByRole("button", { name: "review brief" }));
    brief = (await screen.findByLabelText("brief to share")) as HTMLTextAreaElement;
    expect(loadProject).toHaveBeenCalledExactlyOnceWith("project-one");
    expect(brief.value).toContain(JSON.stringify(stories[0].body));
    expect(brief.value).toContain("Measured cache latency");
    fireEvent.change(brief, { target: { value: "My reviewed brief" } });
    expect(brief.value).toBe("My reviewed brief");
  });

  it("omits process and interview-step notes when process notes are deselected", async () => {
    const { application, steps } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "brief for AI" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "review brief" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByLabelText("process notes"));
    fireEvent.click(screen.getByRole("button", { name: "review brief" }));
    const brief = (await screen.findByLabelText("brief to share")) as HTMLTextAreaElement;
    expect(application.processNotes).toBeTruthy();
    expect(steps.some((step) => step.notes)).toBe(true);
    expect(brief.value).not.toContain(JSON.stringify(application.processNotes));
    for (const step of steps) {
      if (step.notes) expect(brief.value).not.toContain(JSON.stringify(step.notes));
      expect(brief.value).toContain(JSON.stringify(step.name));
    }
  });
});
