import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../../frontend/src/types/database";
import { createAgentHandler } from "../../server/agent/agentHandler";
import { createNoteService, prepareUpload } from "../../frontend/src/features/classes/noteService";

const url = process.env.ORBITOS_LOCAL_API;
if (url !== "http://127.0.0.1:54321")
  throw new Error("Only disposable local Supabase is supported.");
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const admin = createClient<Database>(url, process.env.ORBITOS_LOCAL_SECRET_KEY!, options);
const users: { id: string; client: SupabaseClient<Database> }[] = [];
const token = randomBytes(32).toString("base64url");
const paths: string[] = [];
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const email = `agent-local-${randomUUID()}@example.test`;
    const password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Local user creation failed.");
    const client = createClient<Database>(url, process.env.ORBITOS_LOCAL_PUBLIC_KEY!, options);
    users.push({ id: created.data.user.id, client });
    if ((await client.auth.signInWithPassword({ email, password })).error)
      throw new Error("Local sign-in failed.");
  }
});
afterAll(async () => {
  if (paths.length) expect((await admin.storage.from("class-pdfs").remove(paths)).error).toBeNull();
  for (const user of users) {
    await user.client.auth.signOut({ scope: "local" });
    expect((await admin.auth.admin.deleteUser(user.id)).error).toBeNull();
    await user.client.auth.dispose();
  }
  await admin.auth.dispose();
});
function handle(user = users[0]!) {
  return createAgentHandler({
    environment: {
      ORBITOS_AGENT_TOKEN: token,
      ORBITOS_AGENT_USER_ID: user.id,
      ORBITOS_AGENT_SCOPES: "workspace:read,workspace:write,files:read",
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: process.env.ORBITOS_LOCAL_SECRET_KEY!,
    },
  });
}
function request(resource: string, method = "GET", body?: unknown, key?: string) {
  return new Request(`http://localhost:3000/api/agent/v1/${resource}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
it("persists agent edits into dashboard records and handles concurrent retries and conflicts", async () => {
  const run = handle();
  const creates = await Promise.all(
    Array.from({ length: 3 }, () =>
      run(
        request(
          "todos",
          "POST",
          { data: { text: "Fictional agent task", due_date: "2020-03-08" } },
          "task-create",
        ),
      ),
    ),
  );
  expect(creates.map((r) => r.status)).toEqual([201, 201, 201]);
  const values = await Promise.all(creates.map((r) => r.json()));
  expect(values[0]).toEqual(values[1]);
  expect(values[1]).toEqual(values[2]);
  const todo = values[0].item;
  const dashboard = await users[0]!.client.from("todos").select("*").eq("id", todo.id).single();
  expect(dashboard.error).toBeNull();
  expect(dashboard.data?.due_date).toBe("2020-03-08");
  expect((await users[1]!.client.from("todos").select("*").eq("id", todo.id)).data).toEqual([]);
  expect((await handle(users[1]!)(request(`todos?id=${todo.id}`))).status).toBe(404);
  const edits = await Promise.all(
    ["edit-a", "edit-b"].map((key) =>
      run(
        request(
          `todos?id=${todo.id}`,
          "PATCH",
          { data: { text: key }, expected_version: todo.version },
          key,
        ),
      ),
    ),
  );
  expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
  const current = await (await run(request(`todos?id=${todo.id}`))).json();
  const changed = await users[0]!.client
    .from("todos")
    .update({ completed: true })
    .eq("id", todo.id);
  expect(changed.error).toBeNull();
  expect(
    (
      await run(
        request(
          `todos?id=${todo.id}`,
          "PATCH",
          { data: { text: "stale" }, expected_version: current.item.version },
          "stale-after-browser",
        ),
      )
    ).status,
  ).toBe(409);
  expect(
    (await run(request("todos", "POST", { data: { text: "Different" } }, "task-create"))).status,
  ).toBe(409);
  const history = await (await run(request("changes"))).json();
  expect(history.items).toHaveLength(2);
  const denied = await users[0]!.client.rpc("agent_workspace", {
    p_user_id: users[1]!.id,
    p_operation: "list",
    p_bucket: "todos",
  });
  expect(denied.error).not.toBeNull();
});
it("creates projects, ideas, classes and assignments, searches and edits their relationships", async () => {
  const run = handle();
  const create = async (bucket: string, data: unknown) => {
    const response = await run(request(bucket, "POST", { data }, randomUUID()));
    expect(response.status).toBe(201);
    return (await response.json()).item;
  };
  const project = await create("projects", {
    title: "Fictional research",
    description: "Exam preparation",
    status: "active",
  });
  await create("ideas", {
    title: "Study approach",
    body: "Practice recall",
    project_id: project.id,
  });
  await create("classes", { id: "fictional-math", name: "Fictional Math" });
  const assignment = await create("todos", {
    text: "Fictional exam",
    class_id: "fictional-math",
    assignment_type: "Exam",
    due_date: "2026-10-01",
  });
  const search = await (await run(request("search?q=fictional"))).json();
  expect(search.buckets.classes.items).toHaveLength(1);
  expect(search.buckets.projects.items).toHaveLength(1);
  expect(search.buckets.todos.items.some((row: { id: string }) => row.id === assignment.id)).toBe(
    true,
  );
  const first = await (await run(request("todos?limit=1"))).json();
  expect(first.items).toHaveLength(1);
  expect(first.next_offset).toBe(1);
  expect(
    (
      await run(
        request(
          `todos?id=${assignment.id}`,
          "PATCH",
          { data: { project_id: project.id }, expected_version: assignment.version },
          "two-parents",
        ),
      )
    ).status,
  ).toBe(400);
});
it("streams uploaded PDF bytes and edits saved note metadata without changing file identity", async () => {
  const user = users[0]!;
  const noteService = createNoteService(user.client);
  const file = new File(["%PDF-1.7\n% Fictional agent verification\n%%EOF"], "Fictional.pdf");
  const draft = await prepareUpload(file);
  const note = await noteService.reserve(
    user.id,
    "fictional-math",
    draft,
    new AbortController().signal,
  );
  paths.push(note.object_path!);
  await noteService.upload(note, file, new AbortController().signal);
  const run = handle();
  const bytes = await run(request(`note-content?id=${note.id}`));
  expect(bytes.status).toBe(200);
  expect(await bytes.text()).toBe(await file.text());
  const current = await (await run(request(`notes?id=${note.id}`))).json();
  const update = await run(
    request(
      `notes?id=${note.id}`,
      "PATCH",
      { data: { name: "Renamed lecture" }, expected_version: current.item.version },
      "rename-upload",
    ),
  );
  expect(update.status).toBe(200);
  const updated = (await update.json()).item;
  expect(updated.object_path).toBe(note.object_path);
  expect(updated.content_sha256).toBe(draft.sha256);
  expect((await handle(users[1]!)(request(`note-content?id=${note.id}`))).status).toBe(404);
});
