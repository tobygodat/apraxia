import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/database";
import { createCollectionService } from "./collectionService";
function fixture(result: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    "select",
    "is",
    "order",
    "eq",
    "range",
    "abortSignal",
    "insert",
    "update",
    "single",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = vi.fn((resolve: (value: unknown) => void) =>
    Promise.resolve(resolve({ data: result, error: null })),
  );
  const client = { from: vi.fn(() => chain), rpc: vi.fn(() => chain) };
  return {
    client,
    chain,
    service: createCollectionService(client as unknown as SupabaseClient<Database>),
  };
}
describe("Collection service", () => {
  it("filters Media on the server and fetches a stable 50-record page", async () => {
    const { service, client, chain } = fixture([]);
    await service.listMedia({ mediaType: "book", status: "saved", offset: 50 });
    expect(client.from).toHaveBeenCalledWith("media");
    expect(chain.eq).toHaveBeenCalledWith("media_type", "book");
    expect(chain.eq).toHaveBeenCalledWith("status", "saved");
    expect(chain.is).toHaveBeenCalledWith("deleted_at", null);
    expect(chain.range).toHaveBeenCalledWith(50, 99);
    expect(chain.order).toHaveBeenCalledWith("id");
  });
  it("deletes only the project via the atomic RPC and retains the exact restore token", async () => {
    const token = "2026-09-04T12:00:00.123456+00:00";
    const { service, client } = fixture(token);
    expect(await service.softDelete("project", "project-id")).toBe(token);
    expect(client.rpc).toHaveBeenCalledWith("soft_delete_record", {
      p_record_type: "project",
      p_record_id: "project-id",
    });
    expect(client.from).not.toHaveBeenCalled();
  });
  it("stores a titleless idea as null without inventing a title or accepting caller ownership", async () => {
    const { service, chain } = fixture({
      id: "idea",
      title: null,
      body: "Thought",
      project_id: null,
      created_at: "",
      updated_at: "",
    });
    const saved = await service.saveIdea({ title: "  ", body: "Thought" });
    expect(chain.insert).toHaveBeenCalledWith({ title: null, body: "Thought", project_id: null });
    expect(saved.title).toBeNull();
  });
  it("preserves search relevance ordering and sends the 40-result page", async () => {
    const { service, client } = fixture([
      {
        record_type: "idea",
        record_id: "id",
        title: "Thought",
        snippet: "Text",
        updated_at: "now",
        relevance: 2,
        total_count: 45,
      },
    ]);
    const found = await service.search("thought", 40);
    expect(client.rpc).toHaveBeenCalledWith("search_records", {
      p_query: "thought",
      p_offset: 40,
      p_limit: 40,
    });
    expect(found[0]).toMatchObject({
      recordType: "idea",
      recordId: "id",
      relevance: 2,
      totalCount: 45,
    });
  });
});
