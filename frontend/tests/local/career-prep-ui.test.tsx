// @vitest-environment happy-dom
// Auth is bootstrapped for a fictional local user; Google consent is not simulated.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { ConfiguredCloudApp } from "../../src/apps/CloudApp";
import { createCareerService } from "../../src/features/career/careerService";
import { localToday } from "../../src/features/todos/dateDomain";
import type { Database } from "../../src/types/database";

const url = process.env.APRAXIA_LOCAL_API;
if (url !== "http://127.0.0.1:54321") {
  throw new Error("Only the fixed local Supabase API is supported.");
}

const TASK_ID = randomUUID();
const TASK_TEXT = "Practice the synthetic architecture story";
const UPDATED_TASK_TEXT = "Practice the revised synthetic architecture story";
const COMPANY = "Synthetic Northstar";
const authOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const admin = createClient<Database>(url, process.env.APRAXIA_LOCAL_SECRET_KEY!, {
  auth: { ...authOptions.auth, storageKey: "local-career-ui-admin" },
});

const nativeFetch = globalThis.fetch.bind(globalThis);
let loseNextImportResponse = false;
const localFetch: typeof fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  const requestUrl =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (loseNextImportResponse && requestUrl.includes("/rpc/import_career_prep_items")) {
    loseNextImportResponse = false;
    throw new TypeError("Simulated lost local response.");
  }
  return response;
};

const client = createClient<Database>(url, process.env.APRAXIA_LOCAL_PUBLIC_KEY!, {
  ...authOptions,
  auth: { ...authOptions.auth, storageKey: "local-career-ui-user" },
  global: { fetch: localFetch },
});

let userId: string | undefined;
let applicationId: string | undefined;

beforeAll(async () => {
  const email = `career-prep-ui-${randomUUID()}@example.test`;
  const password = randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("Local UI user creation failed.");
  userId = created.data.user.id;

  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error("Local UI session setup failed.");

  const application = await createCareerService(client).createApplication(
    userId,
    { company: COMPANY, role: "Product engineer", stage: "interview" },
    new AbortController().signal,
  );
  applicationId = application.id;
});

afterAll(async () => {
  loseNextImportResponse = false;
  cleanup();
  vi.restoreAllMocks();
  await client.auth.signOut({ scope: "local" });
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    const remaining = await admin.auth.admin.getUserById(userId);
    if (deleted.error || remaining.data.user !== null || remaining.error?.status !== 404) {
      throw new Error("Local Career UI fixture cleanup failed.");
    }
  }
  await client.auth.dispose();
  await admin.auth.dispose();
});

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ConfiguredCloudApp client={client} />
    </MemoryRouter>,
  );
}

async function persistedRows() {
  const [prep, todo] = await Promise.all([
    client
      .from("career_prep")
      .select("id,application_id,body,due_on,done_at,todo_id")
      .eq("id", TASK_ID),
    client.from("todos").select("id,text,due_date,completed,completed_at").eq("id", TASK_ID),
  ]);
  if (prep.error || todo.error) throw new Error("Local Career fixture read failed.");
  return { prep: prep.data, todos: todo.data };
}

