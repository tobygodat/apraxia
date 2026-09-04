import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../../frontend/src/types/database";
import { createSupabaseTodoService } from "../../frontend/src/features/todos/supabaseTodoService";
import { localToday, addSqlDateDays } from "../../frontend/src/features/todos/dateDomain";

const url = process.env.ORBITOS_LOCAL_API;
if (url !== "http://127.0.0.1:54321") throw new Error("Only the fixed local Supabase API is supported.");
const publicKey = process.env.ORBITOS_LOCAL_PUBLIC_KEY!;
const secretKey = process.env.ORBITOS_LOCAL_SECRET_KEY!;
const authOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient<Database>(url, secretKey, authOptions);
const users: { id: string; client: SupabaseClient<Database> }[] = [];
const options = () => ({ signal: new AbortController().signal });

beforeAll(async () => {
  for (let index = 0; index < 2; index++) {
    const email = `todo-local-${randomUUID()}@example.test`;
    const password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Failed to create local test user.");
    const client = createClient<Database>(url, publicKey, authOptions);
    users.push({ id: created.data.user.id, client });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error("Failed to sign in local test user.");
  }
});

afterAll(async () => {
  const failures: string[] = [];
  for (const user of users) {
    await user.client.auth.signOut({ scope: "local" });
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error) failures.push(user.id);
    const remaining = await admin.auth.admin.getUserById(user.id);
    if (remaining.data.user !== null || remaining.error?.status !== 404) failures.push(user.id);
  }
  await admin.auth.dispose();
  for (const user of users) await user.client.auth.dispose();
  if (failures.length) throw new Error("Local test fixture cleanup failed.");
});

it("persists CRUD, exact Undo, completion, rescheduling, and denies cross-user access through the actual Data API", async () => {
  const a = createSupabaseTodoService(users[0]!.client);
  const b = createSupabaseTodoService(users[1]!.client);
  const initial = await a.loadWorkspace(options());
  expect(initial.profile.userId).toBe(users[0]!.id);
  expect(initial.profile.timezone).toBe("America/New_York");
  const today = localToday(initial.profile.timezone);
  const yesterday = addSqlDateDays(today, -1);
  const todo = await a.createTodo({ text: "Local persistence check", dueDate: yesterday, dueTime: "09:30" }, options());
  expect(todo.dueDate).toBe(yesterday);
  expect(todo.dueTime).toBe("09:30:00");
  expect((await createSupabaseTodoService(users[0]!.client).loadWorkspace(options())).todos.map(t => t.id)).toContain(todo.id);
  expect((await b.loadWorkspace(options())).todos).toHaveLength(0);
  await expect(b.updateTodoDetails(todo.id, { text: "Must not change" }, options())).rejects.toThrow();
  await expect(b.softDeleteTodo(todo.id, options())).rejects.toThrow();
  const project = await users[1]!.client.from("projects").insert({ title: "B only" }).select("id").single();
  if (project.error || !project.data) throw new Error("Test project creation failed.");
  await expect(a.updateTodoDetails(todo.id, { projectId: project.data.id }, options())).rejects.toThrow();
  expect((await a.loadToday(today, options()))[0]?.isOverdue).toBe(true);
  const completed = await a.setTodoCompleted(todo.id, true, options());
  expect(completed.completedAt).not.toBeNull();
  expect(await a.loadToday(today, options())).toHaveLength(0);
  await a.setTodoCompleted(todo.id, false, options());
  await a.updateTodoDetails(todo.id, { dueDate: addSqlDateDays(today, 1) }, options());
  expect(await a.loadToday(today, options())).toHaveLength(0);
  const cleared = await a.updateTodoDetails(todo.id, { dueDate: null, dueTime: null }, options());
  expect(cleared.dueDate).toBeNull();
  expect(cleared.dueTime).toBeNull();
  const token = await a.softDeleteTodo(todo.id, options());
  expect((await a.loadWorkspace(options())).todos).toHaveLength(0);
  expect(await b.restoreTodo(todo.id, token, options())).toBe(false);
  expect(await a.restoreTodo(todo.id, token, options())).toBe(true);
  expect(await a.restoreTodo(todo.id, token, options())).toBe(false);
  expect((await a.loadWorkspace(options())).todos[0]?.text).toBe("Local persistence check");
});

it("loads and reorders 1,005 eligible todos with the 1,000-row HTTP cap unchanged", async () => {
  const client = users[0]!.client;
  const service = createSupabaseTodoService(client);
  const today = localToday("America/New_York");
  for (let offset = 0; offset < 1005; offset += 200) {
    const inserted = await client.from("todos").insert(Array.from({ length: Math.min(200, 1005 - offset) }, (_, index) => ({
      text: `Local bulk ${offset + index}`, due_date: today,
    })));
    if (inserted.error) throw new Error("Bulk local fixtures could not be inserted.");
  }
  const capped = await client.from("todos").select("id");
  expect(capped.data).toHaveLength(1000);
  expect((await service.loadWorkspace(options())).todos).toHaveLength(1006);
  const start = performance.now();
  const todayList = await service.loadToday(today, options());
  console.info(`Real HTTP Today: ${todayList.length} rows in ${Math.round(performance.now() - start)} ms.`);
  expect(todayList).toHaveLength(1005);
  const order = todayList.map(t => t.id).reverse();
  const ranks = await service.reorderToday(today, order, options());
  expect(ranks).toHaveLength(1005);
  expect((await createSupabaseTodoService(client).loadToday(today, options())).map(t => t.id)).toEqual(order);
  await expect(createSupabaseTodoService(users[1]!.client).reorderToday(today, order, options())).rejects.toThrow();
  expect((await service.loadToday(today, options())).map(t => t.id)).toEqual(order);
});
