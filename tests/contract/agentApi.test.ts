import { describe, expect, it, vi } from "vitest";
import { createAgentHandler } from "../../server/agent/agentHandler.js";

const token = "test-agent-token-" + "a".repeat(48);
const owner = "12345678-1234-4234-8234-123456789abc";
const environment = {
  APRAXIA_AGENT_TOKEN: token,
  APRAXIA_AGENT_USER_ID: owner,
  APRAXIA_AGENT_SCOPES: "workspace:read,workspace:write,calendar:read,calendar:write,files:read",
  SUPABASE_URL: "https://database.example",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_server-only",
};
function request(
  path: string,
  options: { method?: string; body?: unknown; token?: string; key?: string } = {},
) {
  return new Request(`https://app.example/api/agent/v1/${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.token ?? token}`,
      "Content-Type": "application/json",
      ...(options.key ? { "Idempotency-Key": options.key } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}
function setup(
  response: unknown = { items: [], next_offset: null },
  status = 200,
  env: Record<string, string | undefined> = environment,
) {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json(response, { status }));
  const handle = createAgentHandler({ environment: env, fetch: fetcher });
  return { fetcher, handle };
}
describe("agent API boundary", () => {
  it("fails closed for missing configuration, wrong token, and URL credentials without touching storage", async () => {
    const { handle, fetcher } = setup();
    expect((await handle(request("todos", { token: "wrong" }))).status).toBe(401);
    expect(
      (await handle(new Request(`https://app.example/api/agent/v1/todos?token=${token}`))).status,
    ).toBe(401);
    expect((await createAgentHandler({ environment: {} })(request("todos"))).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("accepts the token under the pre-rename Vercel variable name", async () => {
    const { APRAXIA_AGENT_TOKEN, ...rest } = environment;
    const { handle } = setup(undefined, 200, { ...rest, ORBITOS_AGENT_TOKEN: APRAXIA_AGENT_TOKEN });
    expect((await handle(request("meta"))).status).toBe(200);
    expect((await handle(request("meta", { token: "wrong" }))).status).toBe(401);
  });
  it("binds ownership to environment and never forwards the agent credential upstream", async () => {
    const { handle, fetcher } = setup();
    const response = await handle(request("todos?limit=12&completed=false&resource=todos"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://database.example/rest/v1/rpc/agent_workspace");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      p_user_id: owner,
      p_operation: "list",
      p_bucket: "todos",
      p_query: { limit: 12, completed: false },
    });
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
    expect(JSON.stringify(init)).not.toContain(token);
    expect(init?.redirect).toBe("error");
  });
  it("rejects ownership overrides, duplicate parameters and malformed pagination", async () => {
    const { handle, fetcher } = setup();
    for (const query of [
      "user_id=other",
      "limit=1&limit=2",
      "resource=ideas",
      "offset=-1",
      "limit=101",
      "due_from=2026-02-31",
      "due_from=2026-10-01&due_to=2026-09-01",
    ]) {
      expect((await handle(request(`todos?${query}`))).status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("documents capabilities behind authentication without needing the database", async () => {
    const { handle, fetcher } = setup();
    expect((await handle(request("meta"))).status).toBe(200);
    const spec = await (await handle(request("openapi"))).json();
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(spec.servers[0].url).toBe("/api/agent/v1");
    expect(spec.paths["/todos"]).toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires write scope, idempotency and a version precondition", async () => {
    const readonly = setup(undefined, 200, {
      ...environment,
      APRAXIA_AGENT_SCOPES: "workspace:read",
    });
    expect(
      (
        await readonly.handle(
          request("todos", { method: "POST", key: "capture-1", body: { data: { text: "Read" } } }),
        )
      ).status,
    ).toBe(403);
    const { handle, fetcher } = setup();
    expect(
      (await handle(request("todos", { method: "POST", body: { data: { text: "Read" } } }))).status,
    ).toBe(400);
    expect(
      (
        await handle(
          request(`todos?id=${owner}`, {
            method: "PATCH",
            key: "edit-1",
            body: { data: { completed: true } },
          }),
        )
      ).status,
    ).toBe(428);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("passes exact versions, dates and idempotency keys without timezone conversion", async () => {
    const { handle, fetcher } = setup({ item: { id: owner, version: "next" } });
    const response = await handle(
      request(`todos?id=${owner}`, {
        method: "PATCH",
        key: "edit-1",
        body: { data: { due_date: "2026-09-16" }, expected_version: "opaque-original" },
      }),
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({
      p_operation: "update",
      p_id: owner,
      p_request_id: "edit-1",
      p_expected_version: "opaque-original",
      p_data: { due_date: "2026-09-16" },
    });
  });
  it("maps conflicts and sanitizes database failures", async () => {
    const conflict = setup({ code: "40001", message: "secret SQL" }, 400);
    const response = await conflict.handle(request("todos"));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("secret SQL");
    const bad = setup({ code: "XX000", message: "password=private" }, 500);
    expect(await (await bad.handle(request("todos"))).text()).not.toContain("private");
  });
  it("fans out search into separately paginated buckets", async () => {
    const { handle, fetcher } = setup();
    const result = await (await handle(request("search?q=exam"))).json();
    expect(Object.keys(result.buckets)).toEqual(["todos", "projects", "ideas", "classes", "notes"]);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("rejects unknown write-envelope fields, non-JSON and oversized bodies", async () => {
    const { handle, fetcher } = setup();
    expect(
      (
        await handle(
          request("ideas", {
            method: "POST",
            key: "a",
            body: { data: { body: "idea" }, user_id: owner },
          }),
        )
      ).status,
    ).toBe(400);
    const plain = request("ideas", { method: "POST", key: "a", body: { data: { body: "idea" } } });
    plain.headers.set("Content-Type", "text/plain");
    expect((await handle(plain)).status).toBe(415);
    const huge = request("ideas", {
      method: "POST",
      key: "a",
      body: { data: { body: "x".repeat(66000) } },
    });
    expect((await handle(huge)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("downloads only the owned completed note's fixed storage path", async () => {
    const { handle, fetcher } = setup();
    fetcher
      .mockReset()
      .mockResolvedValueOnce(
        Response.json({
          item: {
            id: owner,
            source: "upload",
            uploaded_at: "2026-09-16",
            object_path: "../../untrusted",
          },
        }),
      )
      .mockResolvedValueOnce(new Response("%PDF-test"));
    const response = await handle(request(`note-content?id=${owner}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(fetcher.mock.calls[1]![0]).toBe(
      `https://database.example/storage/v1/object/authenticated/class-pdfs/${owner}/${owner}.pdf`,
    );
    expect(await response.text()).toBe("%PDF-test");
  });
  it("does not download pending uploads or allow unscoped file reads", async () => {
    const pending = setup({ item: { id: owner, source: "upload", uploaded_at: null } });
    expect((await pending.handle(request(`note-content?id=${owner}`))).status).toBe(409);
    expect(pending.fetcher).toHaveBeenCalledTimes(1);
    const limited = setup(undefined, 200, {
      ...environment,
      APRAXIA_AGENT_SCOPES: "workspace:read",
    });
    expect((await limited.handle(request(`note-content?id=${owner}`))).status).toBe(403);
    expect(limited.fetcher).not.toHaveBeenCalled();
  });
  it("replays a committed note before consulting a disconnected Drive provider", async () => {
    const original = { item: { id: owner, source: "drive", name: "Lecture", version: "v1" } };
    const { handle, fetcher } = setup({ found: true, result: original });
    const response = await handle(
      request("notes", {
        method: "POST",
        key: "saved-note",
        body: {
          data: { source: "drive", drive_file_id: "file-123", course_id: "math", name: "Lecture" },
        },
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(original);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).p_operation).toBe("replay");
  });
});
