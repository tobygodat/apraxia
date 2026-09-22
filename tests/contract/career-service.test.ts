import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  createCareerService,
  isDefiniteRejection,
  prepareFile,
} from "../../frontend/src/features/career/careerService";
import type { Database } from "../../frontend/src/types/database";

const OWNER = "11111111-1111-4111-8111-111111111111";
const APPLICATION = "a1111111-1111-4111-8111-111111111111";

const application = {
  id: APPLICATION,
  user_id: OWNER,
  company: "Stripe",
  role: "Backend engineer",
  applied_on: "2026-09-10",
  stage: "applied",
  posting_url: null,
  location: null,
  process_notes: null,
  updated_at: "2026-09-18T00:00:00.123456+00:00",
};

const signal = () => new AbortController().signal;

const prep = {
  id: "c1111111-1111-4111-8111-111111111111",
  user_id: OWNER,
  application_id: APPLICATION,
  body: "Practice the project story",
  due_on: "2026-09-24",
  done_at: null,
  todo_id: "c1111111-1111-4111-8111-111111111111",
  position: 0,
  deleted_at: null,
  created_at: "2026-09-18T00:00:00+00:00",
  updated_at: "2026-09-18T00:00:00+00:00",
};

function setup(responses: unknown[]) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(responses.shift() ?? null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  return {
    service: createCareerService(
      createClient<Database>("https://career.example.test", "test-key", {
        global: { fetch },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    ),
    fetch,
  };
}

const calls = (fetch: ReturnType<typeof vi.fn>) =>
  fetch.mock.calls as unknown as [string, RequestInit][];

describe("career service", () => {
  it("reads every application and hangs its next step off its own open rounds", async () => {
    const { service, fetch } = setup([
      [application, { ...application, id: "b", company: "Ramp", applied_on: "2026-09-01" }],
      [
        {
          id: "s2",
          user_id: OWNER,
          application_id: APPLICATION,
          name: "Onsite",
          scheduled_on: "2026-10-20",
          position: 1,
          done_at: null,
          notes: null,
        },
        {
          id: "s1",
          user_id: OWNER,
          application_id: APPLICATION,
          name: "Technical screen",
          scheduled_on: "2026-10-02",
          position: 0,
          done_at: null,
          notes: null,
        },
      ],
    ]);
    const rows = await service.listApplications(OWNER, signal());
    // Stripe has the soonest round, so it leads; Ramp has none at all.
    expect(rows.map((row) => [row.company, row.nextStep?.name ?? null])).toEqual([
      ["Stripe", "Technical screen"],
      ["Ramp", null],
    ]);
    // Only the rounds that are still open are read, and only this account's.
    for (const [url] of calls(fetch))
      expect(new URL(url).searchParams.get("user_id")).toBe(`eq.${OWNER}`);
    expect(new URL(calls(fetch)[1]![0]).searchParams.get("done_at")).toBe("is.null");
  });

  it("refuses an application another account owns", async () => {
    const { service } = setup([
      { ...application, user_id: "22222222-2222-4222-8222-222222222222" },
    ]);
    await expect(service.getApplication(OWNER, APPLICATION, signal())).rejects.toThrow(
      "Couldn’t load this record.",
    );
  });

  it("states the rule rather than sending a value the database will refuse", async () => {
    const { service, fetch } = setup([]);
    await expect(
      service.createApplication(OWNER, { company: "  ", role: "Engineer" }, signal()),
    ).rejects.toThrow("Use a company name of 1–120 characters.");
    await expect(
      service.updateApplication(
        OWNER,
        APPLICATION,
        { postingUrl: "javascript:alert(1)" },
        signal(),
      ),
    ).rejects.toThrow("Use a link that starts with http:// or https://.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deletes and undoes through the shared record RPC, never by writing deleted_at", async () => {
    const { service, fetch } = setup(["2026-09-18T12:00:00.5+00:00", true]);
    const deletion = await service.deleteApplication(APPLICATION, signal());
    expect(deletion).toEqual({ id: APPLICATION, deletedAt: "2026-09-18T12:00:00.5+00:00" });
    expect(await service.restoreApplication(deletion, signal())).toBe(true);

    const [deleteCall, restoreCall] = calls(fetch);
    expect(deleteCall![0]).toContain("/rpc/soft_delete_record");
    expect(JSON.parse(String(deleteCall![1].body))).toEqual({
      p_record_type: "application",
      p_record_id: APPLICATION,
    });
    expect(restoreCall![0]).toContain("/rpc/restore_record");
    // Undo names the exact revision it is undoing, so a stale one does nothing.
    expect(JSON.parse(String(restoreCall![1].body))).toMatchObject({
      p_deleted_at: "2026-09-18T12:00:00.5+00:00",
    });
  });

  it("sends a typed tag list unchanged and matches one exactly when reading back", async () => {
    const { service, fetch } = setup([
      {
        id: "q1",
        user_id: OWNER,
        application_id: APPLICATION,
        body: "Design a rate limiter",
        answer: null,
        tags: ["system design"],
        asked_on: null,
        created_at: "2026-09-18T00:00:00+00:00",
      },
      [],
    ]);
    await service.saveQuestion(
      OWNER,
      APPLICATION,
      { body: "Design a rate limiter", tags: ["System Design ", "system design"] },
      signal(),
    );
    // Normalizing is the database's job, so what was typed is what is sent.
    expect(JSON.parse(String(calls(fetch)[0]![1].body))).toMatchObject({
      tags: ["System Design ", "system design"],
    });

    await service.listQuestionsByTag(OWNER, "  System Design ", signal());
    expect(new URL(calls(fetch)[1]![0]).searchParams.get("tags")).toBe('cs.{"system design"}');
  });

  it("imports one atomic client-identified batch and preserves stable IDs in the RPC", async () => {
    const second = {
      ...prep,
      id: "c2222222-2222-4222-8222-222222222222",
      todo_id: "c2222222-2222-4222-8222-222222222222",
      body: "Research the team",
      due_on: null,
      position: 1,
    };
    const { service, fetch } = setup([[prep, second]]);
    const rows = await service.importPrep(
      OWNER,
      APPLICATION,
      [
        { id: prep.id, body: prep.body, dueOn: prep.due_on },
        { id: second.id, body: second.body, dueOn: null },
      ],
      signal(),
    );

    expect(rows.map((row) => [row.id, row.todoId])).toEqual([
      [prep.id, prep.id],
      [second.id, second.id],
    ]);
    const [call] = calls(fetch);
    expect(call![0]).toContain("/rpc/import_career_prep_items");
    expect(JSON.parse(String(call![1].body))).toEqual({
      p_application_id: APPLICATION,
      p_items: [
        { id: prep.id, body: prep.body, due_on: prep.due_on },
        { id: second.id, body: second.body, due_on: null },
      ],
    });
  });

  it.each([
    ["P0002", "not_found"],
    ["23505", "conflict"],
    ["22023", "invalid_input"],
    ["08006", "unavailable"],
  ])("reports a %s import rejection as %s", async (code, expected) => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code, message: "rejected", details: null, hint: null }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const service = createCareerService(
      createClient<Database>("https://career.example.test", "test-key", {
        global: { fetch },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    );
    const failure = await service
      .importPrep(OWNER, APPLICATION, [{ id: prep.id, body: prep.body, dueOn: null }], signal())
      .catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ name: "ServiceError", code: expected });
    // Only an outcome that could have hidden a commit keeps the draft locked.
    expect(isDefiniteRejection(failure)).toBe(expected !== "unavailable");
  });

  it("edits and removes prep through its todo, sending only the changed fields", async () => {
    // A backfilled prep row keeps its own ID, so every write has to name the todo.
    const item = {
      id: prep.id,
      applicationId: APPLICATION,
      body: prep.body,
      dueOn: prep.due_on,
      doneAt: null,
      todoId: "d1111111-1111-4111-8111-111111111111",
      position: 0,
    };
    const doneAt = "2026-09-22T12:00:00+00:00";
    const { service, fetch } = setup([
      { user_id: OWNER, text: "Worded in Tasks", due_date: prep.due_on, completed_at: doneAt },
      { user_id: OWNER, text: "Worded in Tasks", due_date: null, completed_at: doneAt },
      "2026-09-22T12:05:00+00:00",
    ]);

    // The todo the database returns is the truth, wording from Tasks included.
    const saved = await service.savePrep(OWNER, item, { doneAt }, signal());
    expect(saved).toEqual({ ...item, body: "Worded in Tasks", doneAt });
    const [complete] = calls(fetch);
    const completeUrl = new URL(complete![0]);
    expect(completeUrl.pathname).toBe("/rest/v1/todos");
    expect(completeUrl.searchParams.get("id")).toBe(`eq.${item.todoId}`);
    expect(completeUrl.searchParams.get("deleted_at")).toBe("is.null");
    expect(complete![1].method).toBe("PATCH");
    expect(JSON.parse(String(complete![1].body))).toEqual({ completed: true });

    // Clearing the date clears the rule anchored on it, as it does in Tasks.
    await service.savePrep(OWNER, saved, { dueOn: null }, signal());
    expect(JSON.parse(String(calls(fetch)[1]![1].body))).toEqual({
      due_date: null,
      due_time: null,
      recurrence_freq: null,
      recurrence_interval: null,
      recurrence_until: null,
    });

    await service.removePrep(OWNER, item, signal());
    const remove = calls(fetch)[2]!;
    expect(remove[0]).toContain("/rpc/soft_delete_record");
    expect(JSON.parse(String(remove[1].body))).toEqual({
      p_record_type: "todo",
      p_record_id: item.todoId,
    });
  });

  it("measures a file before reserving anything, and refuses one it cannot store", async () => {
    const pdf = new File([new Uint8Array([1, 2, 3, 4])], "resume.pdf", {
      type: "application/pdf",
    });
    const draft = await prepareFile(pdf, "44444444-4444-4444-8444-444444444444");
    expect(draft).toMatchObject({
      name: "resume.pdf",
      contentType: "application/pdf",
      size: 4,
    });
    expect(draft.sha256).toMatch(/^[a-f0-9]{64}$/);

    await expect(prepareFile(new File(["x"], "notes.key"))).rejects.toThrow(
      "Choose a PDF, Word, Markdown, or text file.",
    );
    await expect(prepareFile(new File([], "empty.pdf"))).rejects.toThrow("This file is empty.");
  });

  it("saves a link in one write, with no reservation and no bucket", async () => {
    const { service, fetch } = setup([
      {
        id: "r1",
        user_id: OWNER,
        application_id: APPLICATION,
        kind: "link",
        title: "Their engineering blog",
        url: "https://example.test/blog",
        content_type: null,
        byte_size: null,
        content_sha256: null,
        object_path: null,
        uploaded_at: null,
        created_at: "2026-09-18T00:00:00+00:00",
      },
    ]);
    const saved = await service.addLink(
      OWNER,
      APPLICATION,
      { title: "Their engineering blog", url: "https://example.test/blog" },
      signal(),
    );
    expect(saved.kind).toBe("link");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(calls(fetch)[0]![1].body))).toMatchObject({
      kind: "link",
      url: "https://example.test/blog",
    });

    await expect(
      service.addLink(OWNER, APPLICATION, { title: "No link", url: "   " }, signal()),
    ).rejects.toThrow("Add a link to save this.");
  });
});
