export const workspaceBuckets = ["todos", "projects", "ideas", "classes", "notes"] as const;

type Schema = Record<string, unknown>;
const text = { type: "string" };
const nullableText = { type: ["string", "null"] };
const nullableId = { ...nullableText, format: "uuid" };
const fields: Record<(typeof workspaceBuckets)[number], Record<string, Schema>> = {
  todos: {
    text: { type: "string", minLength: 1 },
    completed: { type: "boolean" },
    due_date: { ...nullableText, format: "date" },
    due_time: {
      ...nullableText,
      description: "Local wall time HH:mm[:ss]; requires due_date. No timezone conversion.",
    },
    project_id: nullableId,
    class_id: nullableText,
    assignment_type: { type: "string", enum: ["", "Homework", "Quiz", "Reading", "Exam", "Other"] },
  },
  projects: {
    title: { type: "string", minLength: 1 },
    description: text,
    status: { type: "string", enum: ["active", "someday", "completed", "archived"] },
  },
  ideas: { title: nullableText, body: { type: "string", minLength: 1 }, project_id: nullableId },
  classes: { name: { type: "string", minLength: 1 } },
  notes: { name: { type: "string", minLength: 1 }, course_id: text },
};
const requiredFields = {
  todos: ["text"],
  projects: ["title"],
  ideas: ["body"],
  classes: ["id", "name"],
  notes: ["name", "course_id", "source", "drive_file_id"],
};
const filters = {
  todos: ["completed", "due_from", "due_to", "class_id", "project_id"],
  projects: [],
  ideas: ["project_id"],
  classes: [],
  notes: ["class_id"],
};
const commonFilters = ["limit", "offset", "q", "updated_since"];
const retry =
  "Use one unique Idempotency-Key per logical write, shared across all endpoints. Retry the identical method, resource, id, body and key after a transport failure. Reusing a key with different input returns 409. Successful workspace writes replay the original response. Keys have no automatic expiry. Calendar outcome_unknown means the write may have reached Google: inspect the event before further action; never blindly retry with a new key.";

export function agentDiscovery(scopes: string[]) {
  return {
    name: "orbitOS personal agent API",
    version: "1",
    base_path: "/api/agent/v1",
    openapi: "/api/agent/v1/openapi",
    authentication: "Authorization: Bearer <ORBITOS_AGENT_TOKEN>",
    scopes,
    ownership: "One account, fixed by server ORBITOS_AGENT_USER_ID. No caller-supplied owner.",
    workspace: Object.fromEntries(
      workspaceBuckets.map((bucket) => [
        bucket,
        {
          endpoint: `/api/agent/v1/${bucket}`,
          read: "GET list, or GET ?id=<id> for one record; workspace:read",
          create: "POST {data}; workspace:write; Idempotency-Key required",
          edit: "PATCH ?id=<id> {data,expected_version}; workspace:write; Idempotency-Key required",
          writable_fields: fields[bucket],
          required_on_create: requiredFields[bucket],
          create_only_fields:
            bucket === "classes"
              ? { id: text }
              : bucket === "notes"
                ? { source: { const: "drive" }, drive_file_id: text }
                : {},
          filters: [...commonFilters, ...filters[bucket]],
        },
      ]),
    ),
    pagination: {
      default_limit: 50,
      maximum_limit: 100,
      maximum_offset: 100000,
      response:
        "{items,next_offset}; next_offset=null means exhausted. Workspace records ordered by id; concurrent writes can shift pages.",
    },
    search: {
      endpoint: "/api/agent/v1/search?q=<text>&bucket=<optional bucket>",
      description:
        "Case-insensitive substring of record text/title/description/body/name. Without bucket, returns {buckets:{<bucket>:{items,next_offset}}}; each bucket paginates separately. Only common filters in all-bucket search. No PDF contents or Google event search.",
    },
    changes: {
      endpoint: "/api/agent/v1/changes",
      filters: ["limit", "offset", "updated_since"],
      description:
        "Agent write journal only, ordered by created_at then id. Includes before/after snapshots and provider write results. Does not capture dashboard changes or direct Google edits. Poll records/calendar for current truth.",
    },
    dates:
      "due_date is YYYY-MM-DD, due_time is local wall time; overdue dates remain unchanged. updated_since is an exclusive RFC3339 timestamp. Due bounds are inclusive. Do not derive or rewrite due dates through UTC conversion.",
    relationships:
      "Todos have at most one of project_id or class_id. Nonempty assignment_type requires class_id. Relationships must belong to the fixed account. Notes use course_id for the class; list filter is class_id.",
    concurrency:
      "Every workspace item includes opaque version. Read it and send unchanged as expected_version for PATCH. On 409 read again and reconsider the edit. Never compute versions or set lifecycle/owner/order fields.",
    retries: retry,
    providers: {
      calendars: "GET /calendars; calendar:read; connected Google calendars.",
      events:
        "GET /events?sunday=YYYY-MM-DD; calendar:read; Sunday-start week in configured calendar timezone. POST detail command uses calendar:read; POST create/update uses calendar:write and Idempotency-Key. Update requires current Google etag. See OpenAPI for command bodies.",
      drive_files:
        "GET /drive-files?folder=root&page=<optional nextPage>; files:read; folders and PDFs only.",
      note_content:
        "GET /note-content?id=<saved note UUID>; workspace:read and files:read; application/pdf stream. Includes saved uploaded and Drive PDFs. No extracted text endpoint.",
    },
    limits:
      "Workspace JSON bodies <=64 KiB; event commands <=16 KiB. No deletion, raw database access, credential access, PDF byte upload, profile/settings writes, or legacy backup access. Creating notes supports Drive PDFs only and also requires files:read.",
  };
}

