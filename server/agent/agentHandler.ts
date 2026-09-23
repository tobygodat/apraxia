import { z } from "zod";
import { object } from "../google/http.js";
import {
  AgentError,
  agentJson,
  authenticateAgent,
  createAgentRpc,
  idempotencyKey,
  invalid,
  requestJson,
  requireScope,
} from "./agentHttp.js";
import { agentDiscovery, agentOpenApi, workspaceBuckets } from "./agentSchema.js";
import { serveAgentProvider } from "./agentProviders.js";

const writeSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
    expected_version: z.string().min(1).max(256).optional(),
  })
  .strict();
const date = z.iso.date();
const querySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).optional(),
    q: z.string().trim().min(1).max(500).optional(),
    updated_since: z.iso.datetime({ offset: true }).optional(),
    completed: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    due_from: date.optional(),
    due_to: date.optional(),
    class_id: z.string().min(1).max(120).optional(),
    project_id: z.uuid().optional(),
  })
  .strict();

/** All routes share one function; account ownership comes only from server configuration. */
export function createAgentHandler(
  dependencies: {
    environment?: Record<string, string | undefined>;
    fetch?: typeof fetch;
  } = {},
) {
  return async (request: Request): Promise<Response> => {
    try {
      const environment = dependencies.environment ?? process.env;
      const session = authenticateAgent(request, environment);
      const url = new URL(request.url);
      const resource = /^\/api\/agent\/v1\/([a-z-]+)$/.exec(url.pathname)?.[1];
      if (!resource) throw new AgentError("not_found", 404, "API endpoint not found.");
      if (!["GET", "POST", "PATCH"].includes(request.method))
        throw new AgentError("method_not_allowed", 405, "Use GET, POST, or PATCH as documented.");
      if (url.searchParams.has("resource")) {
        if (
          url.searchParams.getAll("resource").length !== 1 ||
          url.searchParams.get("resource") !== resource
        )
          invalid();
        url.searchParams.delete("resource");
      }
      const seen = new Set<string>();
      for (const key of url.searchParams.keys()) {
        if (seen.has(key)) invalid("Do not repeat query parameters.");
        seen.add(key);
      }
      if (["meta", "openapi"].includes(resource)) {
        if (request.method !== "GET" || url.search) invalid();
        return agentJson(
          resource === "meta" ? agentDiscovery([...session.scopes]) : agentOpenApi(),
        );
      }
      const rpc = createAgentRpc(environment, request.signal, dependencies.fetch);
      const context = { userId: session.userId, environment, fetch: dependencies.fetch, rpc };
      const workspace = (operation: string, bucket: string, args: Record<string, unknown> = {}) =>
        rpc("agent_workspace", {
          p_user_id: session.userId,
          p_operation: operation,
          p_bucket: bucket,
          ...args,
        });
      const canonicalRequest = (body?: unknown) =>
        new Request(url, {
          method: request.method,
          headers: request.headers,
          signal: request.signal,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

      if (["calendars", "events"].includes(resource)) {
        if (request.method === "PATCH" || (resource !== "events" && request.method !== "GET"))
          throw new AgentError(
            "method_not_allowed",
            405,
            "This endpoint does not support that method.",
          );
        const body = request.method === "POST" ? await requestJson(request) : undefined;
        const mutation = object(body) && ["create", "update"].includes(String(body.action));
        requireScope(session.scopes, mutation ? "calendar:write" : "calendar:read");
        if (mutation) idempotencyKey(request);
        return await serveAgentProvider(canonicalRequest(body), context, resource);
      }

      const isBucket = (workspaceBuckets as readonly string[]).includes(resource);
      if (!isBucket && !["search", "changes"].includes(resource))
        throw new AgentError("not_found", 404, "API endpoint not found.");
      if (request.method === "GET") {
        requireScope(session.scopes, "workspace:read");
        const id = url.searchParams.get("id");
        if (id !== null) {
          if (!isBucket || url.searchParams.size !== 1 || !id || id.length > 120) invalid();
          return agentJson(await workspace("get", resource, { p_id: id }));
        }
        const bucket = url.searchParams.get("bucket");
        url.searchParams.delete("bucket");
        if (
          bucket !== null &&
          (resource !== "search" || !(workspaceBuckets as readonly string[]).includes(bucket))
        )
          invalid();
        const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) invalid();
        const query = parsed.data;
        if (query.due_from && query.due_to && query.due_from > query.due_to) invalid();
        if (resource === "search") {
          if (!query.q) invalid("Search requires q.");
          if (bucket) return agentJson(await workspace("search", bucket, { p_query: query }));
          const results = await Promise.all(
            workspaceBuckets.map(
              async (b) => [b, await workspace("search", b, { p_query: query })] as const,
            ),
          );
          return agentJson({ buckets: Object.fromEntries(results) });
        }
        return agentJson(
          await workspace(resource === "changes" ? "changes" : "list", resource, {
            p_query: query,
          }),
        );
      }
      if (!isBucket) throw new AgentError("method_not_allowed", 405, "This endpoint is read-only.");
      requireScope(session.scopes, "workspace:write");
      const key = idempotencyKey(request);
      const parsed = writeSchema.safeParse(await requestJson(request));
      if (!parsed.success || Object.keys(parsed.data.data).length === 0) invalid();
      const { data, expected_version: expectedVersion } = parsed.data;
      const id = url.searchParams.get("id");
      if (request.method === "PATCH") {
        if (!id || id.length > 120 || url.searchParams.size !== 1)
          invalid("Editing requires an id query parameter.");
        if (!expectedVersion)
          throw new AgentError(
            "precondition_required",
            428,
            "Read the record, then send its version as expected_version.",
          );
      } else if (url.search || expectedVersion !== undefined) invalid();
      return agentJson(
        await workspace(request.method === "POST" ? "create" : "update", resource, {
          p_id: id,
          p_data: data,
          p_request_id: key,
          p_expected_version: expectedVersion ?? null,
        }),
        request.method === "POST" ? 201 : 200,
      );
    } catch (error) {
      if (error instanceof AgentError) {
        const response = agentJson(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
        if (error.status === 401) response.headers.set("WWW-Authenticate", "Bearer");
        return response;
      }
      return agentJson(
        {
          error: {
            code: "unavailable",
            message:
              "The API is temporarily unavailable. Retry writes with the same Idempotency-Key and body.",
          },
        },
        503,
      );
    }
  };
}
