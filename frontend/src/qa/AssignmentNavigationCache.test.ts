import { expect, it } from "vitest";
import { NavigationCache, cacheNavigationService } from "../apps/navigationCache";
import { createFixtureAssignments } from "./ClassAssignmentsMock";

it("invalidates preloaded task snapshots on assignment completion, deletion and Undo", async () => {
  const cache = new NavigationCache();
  const source = createFixtureAssignments();
  const service = cacheNavigationService(
    source,
    cache,
    "assignments",
    [],
    ["create", "update", "remove", "restore"],
  );
  const signal = new AbortController().signal;
  const load = () => source.list("qa", "math3012", signal);
  const initial = await cache.read("todos", load);
  const id = initial[0].id;
  await service.update("qa", "math3012", id, { done: true }, signal);
  expect((await cache.read("todos", load)).find((row) => row.id === id)?.done).toBe(true);
  const token = await service.remove("qa", "math3012", id, signal);
  expect((await cache.read("todos", load)).some((row) => row.id === id)).toBe(false);
  await service.restore("qa", "math3012", id, token, signal);
  expect((await cache.read("todos", load)).some((row) => row.id === id)).toBe(true);
});
