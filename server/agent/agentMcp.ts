import { randomUUID } from "node:crypto";
import { object } from "../google/http.js";
import { createAgentHandler } from "./agentHandler.js";
import {
  AgentError,
  agentJson,
  authenticateAgent,
  requestJson,
  type AgentScope,
} from "./agentHttp.js";
import { agentOpenApi, workspaceBuckets } from "./agentSchema.js";

const protocolVersions = ["2025-11-25", "2025-06-18", "2025-03-26"];
const instructions =
  "Live access to one apraxia account: tasks, projects, ideas, classes, saved notes, Google Calendar weeks and Drive PDFs. Call guide once for writable fields, filters and rules. due_date is a plain YYYY-MM-DD and due_time is local wall time: never convert them through UTC or move overdue dates. Before update_record, read the record and pass its version unchanged as expected_version; on a conflict read again and reconsider. Lists page with limit/offset: follow next_offset until null. Nothing can be deleted. A tool error never grants permission to overwrite or recreate data.";

type Schema = Record<string, unknown>;
type Plan = {
  resource: string;
  method?: "POST" | "PATCH";
  query?: Record<string, unknown>;
  body?: unknown;
  key?: unknown;
};
type Tool = {
  name: string;
  title: string;
  description: string;
  scopes: AgentScope[];
  write?: boolean;
  properties: Record<string, Schema>;
  required?: string[];
  plan: (args: Record<string, unknown>) => Plan;
};

class InvalidParams extends Error {}
function bucketOf(args: Record<string, unknown>): string {
  if (!(workspaceBuckets as readonly string[]).includes(args.bucket as string))
    throw new InvalidParams(`bucket must be one of ${workspaceBuckets.join(", ")}.`);
  return args.bucket as string;
}
function without(args: Record<string, unknown>, ...names: string[]) {
  return Object.fromEntries(Object.entries(args).filter(([name]) => !names.includes(name)));
}

const text = { type: "string" };
const bucket = { type: "string", enum: workspaceBuckets };
const day = { type: "string", format: "date", description: "YYYY-MM-DD" };
const paging = {
  limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  offset: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
  updated_since: {
    type: "string",
    format: "date-time",
    description: "Exclusive RFC3339 cutoff.",
  },
};
const filters = {
  ...paging,
  completed: { type: "boolean", description: "todos only" },
  due_from: { ...day, description: "todos only; inclusive" },
  due_to: { ...day, description: "todos only; inclusive" },
  class_id: { ...text, description: "todos and notes" },
  project_id: { ...text, format: "uuid", description: "todos and ideas" },
};
const idempotencyKey = {
  ...text,
  pattern: "^[A-Za-z0-9_.:-]{1,200}$",
  description:
    "Optional. One unique key per logical write; generated when omitted. To retry after a transport failure, resend the identical arguments with the same key.",
};
const eventIdentity = {
  calendarId: text,
  eventId: text,
  scope: { type: "string", enum: ["instance", "series"] },
};

