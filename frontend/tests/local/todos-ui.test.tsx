// @vitest-environment happy-dom
// Auth is bootstrapped for a fictional local user; Google consent is not simulated.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../../src/types/database";
import { ConfiguredCloudApp } from "../../src/apps/CloudApp";

const url = process.env.APRAXIA_LOCAL_API;
if (url !== "http://127.0.0.1:54321")
  throw new Error("Only the fixed local Supabase API is supported.");
const authOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const admin = createClient<Database>(url, process.env.APRAXIA_LOCAL_SECRET_KEY!, {
  auth: { ...authOptions.auth, storageKey: "local-ui-admin" },
});
const client = createClient<Database>(url, process.env.APRAXIA_LOCAL_PUBLIC_KEY!, authOptions);
let userId: string | undefined;

beforeAll(async () => {
  const email = `todo-ui-${randomUUID()}@example.test`;
  const password = randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("Local UI user creation failed.");
  userId = created.data.user.id;
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error("Local UI session setup failed.");
});

afterAll(async () => {
  cleanup();
  await client.auth.signOut({ scope: "local" });
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    const remaining = await admin.auth.admin.getUserById(userId);
    if (deleted.error || remaining.data.user !== null || remaining.error?.status !== 404) {
      throw new Error("Local UI fixture cleanup failed.");
    }
  }
  await client.auth.dispose();
  await admin.auth.dispose();
});

function mount() {
  return render(
    <MemoryRouter initialEntries={["/todos"]}>
      <ConfiguredCloudApp client={client} />
    </MemoryRouter>,
  );
}

it("uses the authenticated route for Add, reload, completion, delete/Undo, and sign-out with actual persisted records", async () => {
  let view = mount();
  await screen.findByRole("heading", { name: "Inbox" });
  fireEvent.click(screen.getByRole("button", { name: /\+ add/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Task" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Task"), {
    target: { value: "Persisted from the UI" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Add task" }));
  await screen.findByText("Persisted from the UI");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  view.unmount();
  view = mount();
  await screen.findByText("Persisted from the UI");
  fireEvent.click(screen.getByRole("checkbox", { name: "Mark as complete Persisted from the UI" }));
  await screen.findByRole("checkbox", { name: "Mark as incomplete Persisted from the UI" });
  // Completion is optimistic; row controls stay disabled until the write settles.
  await waitFor(() => {
    const button = screen.getByRole("button", { name: "Delete Persisted from the UI" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete Persisted from the UI" }));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await screen.findByText("Persisted from the UI");
  fireEvent.click(screen.getByRole("button", { name: "account" }));
  fireEvent.click(screen.getByRole("button", { name: "sign out" }));
  await screen.findByRole("button", { name: "Continue with Google" });
  expect(screen.queryByText("Persisted from the UI")).toBeNull();
  view.unmount();
});
