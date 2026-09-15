import { z } from "zod";
import { isCanonicalEncryptionKey } from "../calendar/tokenEncryption.js";

import {
  normalizeBrowserSafeSupabaseKey,
  normalizeSecureHttpOrigin,
} from "../../shared/supabaseEnvironment.js";

type EnvironmentSource = Record<string, string | undefined>;

const requiredText = z.string().trim().min(1);
const secureOrigin = z.string().transform((value, context) => {
  const normalized = normalizeSecureHttpOrigin(value);
  if (normalized === null) {
    context.addIssue({
      code: "custom",
      message: "Expected an HTTPS origin or a loopback HTTP origin.",
    });
    return z.NEVER;
  }

  return normalized;
});
const browserSafePublicKey = z.string().transform((value, context) => {
  const normalized = normalizeBrowserSafeSupabaseKey(value);
  if (normalized === null) {
    context.addIssue({
      code: "custom",
      message: "Expected a browser-safe Supabase public key.",
    });
    return z.NEVER;
  }

  return normalized;
});

const applicationEnvironmentSchema = z
  .object({
    VITE_SUPABASE_URL: secureOrigin,
    VITE_SUPABASE_ANON_KEY: browserSafePublicKey,
    SUPABASE_URL: secureOrigin,
    SUPABASE_ANON_KEY: browserSafePublicKey,
    SUPABASE_SERVICE_ROLE_KEY: requiredText,
    APP_URL: secureOrigin,
  })
  .superRefine((environment, context) => {
    if (environment.VITE_SUPABASE_URL !== environment.SUPABASE_URL) {
      for (const variable of ["SUPABASE_URL", "VITE_SUPABASE_URL"] as const) {
        context.addIssue({
          code: "custom",
          message: "Browser and server Supabase URLs must match.",
          path: [variable],
        });
      }
    }

    if (environment.VITE_SUPABASE_ANON_KEY !== environment.SUPABASE_ANON_KEY) {
      for (const variable of ["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"] as const) {
        context.addIssue({
          code: "custom",
          message: "Browser and server Supabase public keys must match.",
          path: [variable],
        });
      }
    }

    if (environment.VITE_SUPABASE_ANON_KEY === environment.SUPABASE_SERVICE_ROLE_KEY) {
      for (const variable of [
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "VITE_SUPABASE_ANON_KEY",
      ] as const) {
        context.addIssue({
          code: "custom",
          message: "Supabase public and service-role keys must be distinct.",
          path: [variable],
        });
      }
    }
  });

const calendarEnvironmentSchema = z.object({
  GOOGLE_CLIENT_ID: requiredText,
  GOOGLE_CLIENT_SECRET: requiredText,
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().refine(isCanonicalEncryptionKey, {
    message: "Expected a canonical Base64 encoding of a 32-byte encryption key.",
  }),
});

export type ApplicationEnvironment = z.infer<typeof applicationEnvironmentSchema>;
export type CalendarEnvironment = z.infer<typeof calendarEnvironmentSchema>;

export type EnvironmentCheck = {
  configured: boolean;
  missingOrInvalid: string[];
};

export type OptionalEnvironmentCheck = EnvironmentCheck & {
  status: "configured" | "not_configured" | "invalid";
};

const calendarVariables = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_TOKEN_ENCRYPTION_KEY",
] as const;

export class EnvironmentConfigurationError extends Error {
  readonly variables: string[];

  constructor(area: string, variables: string[]) {
    super(`${area} environment is incomplete or invalid: ${variables.join(", ")}`);
    this.name = "EnvironmentConfigurationError";
    this.variables = variables;
  }
}

function issueVariables(error: z.ZodError): string[] {
  return [
    ...new Set(
      error.issues.flatMap((issue) => {
        const [variable] = issue.path;
        return typeof variable === "string" ? [variable] : [];
      }),
    ),
  ].sort();
}

function inspectSchema(schema: z.ZodType<unknown>, source: EnvironmentSource): EnvironmentCheck {
  const result = schema.safeParse(source);

  return result.success
    ? { configured: true, missingOrInvalid: [] }
    : {
        configured: false,
        missingOrInvalid: issueVariables(result.error),
      };
}

function inspectOptionalSchema(
  schema: z.ZodType<unknown>,
  variables: readonly string[],
  source: EnvironmentSource,
): OptionalEnvironmentCheck {
  const hasAnyValue = variables.some((variable) => {
    const value = source[variable];
    return typeof value === "string" && value.trim().length > 0;
  });

  if (!hasAnyValue) {
    return {
      configured: false,
      missingOrInvalid: [],
      status: "not_configured",
    };
  }

  const check = inspectSchema(schema, source);
  return {
    ...check,
    status: check.configured ? "configured" : "invalid",
  };
}

function parseSchema<T>(area: string, schema: z.ZodType<T>, source: EnvironmentSource): T {
  const result = schema.safeParse(source);

  if (!result.success) {
    throw new EnvironmentConfigurationError(area, issueVariables(result.error));
  }

  return result.data;
}

export function inspectCloudEnvironment(source: EnvironmentSource) {
  return {
    application: inspectSchema(applicationEnvironmentSchema, source),
    calendar: inspectOptionalSchema(calendarEnvironmentSchema, calendarVariables, source),
  };
}

export function requireApplicationEnvironment(
  source: EnvironmentSource = process.env,
): ApplicationEnvironment {
  return parseSchema("Application", applicationEnvironmentSchema, source);
}

export function requireCalendarEnvironment(
  source: EnvironmentSource = process.env,
): CalendarEnvironment {
  return parseSchema("Calendar", calendarEnvironmentSchema, source);
}

export function deploymentEnvironment(source: EnvironmentSource): string {
  const environment = source.VERCEL_ENV;
  return environment === "development" || environment === "preview" || environment === "production"
    ? environment
    : "local";
}