const tools: Tool[] = [
  {
    name: "guide",
    title: "apraxia guide",
    description:
      "Writable fields, required fields, filters, date, relationship and retry rules, and the scopes granted to this connection. Read once before writing.",
    scopes: [],
    properties: {},
    plan: () => ({ resource: "meta" }),
  },
  {
    name: "list_records",
    title: "List records",
    description:
      "List active todos, projects, ideas, classes or notes, ordered by id. Returns {items,next_offset}. q is a case-insensitive substring match.",
    scopes: ["workspace:read"],
    properties: { bucket, q: text, ...filters },
    required: ["bucket"],
    plan: (args) => ({ resource: bucketOf(args), query: without(args, "bucket") }),
  },
  {
    name: "get_record",
    title: "Read one record",
    description: "Read one record and its current version.",
    scopes: ["workspace:read"],
    properties: { bucket, id: text },
    required: ["bucket", "id"],
    plan: (args) => ({ resource: bucketOf(args), query: { id: args.id } }),
  },
  {
    name: "search",
    title: "Search records",
    description:
      "Case-insensitive substring search of saved text, titles, bodies, descriptions and names. Without bucket, returns one independent page per bucket and accepts only limit, offset and updated_since. Does not search PDF contents or calendar events.",
    scopes: ["workspace:read"],
    properties: { q: text, bucket, ...filters },
    required: ["q"],
    plan: (args) => {
      if (args.bucket !== undefined) bucketOf(args);
      return { resource: "search", query: args };
    },
  },
  {
    name: "list_changes",
    title: "Agent write journal",
    description:
      "Writes made through the agent API and this connector, with before/after data. Not a feed of dashboard or Google changes.",
    scopes: ["workspace:read"],
    properties: paging,
    plan: (args) => ({ resource: "changes", query: args }),
  },
  {
    name: "create_record",
    title: "Create a record",
    description: "Create a todo, project, idea, class or note. data holds the fields from guide.",
    scopes: ["workspace:write"],
    write: true,
    properties: { bucket, data: { type: "object" }, idempotency_key: idempotencyKey },
    required: ["bucket", "data"],
    plan: (args) => ({
      resource: bucketOf(args),
      method: "POST",
      body: { data: args.data },
      key: args.idempotency_key,
    }),
  },
  {
    name: "update_record",
    title: "Edit a record",
    description:
      "Edit fields of one record. expected_version must be the version from a fresh read. Use null to clear nullable fields.",
    scopes: ["workspace:write"],
    write: true,
    properties: {
      bucket,
      id: text,
      data: { type: "object", minProperties: 1 },
      expected_version: text,
      idempotency_key: idempotencyKey,
    },
    required: ["bucket", "id", "data", "expected_version"],
    plan: (args) => ({
      resource: bucketOf(args),
      method: "PATCH",
      query: { id: args.id },
      body: { data: args.data, expected_version: args.expected_version },
      key: args.idempotency_key,
    }),
  },
  {
    name: "list_calendars",
    title: "List calendars",
    description: "Connected Google calendars.",
    scopes: ["calendar:read"],
    properties: {},
    plan: () => ({ resource: "calendars" }),
  },
  {
    name: "get_week_events",
    title: "Read a calendar week",
    description:
      "Google Calendar events for one Sunday-start week in the configured calendar timezone. q filters by title or location within that week.",
    scopes: ["calendar:read"],
    properties: { sunday: { ...day, description: "Must be a Sunday." }, q: text },
    required: ["sunday"],
    plan: (args) => ({ resource: "events", query: args }),
  },
  {
    name: "get_event",
    title: "Read one event",
    description: "Full detail of one Google event, including the etag required to update it.",
    scopes: ["calendar:read"],
    properties: eventIdentity,
    required: ["calendarId", "eventId", "scope"],
    plan: (args) => ({ resource: "events", method: "POST", body: { ...args, action: "detail" } }),
  },
  {
    name: "write_event",
    title: "Create or update an event",
    description:
      "Create or update a Google Calendar event. update also requires eventId, scope, the etag from get_event, and destinationCalendarId. Timed events use RFC3339 instants; all-day events use an exclusive end date. If the result is outcome_unknown, Google may have committed the write: inspect the event before acting again.",
    scopes: ["calendar:write"],
    write: true,
    properties: {
      action: { type: "string", enum: ["create", "update"] },
      ...eventIdentity,
      etag: text,
      destinationCalendarId: text,
      values: agentOpenApi().components.schemas.EventValues!,
      idempotency_key: idempotencyKey,
    },
    required: ["action", "calendarId", "values"],
    plan: (args) => {
      if (args.action !== "create" && args.action !== "update")
        throw new InvalidParams("action must be create or update.");
      return {
        resource: "events",
        method: "POST",
        body: without(args, "idempotency_key"),
        key: args.idempotency_key,
      };
    },
  },
  {
    name: "list_drive_files",
    title: "Browse Drive",
    description: "Folders and PDFs in the connected Google Drive. Returns {files,nextPage}.",
    scopes: ["files:read"],
    properties: { folder: { ...text, default: "root" }, page: text },
    plan: (args) => ({ resource: "drive-files", query: args }),
  },
];

