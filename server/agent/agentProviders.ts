import { createHash } from "node:crypto";
import { eventCommandSchema } from "../../shared/calendarEventContract.js";
import { createCalendarHandler } from "../calendar/calendarHandlers.js";
import { createDriveHandler } from "../drive/driveHandlers.js";

interface AgentProviderContext {
  userId: string;
  environment: Record<string, string | undefined>;
  fetch?: typeof fetch;
  rpc: (name: string, body: Record<string, unknown>) => Promise<unknown>;
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const error = (code: string, message: string, status: number) =>
  json({ error: { code, message } }, status);
const unknownOutcome = () =>
  error(
    "outcome_unknown",
    "This write may have reached Google. Read the event before taking further action; do not retry with a new key.",
    409,
  );
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Called only after the agent boundary verifies the credential, owner, scope and body limit. */
export async function serveAgentProvider(
  request: Request,
  context: AgentProviderContext,
  resource: string,
): Promise<Response> {
  if (!["calendars", "events", "drive-files", "drive-pdf"].includes(resource))
    return error("not_found", "Unknown provider resource.", 404);
  if (request.method !== "GET" && !(resource === "events" && request.method === "POST"))
    return error("method_not_allowed", "This method is unavailable.", 405);

  // Construct fresh headers: neither the agent bearer nor a caller identity is sent upstream.
  const url = new URL(`/api/agent-provider/${resource}`, context.environment.APP_URL);
  url.search = new URL(request.url).search;
  const headers = new Headers();
  let body: string | undefined;
  let payload: Record<string, unknown> | undefined;
  let requestId: string | undefined;
  let createdEventId: string | undefined;
  if (request.method === "POST") {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return error("invalid_request", "Expected a JSON event command.", 400);
    }
    if (!record(input) || !["detail", "create", "update"].includes(String(input.action)))
      return error(
        "invalid_request",
        "Only detail, create and update event commands are available.",
        400,
      );
    if (input.action !== "detail") {
      requestId = request.headers.get("idempotency-key") ?? undefined;
      if (!requestId || !/^[A-Za-z0-9._:-]{1,200}$/.test(requestId))
        return error(
          "invalid_request",
          "An Idempotency-Key of 1–200 letters, numbers, dots, colons, underscores or hyphens is required.",
          400,
        );
    }
    if (input.action === "create") {
      // Google accepts 32 base32hex characters. Hex is a valid subset.
      createdEventId = createHash("sha256")
        .update(`${context.userId}\n${requestId}`)
        .digest("hex")
        .slice(0, 32);
      input = { ...input, eventId: createdEventId };
    }
    const parsed = eventCommandSchema.safeParse(input);
    if (!parsed.success)
      return error(
        "invalid_event",
        "The event command is invalid. Updates require the current etag.",
        400,
      );
    body = JSON.stringify(parsed.data);
    payload = { resource, command: parsed.data };
    headers.set("Content-Type", "application/json");
    headers.set("Origin", url.origin);
    headers.set("Sec-Fetch-Site", "same-origin");
  }

  if (requestId) {
    const reservation = await context.rpc("agent_provider_write", {
      p_user_id: context.userId,
      p_operation: "begin",
      p_request_id: requestId,
      p_payload: payload,
      p_result: null,
    });
    if (!record(reservation)) return unknownOutcome();
    if (
      reservation.state === "completed" &&
      record(reservation.result) &&
      typeof reservation.result.status === "number"
    )
      return json(reservation.result.body, reservation.result.status);
    if (reservation.state !== "new") return unknownOutcome();
  }

  const internal = new Request(url, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  });
  const dependencies = {
    environment: context.environment,
    fetch: context.fetch,
    verifiedSession: { userId: context.userId },
  };
  let response =
    resource === "events" || resource === "calendars"
      ? await createCalendarHandler(resource, dependencies)(internal)
      : await createDriveHandler(
          resource === "drive-pdf" ? "pdf" : "files",
          dependencies,
        )(internal);
  if (requestId) {
    // A transport/server failure cannot prove that Google did not commit a write.
    if (response.status >= 500) response = unknownOutcome();
    let result = (await response.json()) as unknown;
    if (response.ok && createdEventId && record(result))
      result = { ...result, eventId: createdEventId };
    try {
      await context.rpc("agent_provider_write", {
        p_user_id: context.userId,
        p_operation: "finish",
        p_request_id: requestId,
        p_payload: payload,
        p_result: { status: response.status, body: result },
      });
    } catch {
      return unknownOutcome();
    }
    return json(result, response.status);
  }
  return response;
}
