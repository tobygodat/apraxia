import { describe, expect, it } from "vitest";

import { createHealthResponse } from "../../api/health";
import {
  EnvironmentConfigurationError,
  requireApplicationEnvironment,
  requireCalendarEnvironment,
} from "../../server/env/cloud";

const configuredEnvironment = {
  VERCEL_ENV: "preview",
  VITE_SUPABASE_URL: "https://project.supabase.co/",
  VITE_SUPABASE_ANON_KEY: " public-anon-canary ",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "public-anon-canary",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-canary",
  APP_URL: "https://preview.example.test",
  GOOGLE_CLIENT_ID: "google-client-canary",
  GOOGLE_CLIENT_SECRET: "google-secret-canary",
  GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
};

describe("cloud health", () => {
  it("reports a configured deployment without exposing environment values", async () => {
    const response = createHealthResponse(
      configuredEnvironment,
      new Date("2026-09-02T12:00:00.000Z"),
    );
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as {
      service: string;
      runtime: string;
      status: string;
      environment: string;
      checks: {
        application: { configured: boolean };
        calendar: { configured: boolean };
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({
      service: "orbitos-cloud",
      runtime: "vercel-function",
      status: "ok",
      environment: "preview",
      checks: {
        application: { configured: true },
        calendar: { configured: true },
      },
    });
    expect(bodyText).not.toContain("service-role-secret-canary");
    expect(bodyText).not.toContain("google-secret-canary");
    expect(bodyText).not.toContain(configuredEnvironment.GOOGLE_TOKEN_ENCRYPTION_KEY);
  });

  it("keeps the core healthy while Calendar configuration is deferred", async () => {
    const {
      GOOGLE_CLIENT_ID: _clientId,
      GOOGLE_CLIENT_SECRET: _clientSecret,
      GOOGLE_TOKEN_ENCRYPTION_KEY: _encryptionKey,
      ...environmentWithoutCalendar
    } = configuredEnvironment;

    const response = createHealthResponse(environmentWithoutCalendar);
    const body = (await response.json()) as {
      status: string;
      checks: {
        application: { configured: boolean };
        calendar: { configured: boolean; status: string };
      };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.application.configured).toBe(true);
    expect(body.checks.calendar).toEqual({
      configured: false,
      status: "not_configured",
    });
  });

  it("reports degraded health for a partially configured Calendar", async () => {
    const partialCalendarEnvironment = {
      ...configuredEnvironment,
      GOOGLE_CLIENT_SECRET: "",
    };

    const response = createHealthResponse(partialCalendarEnvironment);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as {
      status: string;
      checks: {
        calendar: { configured: boolean; status: string };
      };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.calendar).toEqual({
      configured: false,
      status: "invalid",
    });
    expect(bodyText).not.toContain("GOOGLE_CLIENT_SECRET");
  });

  it("returns a safe failure when application configuration is invalid", async () => {
    const invalidEnvironment = {
      ...configuredEnvironment,
      SUPABASE_SERVICE_ROLE_KEY: "service-role-must-not-leak",
      SUPABASE_URL: "not-a-url",
    };

    const response = createHealthResponse(invalidEnvironment);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as {
      status: string;
      checks: { application: { configured: boolean } };
    };

    expect(response.status).toBe(503);
    expect(body.status).toBe("not_configured");
    expect(body.checks.application).toEqual({ configured: false });
    expect(bodyText).not.toContain("SUPABASE_URL");
    expect(bodyText).not.toContain("service-role-must-not-leak");
  });

  it("fails health when browser and server target different Supabase projects", async () => {
    const response = createHealthResponse({
      ...configuredEnvironment,
      SUPABASE_URL: "https://other-project.supabase.co",
    });
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as {
      status: string;
      checks: { application: { configured: boolean } };
    };

    expect(response.status).toBe(503);
    expect(body.status).toBe("not_configured");
    expect(body.checks.application).toEqual({ configured: false });
    expect(bodyText).not.toContain("SUPABASE_URL");
    expect(bodyText).not.toContain("VITE_SUPABASE_URL");
  });
});

describe("typed environment parsing", () => {
  it("accepts an exactly encoded 256-bit Calendar encryption key", () => {
    expect(requireCalendarEnvironment(configuredEnvironment).GOOGLE_TOKEN_ENCRYPTION_KEY).toBe(
      configuredEnvironment.GOOGLE_TOKEN_ENCRYPTION_KEY,
    );
  });

  it.each([
    "encryption-key-secret-canary-at-least-32-characters",
    Buffer.alloc(31, 7).toString("base64"),
    Buffer.alloc(33, 7).toString("base64"),
    ` ${Buffer.alloc(32, 7).toString("base64")}`,
    Buffer.alloc(32, 7).toString("base64url"),
  ])("rejects an invalid encryption key without exposing it", async (key) => {
    const environment = { ...configuredEnvironment, GOOGLE_TOKEN_ENCRYPTION_KEY: key };
    expect(() => requireCalendarEnvironment(environment)).toThrow(EnvironmentConfigurationError);
    try {
      requireCalendarEnvironment(environment);
    } catch (error) {
      expect((error as EnvironmentConfigurationError).variables).toEqual([
        "GOOGLE_TOKEN_ENCRYPTION_KEY",
      ]);
      expect(String(error)).not.toContain(key);
    }
    const response = createHealthResponse(environment);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ status: "degraded" });
    expect(body).not.toContain(key);
  });

  it("normalizes equivalent origins and public keys before comparing them", () => {
    expect(requireApplicationEnvironment(configuredEnvironment)).toMatchObject({
      VITE_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_URL: "https://project.supabase.co",
      VITE_SUPABASE_ANON_KEY: "public-anon-canary",
      SUPABASE_ANON_KEY: "public-anon-canary",
    });
  });

  it.each([
    [{ SUPABASE_URL: "https://other-project.supabase.co" }, ["SUPABASE_URL", "VITE_SUPABASE_URL"]],
    [
      { SUPABASE_ANON_KEY: "different-public-key" },
      ["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"],
    ],
  ])(
    "rejects browser/server Supabase configuration drift for %o",
    (override, expectedVariables) => {
      try {
        requireApplicationEnvironment({
          ...configuredEnvironment,
          ...override,
        });
        throw new Error("expected validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(EnvironmentConfigurationError);
        expect((error as EnvironmentConfigurationError).variables).toEqual(expectedVariables);
      }
    },
  );

  it.each([
    "http://project.supabase.co",
    "ftp://project.supabase.co",
    "https://user:password@project.supabase.co",
    "https://project.supabase.co/rest/v1",
  ])("rejects the unsafe Supabase origin %s", (url) => {
    expect(() =>
      requireApplicationEnvironment({
        ...configuredEnvironment,
        VITE_SUPABASE_URL: url,
        SUPABASE_URL: url,
      }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it.each([
    "http://app.example.test",
    "ftp://app.example.test",
    "https://user:password@app.example.test",
    "https://app.example.test/callback",
  ])("rejects the unsafe application origin %s", (url) => {
    try {
      requireApplicationEnvironment({
        ...configuredEnvironment,
        APP_URL: url,
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigurationError);
      expect((error as EnvironmentConfigurationError).variables).toEqual(["APP_URL"]);
      expect(String(error)).not.toContain(url);
    }
  });

  it("allows HTTP only for local origins", () => {
    expect(
      requireApplicationEnvironment({
        ...configuredEnvironment,
        VITE_SUPABASE_URL: "http://127.0.0.1:54321/",
        SUPABASE_URL: "http://127.0.0.1:54321",
        APP_URL: "http://localhost:3000/",
      }),
    ).toMatchObject({
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_URL: "http://127.0.0.1:54321",
      APP_URL: "http://localhost:3000",
    });
  });

  it.each([
    "sb_secret_do-not-bundle-this",
    `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString(
      "base64url",
    )}.signature`,
  ])("rejects the privileged public key %s without echoing it", (key) => {
    try {
      requireApplicationEnvironment({
        ...configuredEnvironment,
        VITE_SUPABASE_ANON_KEY: key,
        SUPABASE_ANON_KEY: key,
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigurationError);
      expect((error as EnvironmentConfigurationError).variables).toEqual([
        "SUPABASE_ANON_KEY",
        "VITE_SUPABASE_ANON_KEY",
      ]);
      expect(String(error)).not.toContain(key);
    }
  });

  it("rejects an opaque service-role key reused as the browser public key", () => {
    const reusedKey = "opaque-key-that-must-not-cross-the-browser-boundary";

    try {
      requireApplicationEnvironment({
        ...configuredEnvironment,
        VITE_SUPABASE_ANON_KEY: reusedKey,
        SUPABASE_ANON_KEY: reusedKey,
        SUPABASE_SERVICE_ROLE_KEY: reusedKey,
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigurationError);
      expect((error as EnvironmentConfigurationError).variables).toEqual([
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "VITE_SUPABASE_ANON_KEY",
      ]);
      expect(String(error)).not.toContain(reusedKey);
    }
  });

  it("throws a redacted error that identifies only invalid variable names", () => {
    const invalidEnvironment = {
      ...configuredEnvironment,
      SUPABASE_SERVICE_ROLE_KEY: "do-not-log-this-value",
      APP_URL: "invalid-url-secret-value",
    };

    expect(() => requireApplicationEnvironment(invalidEnvironment)).toThrow(
      EnvironmentConfigurationError,
    );

    try {
      requireApplicationEnvironment(invalidEnvironment);
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigurationError);
      expect((error as Error).message).toContain("APP_URL");
      expect((error as Error).message).not.toContain("invalid-url-secret-value");
      expect((error as Error).message).not.toContain("do-not-log-this-value");
    }
  });
});
