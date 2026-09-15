import { deploymentEnvironment, inspectCloudEnvironment } from "../server/env/cloud.js";

type EnvironmentSource = Record<string, string | undefined>;

export function createHealthResponse(
  source: EnvironmentSource = process.env,
  now: Date = new Date(),
): Response {
  const checks = inspectCloudEnvironment(source);
  const status = !checks.application.configured
    ? "not_configured"
    : checks.calendar.status === "invalid"
      ? "degraded"
      : "ok";

  return Response.json(
    {
      service: "orbitos-cloud",
      runtime: "vercel-function",
      status,
      environment: deploymentEnvironment(source),
      // This endpoint is unauthenticated. It reports whether each area is
      // configured, never which variables are missing or invalid: those names
      // describe the deployment's internals to anyone who asks. Operators read
      // the exact variable names from the deployment logs instead.
      checks: {
        application: { configured: checks.application.configured },
        calendar: {
          configured: checks.calendar.configured,
          status: checks.calendar.status,
        },
      },
      timestamp: now.toISOString(),
    },
    {
      status: checks.application.configured ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export default {
  fetch(): Response {
    return createHealthResponse();
  },
};
