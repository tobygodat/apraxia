import { describe, expect, it, vi } from "vitest";

import { createDeletionStore } from "./deletionStore";
import type { DeleteUndoToken } from "../types/domain";

const token = "2026-09-06T20:00:00.123456+00:00" as DeleteUndoToken;

describe("deletion store", () => {
  it("keeps independent restore tokens and supports out-of-order undo", async () => {
    const store = createDeletionStore();
    const restoreTodo = vi.fn(async () => true);
    const restoreIdea = vi.fn(async () => true);
    store.add({ kind: "todo", id: "00000000-0000-4000-8000-000000000001", label: "Todo", token }, restoreTodo);
    store.add({ kind: "idea", id: "00000000-0000-4000-8000-000000000002", label: "Idea", token: "2026-09-06T20:00:01.123456+00:00" as DeleteUndoToken }, restoreIdea);

    expect(store.entries.map((entry) => entry.key)).toEqual([
      "todo:00000000-0000-4000-8000-000000000001",
      "idea:00000000-0000-4000-8000-000000000002",
    ]);
    await store.undo("idea:00000000-0000-4000-8000-000000000002");
    expect(restoreIdea).toHaveBeenCalledOnce();
    expect(store.entries).toHaveLength(1);
    await store.undo("todo:00000000-0000-4000-8000-000000000001");
    expect(restoreTodo).toHaveBeenCalledOnce();
    expect(store.entries).toHaveLength(0);
  });

  it("retains a failed restore for a later retry", async () => {
    const store = createDeletionStore();
    const restore = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const key = "media:00000000-0000-4000-8000-000000000003";
    store.add({ kind: "media", id: "00000000-0000-4000-8000-000000000003", label: "Media", token }, restore);

    await store.undo(key);
    expect(store.entries[0]).toMatchObject({ key, pending: false, error: "Undo is no longer available. Try again." });
    await store.undo(key);
    expect(restore).toHaveBeenCalledTimes(2);
    expect(store.entries).toHaveLength(0);
  });
});