it("persists a reviewed plan once and keeps canonical task edits visible in Career", async () => {
  if (!userId || !applicationId) throw new Error("Local Career fixture setup did not finish.");
  let view = mount(`/career/${applicationId}/prep`);
  await screen.findByRole("heading", { name: COMPANY });

  fireEvent.click(await screen.findByRole("button", { name: "import a plan" }));
  fireEvent.change(screen.getByLabelText("paste a plan"), { target: { value: TASK_TEXT } });
  const uuid = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValueOnce(TASK_ID);
  fireEvent.click(screen.getByRole("button", { name: "review tasks" }));
  uuid.mockRestore();
  expect(await screen.findByLabelText("task 1")).toBeTruthy();

  // Review is a local draft. Neither half of the canonical pair exists yet.
  expect(await persistedRows()).toEqual({ prep: [], todos: [] });

  // The server commits, but the browser loses the response. Retrying through
  // the visible UI must reuse the reviewed UUID and read the committed pair.
  loseNextImportResponse = true;
  fireEvent.click(screen.getByRole("button", { name: "save 1 task" }));
  await screen.findByRole("alert");
  expect(await persistedRows()).toMatchObject({
    prep: [{ id: TASK_ID, application_id: applicationId, todo_id: TASK_ID }],
    todos: [{ id: TASK_ID, text: TASK_TEXT }],
  });
  fireEvent.click(screen.getByRole("button", { name: "try saving again" }));
  await screen.findByText("1 task saved to prep and tasks.");
  const replayed = await persistedRows();
  expect(replayed.prep).toHaveLength(1);
  expect(replayed.todos).toHaveLength(1);

  view.unmount();
  cleanup();
  view = mount("/todos");
  const inbox = await screen.findByRole("region", { name: "Inbox" });
  const inboxTask = await within(inbox).findByRole("article", { name: TASK_TEXT });

  const today = localToday("America/New_York");
  fireEvent.click(within(inboxTask).getByRole("button", { name: `Edit ${TASK_TEXT}` }));
  fireEvent.change(screen.getByLabelText("Due date"), { target: { value: today } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const todayRegion = await screen.findByRole("region", { name: /· Today$/ });
  const todayTask = await within(todayRegion).findByRole("article", { name: TASK_TEXT });
  fireEvent.click(
    within(todayTask).getByRole("checkbox", { name: `Mark as complete ${TASK_TEXT}` }),
  );
  await within(todayRegion).findByRole("checkbox", { name: `Mark as incomplete ${TASK_TEXT}` });
  await waitFor(async () => {
    expect((await persistedRows()).todos).toEqual([
      expect.objectContaining({ id: TASK_ID, completed: true }),
    ]);
  });

  view.unmount();
  cleanup();
  mount(`/career/${applicationId}/prep`);
  await screen.findByRole("heading", { name: COMPANY });
  const careerCompletion = await screen.findByRole("checkbox", { name: `${TASK_TEXT} done` });
  expect((careerCompletion as HTMLInputElement).checked).toBe(true);
  const careerRow = careerCompletion.closest(".career-app-row");
  if (!(careerRow instanceof HTMLElement)) throw new Error("Career prep row was not rendered.");
  const dueButton = careerRow.querySelector(".career-app-row__when");
  if (!(dueButton instanceof HTMLElement)) throw new Error("Career prep date was not rendered.");
  fireEvent.click(dueButton);
  expect((within(careerRow).getByLabelText(`${TASK_TEXT} due`) as HTMLInputElement).value).toBe(
    today,
  );

  const finalRows = await persistedRows();
  expect(finalRows.prep).toEqual([
    expect.objectContaining({ id: TASK_ID, due_on: today, done_at: expect.any(String) }),
  ]);
  expect(finalRows.todos).toEqual([
    expect.objectContaining({ id: TASK_ID, due_date: today, completed: true }),
  ]);

  // Keep Career mounted with its old text while Tasks updates the canonical
  // row. A completion-only Career write must not send that stale text back.
  const updated = await client
    .from("todos")
    .update({ text: UPDATED_TASK_TEXT })
    .eq("id", TASK_ID)
    .select("id,text")
    .single();
  if (updated.error || updated.data.text !== UPDATED_TASK_TEXT) {
    throw new Error("Authenticated canonical task update failed.");
  }
  expect(screen.queryByText(UPDATED_TASK_TEXT)).toBeNull();
  expect((await persistedRows()).prep).toEqual([
    expect.objectContaining({ id: TASK_ID, body: UPDATED_TASK_TEXT }),
  ]);

  fireEvent.click(careerCompletion);
  const reopened = await screen.findByRole("checkbox", { name: `${UPDATED_TASK_TEXT} done` });
  expect((reopened as HTMLInputElement).checked).toBe(false);
  await waitFor(async () => {
    const rows = await persistedRows();
    expect(rows.prep).toEqual([
      expect.objectContaining({ id: TASK_ID, body: UPDATED_TASK_TEXT, done_at: null }),
    ]);
    expect(rows.todos).toEqual([
      expect.objectContaining({
        id: TASK_ID,
        text: UPDATED_TASK_TEXT,
        completed: false,
        completed_at: null,
      }),
    ]);
  });
});
