// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CalendarService } from "./calendarService";
import { SettingsPage } from "./SettingsPage";
afterEach(cleanup);
it("keeps the saved visibility when an update fails", async () => {
  const service = { status: async () => ({ connectionState: "connected" }), calendars: async () => [{ id: "calendar", displayName: "Personal", isVisible: true, color: {} }], setVisibility: vi.fn(async () => { throw new Error("Calendar visibility was not saved. Try again."); }) } as unknown as CalendarService;
  render(<SettingsPage
    calendarService={service}
    profile={{ userId: "user", timezone: "UTC", createdAt: "", updatedAt: "" }}
    onSignOut={() => { }} />);
  const toggle = await screen.findByRole("checkbox", { name: "Personal" });
  fireEvent.click(toggle);
  await screen.findByText("Calendar visibility was not saved. Try again.");
  expect((toggle as HTMLInputElement).checked).toBe(true);
  expect(service.setVisibility).toHaveBeenCalledWith("calendar", false);
});
