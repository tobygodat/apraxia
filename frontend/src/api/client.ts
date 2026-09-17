// LEGACY RUNTIME ONLY. This client serves the transitional FastAPI application
// (VITE_APRAXIA_RUNTIME=legacy); the cloud app talks to Supabase directly and
// the /api/me and /api/login endpoints do not exist on Vercel.
//
// Thin typed fetch client for the /api JSON API.
// Cookies are sent with every request (credentials: "include") for the session
// auth gate (spec §9). A 401 throws UnauthorizedError so the app can show login.
//
// Server state is fetched with plain fetch for now; TanStack Query is an easy
// later add if caching/mutations get fiddly.

import { ServiceError } from "../lib/serviceError";

const BASE = "/api";

export class UnauthorizedError extends ServiceError {
  constructor() {
    super("unauthorized", "");
    this.name = "UnauthorizedError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    ...options,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new ServiceError("unavailable", `${res.status} ${res.statusText}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  me: () => request<{ authenticated: boolean }>("/me"),
  login: (password: string) =>
    request<{ ok: boolean }>("/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>("/logout", { method: "POST" }),

  list: <T>(resource: string) => request<T[]>(`/${resource}`),
  create: <T>(resource: string, data: unknown) =>
    request<T>(`/${resource}`, { method: "POST", body: JSON.stringify(data) }),
  update: <T>(resource: string, id: number, data: unknown) =>
    request<T>(`/${resource}/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (resource: string, id: number) =>
    request<void>(`/${resource}/${id}`, { method: "DELETE" }),
};
