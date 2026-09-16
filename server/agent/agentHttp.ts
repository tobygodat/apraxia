import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizeSecureHttpOrigin } from "../../shared/supabaseEnvironment.js";
import { calendarHttp } from "../calendar/calendarHttp.js";

export const agentScopes = [
  "workspace:read",
  "workspace:write",
  "calendar:read",
  "calendar:write",
  "files:read",
] as const;
export type AgentScope = (typeof agentScopes)[number];
export class AgentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export function agentJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: privateHeaders });
}
export function invalid(
  message = "Check the API documentation for valid fields and values.",
): never {
  throw new AgentError("invalid_request", 400, message);
}
export function authenticateAgent(request: Request, env: Record<string, string | undefined>) {
  const token = env.ORBITOS_AGENT_TOKEN;
  const userId = env.ORBITOS_AGENT_USER_ID;
  const scopes = (env.ORBITOS_AGENT_SCOPES ?? "workspace:read").split(",").map((s) => s.trim());
  if (
    !token ||
    !/^[A-Za-z0-9_-]{43,256}$/.test(token) ||
    !z.uuid().safeParse(userId).success ||
    scopes.some((s) => !agentScopes.includes(s as AgentScope))
  ) {
    throw new AgentError("not_configured", 503, "Agent API configuration is incomplete.");
  }
  const supplied = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43,256})$/i.exec(supplied);
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!match || !timingSafeEqual(digest(match[1]!), digest(token))) {
    throw new AgentError("unauthenticated", 401, "Supply a valid agent bearer token.");
  }
  return { userId: userId!, scopes: new Set(scopes as AgentScope[]) };
}
export function requireScope(scopes: Set<AgentScope>, scope: AgentScope) {
  if (!scopes.has(scope)) throw new AgentError("forbidden", 403, `This token requires ${scope}.`);
}
export function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key");
  if (!value || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value))
    invalid(
      "Supply an Idempotency-Key of 1–200 letters, digits, dots, colons, underscores or hyphens.",
    );
  return value;
}
export async function requestJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type") ?? ""))
    throw new AgentError("unsupported_media_type", 415, "Send application/json.");
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 64 * 1024))
    throw new AgentError("payload_too_large", 413, "JSON requests must be at most 64 KiB.");
  try {
    return await calendarHttp.readBoundedJson(
      new Response(request.body),
      64 * 1024,
      request.signal,
    );
  } catch {
    invalid("Send a valid JSON body of at most 64 KiB.");
  }
}
export function createAgentRpc(
  env: Record<string, string | undefined>,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const origin = normalizeSecureHttpOrigin(env.SUPABASE_URL ?? "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key || key.startsWith("sb_publishable_"))
    throw new AgentError("not_configured", 503, "Agent storage configuration is incomplete.");
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  return async (name: string, body: Record<string, unknown>): Promise<unknown> => {
    if (!["agent_workspace", "agent_provider_write"].includes(name)) invalid();
    const { response, value } = await calendarHttp.boundedFetchJson(
      `${origin}/rest/v1/rpc/${name}`,
      { method: "POST", headers, signal, body: JSON.stringify(body) },
      fetcher,
      4 * 1024 * 1024,
    );
    if (!response.ok) {
      const code = value && typeof value === "object" && "code" in value ? value.code : null;
      if (code === "P0002") throw new AgentError("not_found", 404, "Record not found.");
      if (code === "40001" || code === "23505")
        throw new AgentError(
          "conflict",
          409,
          "The record changed or this Idempotency-Key was used with different input. Read the current record before a new edit.",
        );
      if (["22023", "22007", "22008", "22P02", "23502", "23503", "23514"].includes(String(code)))
        invalid("Invalid fields, dates, or record relationships. Check the API documentation.");
      throw new AgentError(
        "storage_unavailable",
        503,
        "Storage is temporarily unavailable. Retry writes with the same Idempotency-Key and body.",
      );
    }
    return value;
  };
}
