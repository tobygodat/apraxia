import {
  normalizeBrowserSafeSupabaseKey,
  normalizeSecureHttpOrigin,
} from "../../../shared/supabaseEnvironment";

export interface BrowserEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export class BrowserEnvironmentError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[]) {
    super(`Configure the browser-safe environment variables: ${variables.join(", ")}.`);
    this.name = "BrowserEnvironmentError";
    this.variables = variables;
  }
}

type BrowserEnvironmentSource = Record<string, unknown>;

export function parseBrowserEnvironment(source: BrowserEnvironmentSource): BrowserEnvironment {
  const invalid: string[] = [];
  const supabaseUrl = source.VITE_SUPABASE_URL;
  const supabaseAnonKey = source.VITE_SUPABASE_ANON_KEY;
  const validatedUrl = normalizeSecureHttpOrigin(supabaseUrl);
  const validatedAnonKey = normalizeBrowserSafeSupabaseKey(supabaseAnonKey);

  if (!validatedUrl) invalid.push("VITE_SUPABASE_URL");
  if (!validatedAnonKey) {
    invalid.push("VITE_SUPABASE_ANON_KEY");
  }

  if (validatedUrl === null || validatedAnonKey === null) {
    throw new BrowserEnvironmentError(invalid);
  }

  return {
    supabaseUrl: validatedUrl,
    supabaseAnonKey: validatedAnonKey,
  };
}

export function getBrowserEnvironment(): BrowserEnvironment {
  // Read named keys only. Passing the whole environment object makes Vite inline every
  // `VITE_*` variable, including the git metadata Vercel exposes at build time.
  return parseBrowserEnvironment({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  });
}
