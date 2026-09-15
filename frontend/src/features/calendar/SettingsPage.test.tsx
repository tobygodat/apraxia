// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CalendarService } from "./calendarService";
import type { GoogleCalendarConnectionStatus } from "../../types/domain";
import { SettingsPage } from "./SettingsPage";
import { cacheNavigationService, NavigationCache } from "../../apps/navigationCache";
afterEach(cleanup);
const profile = { userId: "user", timezone: "UTC", createdAt: "", updatedAt: "" };
it("keeps the saved visibility when an update fails", async () => {
  const service = {
    status: async () => ({ connectionState: "connected" }),
    calendars: async () => [
      { id: "calendar", displayName: "Personal", isVisible: true, color: {} },
    ],
    setVisibility: vi.fn(async () => {
      throw new Error("Calendar visibility was not saved. Try again.");
    }),
  } as unknown as CalendarService;
  render(
    <SettingsPage
      calendarService={service}
      profile={{ userId: "user", timezone: "UTC", createdAt: "", updatedAt: "" }}
      onSignOut={() => {}}
    />,
  );
  const toggle = await screen.findByRole("checkbox", { name: "Personal" });
  fireEvent.click(toggle);
  await screen.findByText("Calendar visibility was not saved. Try again.");
  expect((toggle as HTMLInputElement).checked).toBe(true);
  expect(service.setVisibility).toHaveBeenCalledWith("calendar", false);
});
it("renders settings immediately from a warmed cache with no loading flash", async () => {
  const raw = {
    status: async () => ({ connectionState: "connected" }) as GoogleCalendarConnectionStatus,
    calendars: async () => [
      { id: "calendar", displayName: "Personal", isVisible: true, color: {} },
    ],
  } as unknown as CalendarService;
  const cache = new NavigationCache();
  const service = cacheNavigationService(raw, cache, "calendar", ["status", "calendars"], []);
  await service.status();
  await service.calendars();
  render(<SettingsPage calendarService={service} profile={profile} onSignOut={() => {}} />);
  expect(screen.getByText("Connected")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "Personal" })).toBeTruthy();
  expect(screen.queryByText("Loading Calendar settings…")).toBeNull();
});
it("shows the loading placeholder with a cold cache", async () => {
  const raw = {
    status: async () => ({ connectionState: "connected" }) as GoogleCalendarConnectionStatus,
    calendars: async () => [
      { id: "calendar", displayName: "Personal", isVisible: true, color: {} },
    ],
  } as unknown as CalendarService;
  const cache = new NavigationCache();
  const service = cacheNavigationService(raw, cache, "calendar", ["status", "calendars"], []);
  render(<SettingsPage calendarService={service} profile={profile} onSignOut={() => {}} />);
  expect(screen.getByText("Loading Calendar settings…")).toBeTruthy();
  expect(await screen.findByRole("checkbox", { name: "Personal" })).toBeTruthy();
});
