// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CareerPage } from "./CareerPage";
import type { CareerApplicationRow, CareerService } from "./careerService";

afterEach(cleanup);

const TODAY = "2026-09-19";

function row(values: Partial<CareerApplicationRow> & { id: string; company: string }) {
  return {
    role: "software engineer intern",
    appliedOn: null,
    stage: "applied" as const,
    postingUrl: null,
    location: null,
    processNotes: null,
    updatedAt: "2026-09-19T00:00:00Z",
    nextStep: null,
    ...values,
  } satisfies CareerApplicationRow;
}

const ROWS: CareerApplicationRow[] = [
  row({
    id: "corvid",
    company: "Corvid Cloud",
    appliedOn: "2026-08-26",
    stage: "interview",
    nextStep: {
      id: "s1",
      applicationId: "corvid",
      name: "take-home",
      scheduledOn: "2026-09-16",
      position: 0,
      doneAt: null,
      notes: null,
    },
  }),
  row({ id: "baseline", company: "Baseline Data", appliedOn: "2026-08-19" }),
  row({ id: "ironvale", company: "Ironvale", appliedOn: "2026-08-11", stage: "withdrawn" }),
];

function serviceWith(overrides: Partial<CareerService> = {}) {
  return {
    listApplications: vi.fn().mockResolvedValue(ROWS),
    ...overrides,
  } as unknown as CareerService;
}

function renderPage(service: CareerService, onOpenApplication = vi.fn()) {
  render(
    <CareerPage
      service={service}
      userId="user-a"
      today={TODAY}
      onOpenApplication={onOpenApplication}
    />,
  );
  return onOpenApplication;
}

/** The company cell of every row, in the order the table draws them. */
function companies(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((tableRow) => within(tableRow).getAllByRole("cell")[0].textContent ?? "");
}

describe("The career table", () => {
  it("states what is in flight and lists every application", async () => {
    renderPage(serviceWith());
    expect(await screen.findByText("3 applications · 2 in process · 1 closed")).toBeTruthy();
    expect(companies()).toEqual(["Corvid Cloud", "Baseline Data", "Ironvale"]);
  });

  it("marks a round that has gone past, in days", async () => {
    renderPage(serviceWith());
    expect(await screen.findByText("3 days late")).toBeTruthy();
  });

  it("keeps only one stage when the filter row asks for it", async () => {
    renderPage(serviceWith());
    await screen.findByText("Corvid Cloud");
    fireEvent.click(screen.getByRole("button", { name: "Interview" }));
    expect(companies()).toEqual(["Corvid Cloud"]);
    // The line of counts is about the whole page, so a filter does not move it.
    expect(screen.getByText("3 applications · 2 in process · 1 closed")).toBeTruthy();
  });

  it("groups rejected and withdrawn under one word", async () => {
    renderPage(serviceWith());
    await screen.findByText("Corvid Cloud");
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(companies()).toEqual(["Ironvale"]);
  });

  it("sorts by a column, then reverses it, and says which", async () => {
    renderPage(serviceWith());
    await screen.findByText("Corvid Cloud");
    const header = screen.getByRole("button", { name: "Company" });
    fireEvent.click(header);
    expect(companies()).toEqual(["Baseline Data", "Corvid Cloud", "Ironvale"]);
    expect(screen.getByText(/Sorted by company/)).toBeTruthy();
    fireEvent.click(header);
    expect(companies()).toEqual(["Ironvale", "Corvid Cloud", "Baseline Data"]);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText(/Sorted by next step/)).toBeTruthy();
  });

  it("changes a stage in place and keeps the row where it is", async () => {
    const updateApplication = vi.fn().mockResolvedValue({ ...ROWS[1], stage: "screen" });
    renderPage(serviceWith({ updateApplication }));
    await screen.findByText("Baseline Data");
    fireEvent.change(screen.getByLabelText("Stage for Baseline Data"), {
      target: { value: "screen" },
    });
    await waitFor(() => expect(updateApplication).toHaveBeenCalled());
    expect(updateApplication.mock.calls[0][1]).toBe("baseline");
    expect(updateApplication.mock.calls[0][2]).toEqual({ stage: "screen" });
    expect((screen.getByLabelText("Stage for Baseline Data") as HTMLSelectElement).value).toBe(
      "screen",
    );
  });

  it("adds a row at the bottom from the company and role alone", async () => {
    const createApplication = vi.fn().mockResolvedValue(
      row({
        id: "new",
        company: "Quillwork",
        role: "design engineer intern",
        stage: "interested",
      }),
    );
    renderPage(serviceWith({ createApplication }));
    await screen.findByText("Corvid Cloud");
    fireEvent.click(screen.getByRole("button", { name: "Add application" }));
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: " Quillwork " } });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "design engineer intern" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(createApplication).toHaveBeenCalled());
    expect(createApplication.mock.calls[0][1]).toEqual({
      company: "Quillwork",
      role: "design engineer intern",
    });
    expect(await screen.findByText("Quillwork")).toBeTruthy();
    expect(
      screen.getByText("4 applications · 2 in process · 1 not sent yet · 1 closed"),
    ).toBeTruthy();
  });

  it("will not add a row with only half of it filled in", async () => {
    const createApplication = vi.fn();
    renderPage(serviceWith({ createApplication }));
    await screen.findByText("Corvid Cloud");
    fireEvent.click(screen.getByRole("button", { name: "Add application" }));
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Quillwork" } });
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    expect(createApplication).not.toHaveBeenCalled();
  });

  it("opens an application from its company", async () => {
    const onOpen = renderPage(serviceWith());
    fireEvent.click(await screen.findByRole("button", { name: "Corvid Cloud" }));
    expect(onOpen).toHaveBeenCalledWith("corvid");
  });

  it("says what went wrong and offers the read again", async () => {
    const listApplications = vi
      .fn()
      .mockRejectedValueOnce(new Error("Couldn’t load your applications. Try again."))
      .mockResolvedValue(ROWS);
    renderPage(serviceWith({ listApplications }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Corvid Cloud")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("invites the first application when there are none", async () => {
    renderPage(serviceWith({ listApplications: vi.fn().mockResolvedValue([]) }));
    expect(
      await screen.findByText("Nothing here yet. Add the first company you are applying to."),
    ).toBeTruthy();
  });

  it("says a stage is empty rather than showing a bare table", async () => {
    renderPage(serviceWith());
    await screen.findByText("Corvid Cloud");
    fireEvent.click(screen.getByRole("button", { name: "Offer" }));
    expect(screen.getByText("No applications at this stage.")).toBeTruthy();
  });
});
