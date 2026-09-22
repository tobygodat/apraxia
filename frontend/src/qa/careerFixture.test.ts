import { describe, expect, it } from "vitest";

import { createFixtureCareer, type CareerFixtureTodoBridge } from "./careerFixture";

type LinkedTodo = ReturnType<CareerFixtureTodoBridge["create"]>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("career QA fixture task integration", () => {
  it("shares canonical prep state with the workspace todo store and replays imports read-only", async () => {
    const todos = new Map<string, LinkedTodo>();
    const bridge: CareerFixtureTodoBridge = {
      get: (id) => todos.get(id),
      create: (todo) => {
        todos.set(todo.id, { ...todo });
        return todo;
      },
      update: (id, changes) => {
        const current = todos.get(id);
        if (!current) throw new Error("missing fixture todo");
        const changed = { ...current, ...changes };
        todos.set(id, changed);
        return changed;
      },
      remove: (id) => {
        todos.delete(id);
      },
    };
    const service = createFixtureCareer({
      scenario: "realistic",
      today: "2026-09-22",
      todoBridge: bridge,
    });
    const signal = new AbortController().signal;
    const [application] = await service.listApplications("owner", signal);
    expect(application).toBeDefined();

    const seeded = await service.listPrep("owner", application!.id, signal);
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((item) => UUID.test(item.todoId))).toBe(true);

    const first = seeded[0]!;
    bridge.update(first.todoId, {
      text: "Canonical task edit",
      dueDate: "2026-09-29",
      completed: true,
      completedAt: "2026-09-22T12:00:00Z",
    });
    expect(
      (await service.listPrep("owner", application!.id, signal)).find(
        (item) => item.id === first.id,
      ),
    ).toMatchObject({
      body: "Canonical task edit",
      dueOn: "2026-09-29",
      doneAt: "2026-09-22T12:00:00Z",
    });

    const importedId = "99999999-9999-4999-8999-999999999999";
    await service.importPrep(
      "owner",
      application!.id,
      [{ id: importedId, body: "Original reviewed draft", dueOn: "2026-09-30" }],
      signal,
    );
    bridge.update(importedId, { text: "Edited later from Tasks", completed: false });
    const replay = await service.importPrep(
      "owner",
      application!.id,
      [{ id: importedId, body: "Original reviewed draft", dueOn: "2026-09-30" }],
      signal,
    );
    expect(replay).toHaveLength(1);
    expect(replay[0]).toMatchObject({ id: importedId, body: "Edited later from Tasks" });
    expect([...todos.keys()].filter((id) => id === importedId)).toHaveLength(1);

    const unicodeId = "88888888-8888-4888-8888-888888888888";
    const unicodeBody = "😀".repeat(1_500);
    const [unicode] = await service.importPrep(
      "owner",
      application!.id,
      [{ id: unicodeId, body: unicodeBody, dueOn: null }],
      signal,
    );
    expect(unicode?.body).toBe(unicodeBody);

    await service.removePrep("owner", replay[0]!, signal);
    expect(
      (await service.listPrep("owner", application!.id, signal)).some(
        (item) => item.id === importedId,
      ),
    ).toBe(false);
  });
});

describe("career QA fixture personal scenario", () => {
  it("adds no demo prep, which would become tasks on the real account's Home", async () => {
    const created: string[] = [];
    const service = createFixtureCareer({
      scenario: "personal",
      today: "2026-09-22",
      todoBridge: {
        get: () => undefined,
        create: (todo) => {
          created.push(todo.id);
          return todo;
        },
        update: () => {
          throw new Error("no fixture todo to update");
        },
        remove: () => undefined,
      },
    });
    const signal = new AbortController().signal;
    for (const application of await service.listApplications("owner", signal))
      expect(await service.listPrep("owner", application.id, signal)).toEqual([]);
    expect(created).toEqual([]);
  });
});
