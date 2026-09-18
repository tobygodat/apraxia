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

const encryptionKey = z.string().refine(isCanonicalEncryptionKey, {
  message: "Expected a canonical Base64 encoding of a 32-byte encryption key.",
});

/**
 * The version stamped into every envelope this deployment writes. It starts at
 * 1 and the operator raises it by one per rotation, keeping the key it replaces
 * in GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS until every credential has been
 * re-encrypted. See the rotation procedure in docs/CALENDAR.md.
 */
const keyVersion = z
  .string()
  .trim()
  .regex(/^[1-9]\d{0,8}$/, { message: "Expected a positive integer key version." })
  .transform(Number);

const calendarEnvironmentSchema = z
  .object({
    GOOGLE_CLIENT_ID: requiredText,
    GOOGLE_CLIENT_SECRET: requiredText,
    GOOGLE_TOKEN_ENCRYPTION_KEY: encryptionKey,
    GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS: encryptionKey.optional(),
    GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION: keyVersion.optional(),
  })
  .superRefine((value, context) => {
    if (value.GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS === undefined) return;
    if ((value.GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION ?? 1) < 2) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION"],
        message: "A previous key requires a current key version of at least 2.",
      });
    }
    if (value.GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS === value.GOOGLE_TOKEN_ENCRYPTION_KEY) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS"],
        message: "The previous key must differ from the current key.",
      });
    }
  });

export type ApplicationEnvironment = z.infer<typeof applicationEnvironmentSchema>;
export type CalendarEnvironment = z.infer<typeof calendarEnvironmentSchema>;

/** The key version this deployment stamps into new envelopes. Unset means 1. */
export function currentKeyVersion(google: CalendarEnvironment): number {
  return google.GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION ?? 1;
}

/**
 * The key that decrypts an envelope stored under `keyVersion`, or null when
 * this deployment holds no key for it. Only the current version and the one it
 * replaced are readable, so a rotation must finish before the next begins.
 */
export function encryptionKeyForVersion(
  google: CalendarEnvironment,
  keyVersion: number | null,
): string | null {
  const current = currentKeyVersion(google);
  if (keyVersion === current) return google.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (keyVersion === current - 1 && google.GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS !== undefined) {
    return google.GOOGLE_TOKEN_ENCRYPTION_KEY_PREVIOUS;
  }
  return null;
}

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
