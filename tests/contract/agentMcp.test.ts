import { describe, expect, it, vi } from "vitest";
import { createAgentMcpHandler } from "../../server/agent/agentMcp.js";

const token = "test-agent-token-" + "a".repeat(48);
const owner = "12345678-1234-4234-8234-123456789abc";
const environment = {
  APRAXIA_AGENT_TOKEN: token,
  APRAXIA_AGENT_USER_ID: owner,
  APRAXIA_AGENT_SCOPES: "workspace:read,workspace:write,calendar:read,calendar:write,files:read",
  SUPABASE_URL: "https://database.example",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_server-only",
};
function setup(
  env: Record<string, string | undefined> = environment,
  response: unknown = { items: [], next_offset: null },
  status = 200,
) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(response, { status }));
  const handle = createAgentMcpHandler({ environment: env, fetch: fetcher });
  const send = (message: unknown, bearer = token) =>
    handle(
      new Request("https://app.example/api/mcp", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify(message),
      }),
    );
  const call = async (name: string, args: Record<string, unknown>) =>
    (
      await send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
    ).json();
  const stored = (index = 0) => JSON.parse(String(fetcher.mock.calls[index]![1]?.body));
  return { fetcher, handle, send, call, stored };
}

describe("agent MCP connector", () => {
  it("fails closed without a valid token and only accepts POST", async () => {
    const { handle, send, fetcher } = setup();
    const rejected = await send({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "wrong");
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("www-authenticate")).toBe("Bearer");
    const get = await handle(
      new Request("https://app.example/api/mcp", { headers: { Authorization: `Bearer ${token}` } }),
    );
    expect(get.status).toBe(405);
    expect((await send("nonsense")).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("negotiates the protocol version and acknowledges notifications", async () => {
    const { send } = setup();
    const initialize = (protocolVersion: string) =>
      send({ jsonrpc: "2.0", id: "a", method: "initialize", params: { protocolVersion } });
    const reply = await (await initialize("2025-06-18")).json();
    expect(reply).toMatchObject({ id: "a", result: { protocolVersion: "2025-06-18" } });
    expect((await (await initialize("1999-01-01")).json()).result.protocolVersion).toBe(
      "2025-11-25",
    );
    const notified = await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notified.status).toBe(202);
    expect((await (await send({ jsonrpc: "2.0", id: 2, method: "nope" })).json()).error.code).toBe(
      -32601,
    );
  });
  it("offers only the tools the configured scopes allow", async () => {
    const names = async (scopes: string) => {
      const { send } = setup({ ...environment, APRAXIA_AGENT_SCOPES: scopes });
      const reply = await (await send({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json();
      return reply.result.tools.map((tool: { name: string }) => tool.name);
    };
    expect(await names("workspace:read")).toEqual([
      "guide",
      "list_records",
      "get_record",
      "search",
      "list_changes",
    ]);
    expect(await names(environment.APRAXIA_AGENT_SCOPES)).toContain("write_event");
    const { call, fetcher } = setup({ ...environment, APRAXIA_AGENT_SCOPES: "workspace:read" });
    expect((await call("create_record", { bucket: "todos", data: { text: "x" } })).error.code).toBe(
      -32602,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reads through the agent API with the server-bound owner", async () => {
    const { call, fetcher, stored } = setup();
    const reply = await call("list_records", { bucket: "todos", completed: false, limit: 12 });
    expect(reply.result.isError).toBe(false);
    expect(JSON.parse(reply.result.content[0].text)).toEqual({ items: [], next_offset: null });
    expect(stored()).toMatchObject({
      p_user_id: owner,
      p_operation: "list",
      p_bucket: "todos",
      p_query: { limit: 12, completed: false },
    });
    expect(JSON.stringify(fetcher.mock.calls[0]![1])).not.toContain(token);
    expect((await call("list_records", { bucket: "meta" })).error.code).toBe(-32602);
    expect((await call("list_records", { bucket: "todos", limit: [1] })).error.code).toBe(-32602);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("writes with a generated or supplied idempotency key and the expected version", async () => {
    const { call, stored } = setup(environment, { item: { id: "1", version: "v2" } });
    await call("create_record", { bucket: "todos", data: { text: "Plan" } });
    expect(stored(0)).toMatchObject({ p_operation: "create", p_data: { text: "Plan" } });
    expect(stored(0).p_request_id).toMatch(/^mcp-[0-9a-f-]{36}$/);
    await call("update_record", {
      bucket: "todos",
      id: "1",
      data: { completed: true },
      expected_version: "v1",
      idempotency_key: "claude-complete-1",
    });
    expect(stored(1)).toMatchObject({
      p_operation: "update",
      p_id: "1",
      p_expected_version: "v1",
      p_request_id: "claude-complete-1",
    });
  });
  it("reports agent API failures as tool errors", async () => {
    const { call } = setup(environment, { code: "40001" }, 409);
    const reply = await call("get_record", { bucket: "todos", id: "1" });
    expect(reply.result.isError).toBe(true);
    expect(JSON.parse(reply.result.content[0].text).error.code).toBe("conflict");
  });
});
