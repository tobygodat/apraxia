function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

/**
 * Supabase and application base URLs are origins, not arbitrary URLs. Keep
 * local HTTP development available while requiring transport security for
 * every non-loopback deployment.
 */
export function normalizeSecureHttpOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;

  try {
    const parsed = new URL(value.trim());
    const usesSecureTransport =
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname));
    const isOriginOnly =
      (parsed.pathname === "" || parsed.pathname === "/") &&
      parsed.search === "" &&
      parsed.hash === "";

    if (
      !usesSecureTransport ||
      !isOriginOnly ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

function decodeJwtRole(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const base64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const payload = JSON.parse(globalThis.atob(base64)) as unknown;

    if (
      payload !== null &&
      typeof payload === "object" &&
      "role" in payload &&
      typeof payload.role === "string"
    ) {
      return payload.role;
    }
  } catch {
    // Invalid opaque values remain the provider's validation responsibility.
  }

  return null;
}

export function normalizeBrowserSafeSupabaseKey(
  value: unknown,
): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;

  const normalized = value.trim();
  if (normalized.toLowerCase().startsWith("sb_secret_")) return null;

  const jwtRole = decodeJwtRole(normalized);
  return jwtRole === null || jwtRole === "anon" ? normalized : null;
}