/** MCP (Streamable HTTP, stateless) over the agent API: every tool call is an agent API request. */
export function createAgentMcpHandler(
  dependencies: {
    environment?: Record<string, string | undefined>;
    fetch?: typeof fetch;
  } = {},
) {
  const agent = createAgentHandler(dependencies);
  return async (request: Request): Promise<Response> => {
    let id: unknown = null;
    const result = (value: unknown) => agentJson({ jsonrpc: "2.0", id, result: value });
    const failure = (code: number, message: string, status = 200) =>
      agentJson({ jsonrpc: "2.0", id, error: { code, message } }, status);
    try {
      const session = authenticateAgent(request, dependencies.environment ?? process.env);
      if (request.method !== "POST") {
        const response = agentJson(
          { error: { code: "method_not_allowed", message: "Send MCP messages with POST." } },
          405,
        );
        response.headers.set("Allow", "POST");
        return response;
      }
      const message = await requestJson(request).catch(() => null);
      if (!object(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string")
        return failure(-32600, "Send one JSON-RPC 2.0 message of at most 64 KiB.", 400);
      if (!("id" in message)) return new Response(null, { status: 202 });
      id = message.id;
      const params = object(message.params) ? message.params : {};
      const granted = tools.filter((tool) => tool.scopes.every((s) => session.scopes.has(s)));

      if (message.method === "ping") return result({});
      if (message.method === "initialize")
        return result({
          protocolVersion: protocolVersions.includes(params.protocolVersion as string)
            ? params.protocolVersion
            : protocolVersions[0],
          capabilities: { tools: {} },
          serverInfo: { name: "apraxia", title: "apraxia", version: "1.0.0" },
          instructions,
        });
      if (message.method === "tools/list")
        return result({
          tools: granted.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: {
              type: "object",
              properties: tool.properties,
              required: tool.required ?? [],
              additionalProperties: false,
            },
            annotations: {
              readOnlyHint: !tool.write,
              destructiveHint: false,
              openWorldHint: false,
            },
          })),
        });
      if (message.method !== "tools/call") return failure(-32601, "Method not found.");

      const tool = granted.find((candidate) => candidate.name === params.name);
      if (!tool) return failure(-32602, "Unknown tool, or this connection lacks its scope.");
      const plan = tool.plan(object(params.arguments) ? params.arguments : {});
      const url = new URL(`/api/agent/v1/${plan.resource}`, request.url);
      for (const [name, value] of Object.entries(plan.query ?? {})) {
        if (value === undefined || value === null) continue;
        if (!["string", "number", "boolean"].includes(typeof value))
          throw new InvalidParams(`${name} must be a string, number or boolean.`);
        url.searchParams.set(name, String(value));
      }
      const headers = new Headers({ Authorization: request.headers.get("authorization") ?? "" });
      if (plan.body !== undefined) headers.set("Content-Type", "application/json");
      if (tool.write)
        headers.set(
          "Idempotency-Key",
          typeof plan.key === "string" ? plan.key : `mcp-${randomUUID()}`,
        );
      const response = await agent(
        new Request(url, {
          method: plan.method ?? "GET",
          headers,
          signal: request.signal,
          ...(plan.body === undefined ? {} : { body: JSON.stringify(plan.body) }),
        }),
      );
      return result({
        content: [{ type: "text", text: await response.text() }],
        isError: !response.ok,
      });
    } catch (error) {
      if (error instanceof InvalidParams) return failure(-32602, error.message);
      const known = error instanceof AgentError;
      const response = agentJson(
        {
          error: known
            ? { code: error.code, message: error.message }
            : { code: "unavailable", message: "The connector is temporarily unavailable." },
        },
        known ? error.status : 503,
      );
      if (response.status === 401) response.headers.set("WWW-Authenticate", "Bearer");
      return response;
    }
  };
}
