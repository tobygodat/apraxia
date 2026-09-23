import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "../../frontend/src/types/database";
import { createClassService } from "../../frontend/src/features/classes/classService";
import { createAssignmentService } from "../../frontend/src/features/classes/assignmentService";

const url = process.env.APRAXIA_LOCAL_API;
if (url !== "http://127.0.0.1:54321")
  throw new Error("Only the fixed local Supabase API is supported.");
const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const admin = createClient<Database>(url, process.env.APRAXIA_LOCAL_SECRET_KEY!, options);
const users: { id: string; client: SupabaseClient<Database> }[] = [];
const signal = () => new AbortController().signal;
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const email = `class-local-${randomUUID()}@example.test`;
    const password = randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user)
      throw new Error("Could not create local Classes test user.");
    const client = createClient<Database>(url, process.env.APRAXIA_LOCAL_PUBLIC_KEY!, options);
    users.push({ id: created.data.user.id, client });
    if ((await client.auth.signInWithPassword({ email, password })).error)
      throw new Error("Local Classes sign-in failed.");
  }
});
afterAll(async () => {
  let failed = false;
  for (const user of users) {
    await user.client.auth.signOut({ scope: "local" });
    if ((await admin.auth.admin.deleteUser(user.id)).error) failed = true;
    await user.client.auth.dispose();
  }
  await admin.auth.dispose();
  if (failed) throw new Error("Local Classes fixture cleanup failed.");
});
it("persists classes and assignments through the real Data API", async () => {
  const a = users[0]!;
  const b = users[1]!;
  const classes = createClassService(a.client);
  await classes.importLegacy([{ id: "math3012", name: "MATH3012" }], signal());
  const original = (await classes.list(a.id, signal()))[0]!;
  await classes.rename(a.id, original, "Combinatorics", signal());
  await classes.importLegacy([{ id: "math3012", name: "Stale browser name" }], signal());
  expect((await createClassService(a.client).list(a.id, signal()))[0]?.name).toBe("Combinatorics");
  expect(await createClassService(b.client).list(b.id, signal())).toHaveLength(0);
  const assignments = createAssignmentService(a.client);
  await assignments.create(
    a.id,
    original.id,
    {
      id: randomUUID(),
      title: "Fictional problem set",
      type: "Homework",
      due: "2020-03-08",
      done: false,
    },
    signal(),
  );
  expect((await assignments.list(a.id, original.id, signal()))[0]?.due).toBe("2020-03-08");
});