export function agentOpenApi() {
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const parameter = (name: string, schema: Schema, description = "", required = false) => ({
    name,
    in: "query",
    required,
    description,
    schema,
  });
  const parameters: Record<string, Schema> = {
    limit: parameter("limit", { type: "integer", minimum: 1, maximum: 100, default: 50 }),
    offset: parameter("offset", { type: "integer", minimum: 0, maximum: 100000, default: 0 }),
    q: parameter(
      "q",
      { type: "string", minLength: 1, maxLength: 500 },
      "Case-insensitive substring search over saved record metadata.",
    ),
    updated_since: parameter(
      "updated_since",
      { type: "string", format: "date-time" },
      "Exclusive updated_at cutoff; changes uses created_at.",
    ),
    completed: parameter("completed", { type: "string", enum: ["true", "false"] }),
    due_from: parameter(
      "due_from",
      { type: "string", format: "date" },
      "Inclusive minimum due_date.",
    ),
    due_to: parameter("due_to", { type: "string", format: "date" }, "Inclusive maximum due_date."),
    class_id: parameter("class_id", text),
    project_id: parameter("project_id", { type: "string", format: "uuid" }),
  };
  const key = {
    name: "Idempotency-Key",
    in: "header",
    required: true,
    schema: { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,200}$" },
    description: retry,
  };
  const json = (schema: Schema) => ({ "application/json": { schema } });
  const response = (schema: Schema) => ({ description: "Success", content: json(schema) });
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 405, 409, 413, 415, 428, 502, 503].map((status) => [
      String(status),
      {
        description: (
          {
            400: "Invalid input",
            401: "Invalid bearer token",
            403: "Missing scope",
            404: "Record not found",
            405: "Unsupported method",
            409: "Version/idempotency conflict, reconnect required, or unknown provider write outcome",
            413: "Body too large",
            415: "JSON required",
            428: "expected_version required",
            502: "Provider unavailable",
            503: "Configuration or service unavailable",
          } as Record<number, string>
        )[status],
        content: json(ref("Error")),
      },
    ]),
  );
  const operation = (
    id: string,
    summary: string,
    scopes: string[],
    schema: Schema,
    extra: Schema = {},
  ) => ({
    operationId: id,
    summary,
    "x-required-scopes": scopes,
    responses: { "200": response(schema), ...errors },
    ...extra,
  });
  const body = (schema: Schema) => ({ required: true, content: json(schema) });
  const object = (properties: Record<string, Schema>, required: string[] = []) => ({
    type: "object",
    additionalProperties: false,
    properties,
    required,
  });
  const schemas: Record<string, Schema> = {
    Error: object({ error: object({ code: text, message: text }, ["code", "message"]) }, ["error"]),
    Record: {
      type: "object",
      required: ["id", "version"],
      properties: {
        id: text,
        version: { type: "string", description: "Opaque optimistic concurrency token." },
        created_at: { type: "string", format: "date-time" },
        updated_at: { type: "string", format: "date-time" },
      },
      additionalProperties: true,
    },
    Item: object({ item: ref("Record") }, ["item"]),
    Page: object(
      {
        items: { type: "array", items: ref("Record") },
        next_offset: { type: ["integer", "null"] },
      },
      ["items", "next_offset"],
    ),
    ChangePage: object(
      {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: text,
              actor: text,
              bucket: text,
              operation: text,
              record_id: nullableText,
              request_id: text,
              before_data: { type: ["object", "null"] },
              after_data: { type: ["object", "null"] },
              created_at: { type: "string", format: "date-time" },
            },
          },
        },
        next_offset: { type: ["integer", "null"] },
      },
      ["items", "next_offset"],
    ),
  };
  const paths: Record<string, unknown> = {};
  for (const bucket of workspaceBuckets) {
    const createFields = {
      ...fields[bucket],
      ...(bucket === "classes"
        ? { id: text }
        : bucket === "notes"
          ? { source: { const: "drive" }, drive_file_id: text }
          : {}),
    };
    schemas[`${bucket}Create`] = object(createFields, requiredFields[bucket]);
    schemas[`${bucket}Edit`] = { ...object(fields[bucket]), minProperties: 1 };
    paths[`/${bucket}`] = {
      get: operation(
        `read_${bucket}`,
        `List or read ${bucket}`,
        ["workspace:read"],
        { oneOf: [ref("Page"), ref("Item")] },
        {
          description:
            "With id, no other query parameters are allowed. List returns active records ordered by id.",
          parameters: [
            parameter("id", text),
            ...[...commonFilters, ...filters[bucket]].map((name) => parameters[name]),
          ],
        },
      ),
      post: operation(
        `create_${bucket}`,
        `Create ${bucket} record`,
        bucket === "notes" ? ["workspace:write", "files:read"] : ["workspace:write"],
        ref("Item"),
        {
          parameters: [key],
          requestBody: body(object({ data: ref(`${bucket}Create`) }, ["data"])),
          responses: { "201": response(ref("Item")), ...errors },
        },
      ),
      patch: operation(
        `edit_${bucket}`,
        `Edit ${bucket} record`,
        ["workspace:write"],
        ref("Item"),
        {
          parameters: [parameter("id", text, "Existing record id", true), key],
          requestBody: body(
            object(
              {
                data: ref(`${bucket}Edit`),
                expected_version: { type: "string", minLength: 1, maxLength: 256 },
              },
              ["data", "expected_version"],
            ),
          ),
        },
      ),
    };
  }
  paths["/meta"] = {
    get: operation("discovery", "Discover operations and configured scopes", [], {
      type: "object",
    }),
  };
  paths["/openapi"] = {
    get: operation("openapi", "Read this OpenAPI document", [], { type: "object" }),
  };
  paths["/search"] = {
    get: operation(
      "search",
      "Search saved workspace metadata",
      ["workspace:read"],
      {
        oneOf: [
          ref("Page"),
          object({ buckets: { type: "object", additionalProperties: ref("Page") } }, ["buckets"]),
        ],
      },
      {
        description:
          "No bucket means one independent page per bucket. Use only common filters in that mode. Bucket-specific filters are identical to that bucket list endpoint. No PDF full-text or Google search.",
        parameters: [
          parameter("bucket", { type: "string", enum: workspaceBuckets }),
          ...Object.entries(parameters).map(([name, p]) =>
            name === "q" ? { ...p, required: true } : p,
          ),
        ],
      },
    ),
  };
  paths["/changes"] = {
    get: operation(
      "changes",
      "Read agent-only write journal",
      ["workspace:read"],
      ref("ChangePage"),
      {
        description:
          "Not an account-wide change feed. Poll bucket records for dashboard changes and events for Google edits.",
        parameters: [parameters.limit, parameters.offset, parameters.updated_since],
      },
    ),
  };
  const eventIdentity = {
    calendarId: text,
    eventId: text,
    scope: { type: "string", enum: ["instance", "series"] },
  };
  schemas.EventValues = object(
    {
      title: text,
      location: text,
      timeZone: { type: "string", description: "IANA timezone" },
      timing: {
        oneOf: [
          object(
            {
              kind: { const: "all_day" },
              start: { type: "string", format: "date" },
              end: { type: "string", format: "date", description: "Exclusive end date" },
            },
            ["kind", "start", "end"],
          ),
          object(
            {
              kind: { const: "timed" },
              start: { type: "string", format: "date-time" },
              end: { type: "string", format: "date-time" },
            },
            ["kind", "start", "end"],
          ),
        ],
      },
      recurrence: {
        type: ["array", "null"],
        items: text,
        description:
          "null preserves current rules; [] clears recurrence. Supported RRULE frequency DAILY/WEEKLY/MONTHLY/YEARLY, optional INTERVAL, weekday BYDAY and COUNT/UNTIL.",
      },
    },
    ["title", "location", "timeZone", "timing", "recurrence"],
  );
  schemas.EventCommand = {
    oneOf: [
      object({ action: { const: "detail" }, ...eventIdentity }, [
        "action",
        "calendarId",
        "eventId",
        "scope",
      ]),
      object({ action: { const: "create" }, calendarId: text, values: ref("EventValues") }, [
        "action",
        "calendarId",
        "values",
      ]),
      object(
        {
          action: { const: "update" },
          ...eventIdentity,
          etag: text,
          destinationCalendarId: text,
          values: ref("EventValues"),
        },
        ["action", "calendarId", "eventId", "scope", "etag", "destinationCalendarId", "values"],
      ),
    ],
  };
  paths["/calendars"] = {
    get: operation("calendars", "List connected Google calendars", ["calendar:read"], {
      type: "object",
    }),
  };
  paths["/events"] = {
    get: operation(
      "events_week",
      "Read a Sunday-start calendar week",
      ["calendar:read"],
      { type: "object" },
      {
        parameters: [
          parameter(
            "sunday",
            { type: "string", format: "date" },
            "Must be a Sunday. Uses configured calendar timezone.",
            true,
          ),
        ],
      },
    ),
    post: operation(
      "event_command",
      "Read detail, create, or update a Google event",
      [],
      { type: "object" },
      {
        description:
          "detail requires calendar:read. create/update require calendar:write and Idempotency-Key. Event bodies are limited to 16 KiB. Creation generates eventId from the key and returns it. Updates require the latest detail etag. No deletion. On outcome_unknown inspect Google state before another write.",
        parameters: [
          {
            ...key,
            required: false,
            description: "Required for create and update; not needed for detail. " + retry,
          },
        ],
        requestBody: body(ref("EventCommand")),
      },
    ),
  };
  paths["/drive-files"] = {
    get: operation(
      "drive_files",
      "Browse connected Drive folders and PDFs",
      ["files:read"],
      { type: "object" },
      {
        parameters: [
          parameter("folder", { type: "string", default: "root" }),
          parameter("page", { type: "string", maxLength: 2048 }, "Prior nextPage"),
        ],
      },
    ),
  };
  paths["/note-content"] = {
    get: operation(
      "note_content",
      "Download a saved note PDF",
      ["workspace:read", "files:read"],
      {},
      {
        parameters: [parameter("id", { type: "string", format: "uuid" }, "Saved note id", true)],
        responses: {
          "200": {
            description: "PDF bytes",
            content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
          },
          ...errors,
        },
      },
    ),
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "orbitOS personal agent API",
      version: "1.0.0",
      description:
        "Authenticated API for one server-bound account. Date-only due dates and opaque versions must be preserved. " +
        retry,
    },
    servers: [{ url: "/api/agent/v1" }],
    security: [{ AgentBearer: [] }],
    paths,
    components: {
      securitySchemes: {
        AgentBearer: {
          type: "http",
          scheme: "bearer",
          description: "Dedicated agent token, never a Supabase key.",
        },
      },
      schemas,
    },
  };
}
