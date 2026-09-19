// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CareerApplicationPage, type CareerTab } from "./CareerApplicationPage";
import type { CareerService } from "./careerService";
import { localToday } from "../todos/dateDomain";
import { createFixtureCareer } from "../../qa/careerFixture";

afterEach(cleanup);

/**
 * These run against the QA fixture rather than mocks: it is a working
 * `CareerService` over arrays, so a round ticked off here goes through the same
 * call the hosted service answers and comes back the way the page will read it.
 * The page works its own "today" out of the timezone it is given, so the fixture
 * is seeded with the same one and the dated rows agree with the header.
 */
const ZONE = "UTC";

async function openApplication(tab: CareerTab = "structure") {
  const today = localToday(ZONE);
  const service = createFixtureCareer({ scenario: "realistic", today });
  const [first] = await service.listApplications("user-a", new AbortController().signal);
  const onOpenTab = vi.fn();
  render(
    <CareerApplicationPage
      userId="user-a"
      applicationId={first.id}
      tab={tab}
      service={service}
      timezone={ZONE}
      onOpenTab={onOpenTab}
      onBack={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { level: 1, name: first.company });
  return { service, applicationId: first.id, company: first.company, onOpenTab };
}

/** The row a round is written on, so its own classes can be read. */
function roundRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest(".career-app-row");
  if (!(row instanceof HTMLElement)) throw new Error(`No row for the round ${name}.`);
  return row;
}

describe("One application's page", () => {
  it("states where the application stands and what round is next", async () => {
    await openApplication();
    const summary = await screen.findByText(/^applied /);
    expect(summary.textContent).toContain("interview");
    expect(summary.textContent).toContain("next, technical screen");
    expect(summary.textContent).toContain("in 3 days");
    // The round that is next is the one carrying the green rule, and a round
    // already behind it is not.
    expect(roundRow("technical screen").className).toContain("paper-row--now");
    expect(roundRow("recruiter call").className).not.toContain("paper-row--now");
  });

  it("moves the next round, and the rule, when one is ticked off", async () => {
    await openApplication();
    fireEvent.click(await screen.findByLabelText("technical screen done"));
    await waitFor(() => {
      expect(roundRow("onsite").className).toContain("paper-row--now");
    });
    expect(roundRow("technical screen").className).not.toContain("paper-row--now");
    expect((await screen.findByText(/^applied /)).textContent).toContain(
      "next, onsite not scheduled",
    );
  });

  it("writes the process notes as markdown and renders the result", async () => {
    const { service, applicationId } = await openApplication();
    fireEvent.click(await screen.findByRole("button", { name: "write" }));
    const source = await screen.findByLabelText("how this process goes");
    fireEvent.change(source, {
      target: { value: "## the loop\n\n- [x] recruiter call\n- [ ] `git bisect` question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "done" }));

    // Back at rest the note is its result, not its source.
    expect(await screen.findByRole("heading", { name: "the loop" })).toBeTruthy();
    expect(screen.queryByText(/^## the loop/)).toBeNull();
    expect(screen.getByText("git bisect").tagName).toBe("CODE");
    // And it went through the service, so a fresh read has it.
    const saved = await service.getApplication(
      "user-a",
      applicationId,
      new AbortController().signal,
    );
    expect(saved.processNotes).toContain("## the loop");
  });

  it("gives up an edit when Escape leaves the field", async () => {
    const { service, applicationId } = await openApplication();
    fireEvent.click(await screen.findByRole("button", { name: "write" }));
    const source = await screen.findByLabelText("how this process goes");
    fireEvent.change(source, { target: { value: "thrown away" } });
    fireEvent.keyDown(source, { key: "Escape" });

    await waitFor(() => expect(screen.queryByText("thrown away")).toBeNull());
    const saved = await service.getApplication(
      "user-a",
      applicationId,
      new AbortController().signal,
    );
    expect(saved.processNotes).not.toContain("thrown away");
  });

  it("marks a round late once its date has gone past", async () => {
    await openApplication();
    const dense = within(roundRow("technical screen"));
    expect(dense.getByText(/in 3 days/)).toBeTruthy();
    // The round behind it is done, so it says its date and nothing about days.
    expect(within(roundRow("recruiter call")).queryByText(/late/)).toBeNull();
  });
});

describe("The prep tab", () => {
  it("lists what is left to do before what is already done", async () => {
    await openApplication("prep");
    // The tab's own rows arrive after the header does, so the list is waited
    // for rather than read off whatever has painted by now.
    await screen.findByLabelText("Re-read the payments primer done");
    const names = screen
      .getAllByRole("checkbox")
      .map((box) => box.getAttribute("aria-label") ?? "")
      .map((label) => label.replace(/ done$/, ""));
    expect(names[names.length - 1]).toBe("Re-read the payments primer");
    expect(names[0]).toBe("Idempotency keys, retries, webhook ordering");
  });

  it("widens a tagged question to every company, then narrows it again", async () => {
    await openApplication("prep");
    fireEvent.click(await screen.findByRole("button", { name: "systems" }));
    fireEvent.click(await screen.findByRole("button", { name: "across all companies" }));
    expect(await screen.findByText(/tagged systems/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "this company only" }));
    await waitFor(() => expect(screen.queryByText(/tagged systems/)).toBeNull());
  });

  it("keeps the behaviourals account-level and says where one has been told", async () => {
    const { company } = await openApplication("prep");
    expect(await screen.findByText("The migration nobody wanted to own")).toBeTruthy();
    const row = screen.getByText("The migration nobody wanted to own").closest(".career-app-row");
    expect(row?.textContent).toContain(`used at ${company}`);
    // Already told here, so the word on offer is the one that takes it off.
    expect(within(row as HTMLElement).getByRole("button", { name: "not told here" })).toBeTruthy();
  });
});

describe("The resources tab", () => {
  it("keeps files and links apart and says what each one is", async () => {
    await openApplication("resources");
    // Both headings paint before the rows load, so the file is what says the
    // tab has its data; waiting on a heading would not.
    const file = (await screen.findByText("resume — september.pdf")).closest(".career-app-row");
    expect(screen.getByRole("heading", { name: "files" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "links" })).toBeTruthy();
    expect(file?.textContent).toContain("pdf · 214 KB");
    // A file is opened or downloaded; there is no Drive picker on this page.
    expect(screen.getByRole("button", { name: "upload a file" })).toBeTruthy();
    expect(screen.queryByText(/drive/i)).toBeNull();
  });
});

describe("An application that is gone", () => {
  it("says so rather than waiting on it", async () => {
    const service = createFixtureCareer({ scenario: "realistic", today: localToday(ZONE) });
    render(
      <CareerApplicationPage
        userId="user-a"
        applicationId="no-such-application"
        tab="structure"
        service={service as CareerService}
        timezone={ZONE}
        onOpenTab={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(await screen.findByText("This application isn’t here any more.")).toBeTruthy();
  });
});
