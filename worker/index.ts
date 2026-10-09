import agent from "../api/agent/v1/[resource].js";
import calendar from "../api/calendar/[action].js";
import { createHealthResponse } from "../api/health.js";
import mcp from "../api/mcp.js";

interface WorkerEnvironment {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

type Handler = (request: Request) => Response | Promise<Response>;

// The same headers vercel.json set on every response. The worker runs first for
// every path, so static assets and API responses both pass through here.
const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function routeApi(pathname: string): Handler | null {
  if (pathname === "/api/health")
    return () => createHealthResponse(process.env, new Date(), "cloudflare-worker");
  if (pathname === "/api/mcp") return (request) => mcp.fetch(request);
  if (pathname.startsWith("/api/agent/v1/")) return (request) => agent.fetch(request);
  if (pathname.startsWith("/api/calendar/")) return (request) => calendar.fetch(request);
  return null;
}

function withSecurityHeaders(response: Response, pathname: string): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) secured.headers.set(name, value);
  if (pathname === "/calendar/callback") secured.headers.set("Cache-Control", "no-store");
  return secured;
}

export default {
  async fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    const { pathname } = new URL(request.url);
    const isApi = pathname === "/api" || pathname.startsWith("/api/");
    const handler = isApi ? routeApi(pathname) : null;
    const response = handler
      ? await handler(request)
      : isApi
        ? new Response(null, { status: 404 })
        : await env.ASSETS.fetch(request);
    return withSecurityHeaders(response, pathname);
  },
};
