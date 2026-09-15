// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClassAssignments } from "./ClassAssignments";
import { createFixtureAssignments } from "../../qa/ClassAssignmentsMock";
import type { Assignment, AssignmentService } from "./assignmentService";
afterEach(cleanup);
async function mount(service: AssignmentService) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<ClassAssignments userId="owner" courseId="math3012" service={service} />);
  });
  return view;
}
it("retains a failed draft and retries the same ID, preventing duplicate submissions while saving", async () => {
  const service = createFixtureAssignments(true);
  const create = vi
    .spyOn(service, "create")
    .mockRejectedValueOnce(new Error("Offline. Try again."));
  await mount(service);
  fireEvent.click(screen.getByRole("button", { name: "Add assignment" }));
  fireEvent.change(screen.getByLabelText("New assignment"), { target: { value: "Worksheet" } });
  await act(async () =>
    fireEvent.keyDown(screen.getByLabelText("New assignment"), { key: "Enter" }),
  );
  expect(screen.getByRole("alert").textContent).toContain("Offline");
  expect((screen.getByLabelText("New assignment") as HTMLInputElement).value).toBe("Worksheet");
  let finish!: (value: Assignment) => void;
  create.mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.keyDown(screen.getByLabelText("New assignment"), { key: "Enter" });
  fireEvent.keyDown(screen.getByLabelText("New assignment"), { key: "Enter" });
  expect(create).toHaveBeenCalledTimes(2);
  expect(create.mock.calls[0][2].id).toBe(create.mock.calls[1][2].id);
  await act(async () => finish(create.mock.calls[1][2]));
  expect(screen.getByRole("button", { name: "Edit title for Worksheet" })).toBeTruthy();
});
it("retries a failed load and never presents it as an empty database", async () => {
  const service = createFixtureAssignments(true);
  vi.spyOn(service, "list").mockRejectedValueOnce(new Error("Offline"));
  await mount(service);
  expect(screen.queryByText(/No assignments yet/)).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Add assignment" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
  expect(screen.getByText(/No assignments yet/)).toBeTruthy();
});
it("keeps saved completion on failure, retries it, and persists Undo across remounts", async () => {
  const service = createFixtureAssignments();
  vi.spyOn(service, "update").mockRejectedValueOnce(new Error("Couldn’t save"));
  const view = await mount(service);
  await act(async () =>
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark Problem set 3 done" })),
  );
  expect(
    (screen.getByRole("checkbox", { name: "Mark Problem set 3 done" }) as HTMLInputElement).checked,
  ).toBe(false);
  expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
  expect(
    (screen.getByRole("checkbox", { name: "Mark Problem set 3 unfinished" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
  view.unmount();
  await mount(service);
  expect(
    (screen.getByRole("checkbox", { name: "Mark Problem set 3 done" }) as HTMLInputElement).checked,
  ).toBe(false);
});
it("sends only edited fields and keeps an overdue due date after reloading", async () => {
  const service = createFixtureAssignments();
  const update = vi.spyOn(service, "update");
  const view = await mount(service);
  fireEvent.click(screen.getByRole("button", { name: "Edit title for Problem set 3" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Renamed worksheet" } });
  await act(async () => fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" }));
  expect(update.mock.calls[0].slice(0, 4)).toEqual([
    "owner",
    "math3012",
    "33333333-3333-4333-8333-000000000001",
    { title: "Renamed worksheet" },
  ]);
  const due = screen.getByRole("button", { name: "Edit due for Renamed worksheet" }).textContent;
  view.unmount();
  await mount(service);
  expect(screen.getByRole("button", { name: "Edit due for Renamed worksheet" }).textContent).toBe(
    due,
  );
});
it("aborts the previous class request and ignores its late result", async () => {
  const service = createFixtureAssignments(true);
  let resolve!: (rows: Assignment[]) => void;
  const list = vi.spyOn(service, "list").mockImplementationOnce(
    async () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = await mount(service);
  await act(async () =>
    view.rerender(<ClassAssignments userId="owner" courseId="other" service={service} />),
  );
  expect(list.mock.calls[0][2].aborted).toBe(true);
  await act(async () =>
    resolve([{ id: "old", title: "Wrong course", due: "", type: "", done: false }]),
  );
  await waitFor(() => expect(screen.getByText(/No assignments yet/)).toBeTruthy());
  expect(screen.queryByText("Wrong course")).toBeNull();
});
it("saves an optional time, clears it with the date, and preserves deletion Undo after a failed restore", async () => {
  const service = createFixtureAssignments();
  const update = vi.spyOn(service, "update");
  const restore = vi.spyOn(service, "restore").mockRejectedValueOnce(new Error("Offline restore"));
  await mount(service);
  fireEvent.click(screen.getByRole("button", { name: "Edit due for Problem set 3" }));
  fireEvent.change(screen.getByLabelText("Time (optional)"), { target: { value: "14:30" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply time" })));
  expect(screen.getByRole("button", { name: "Edit due for Problem set 3" }).textContent).toContain(
    "14:30",
  );
  expect(update.mock.calls[0][3]).toMatchObject({ dueTime: "14:30" });
  fireEvent.click(screen.getByRole("button", { name: "Edit due for Problem set 3" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Clear date" })));
  expect(screen.getByRole("button", { name: "Edit due for Problem set 3" }).textContent).toBe("—");
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Delete Problem set 3" })),
  );
  expect(screen.queryByRole("button", { name: "Edit title for Problem set 3" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
  expect(screen.getByRole("alert").textContent).toContain("Offline restore");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
  expect(screen.getByRole("button", { name: "Edit title for Problem set 3" })).toBeTruthy();
  expect(restore.mock.calls[0][3]).toBe(restore.mock.calls[1][3]);
});
