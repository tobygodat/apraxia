import {
  deploymentEnvironment,
  inspectCloudEnvironment,
} from "../server/env/cloud";

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
      checks,
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
