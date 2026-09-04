import { describe, expect, it } from "vitest";
import {
  BrowserEnvironmentError,
  parseBrowserEnvironment,
} from "./browserEnv";

describe("parseBrowserEnvironment", () => {
  it("returns only the browser-safe Supabase configuration", () => {
    expect(
      parseBrowserEnvironment({
        VITE_SUPABASE_URL: "https://example.supabase.co/",
        VITE_SUPABASE_ANON_KEY: " public-key ",
        UNRELATED_SERVER_VALUE: "must-not-cross-the-boundary",
      }),
    ).toEqual({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "public-key",
    });
  });

  it("reports variable names without echoing secret values", () => {
    const secret = "do-not-display-this";

    try {
      parseBrowserEnvironment({
        VITE_SUPABASE_URL: "not-a-url",
        VITE_SUPABASE_ANON_KEY: "",
        UNRELATED_SERVER_VALUE: secret,
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserEnvironmentError);
      expect(String(error)).toContain("VITE_SUPABASE_URL");
      expect(String(error)).toContain("VITE_SUPABASE_ANON_KEY");
      expect(String(error)).not.toContain(secret);
    }
  });

  it.each(["ftp://example.com", "localhost:54321", "javascript:alert(1)"])(
    "rejects the non-http URL %s",
    (value) => {
      expect(() =>
        parseBrowserEnvironment({
          VITE_SUPABASE_URL: value,
          VITE_SUPABASE_ANON_KEY: "key",
        }),
      ).toThrow(BrowserEnvironmentError);
    },
  );

  it.each([
    "http://example.supabase.co",
    "http://127.evil.example",
    "https://user:password@example.supabase.co",
  ])("rejects the unsafe Supabase URL %s", (value) => {
    expect(() =>
      parseBrowserEnvironment({
        VITE_SUPABASE_URL: value,
        VITE_SUPABASE_ANON_KEY: "public-key",
      }),
    ).toThrow(BrowserEnvironmentError);
  });

  it.each([
    "http://localhost:54321",
    "http://127.0.0.1:54321",
    "http://127.12.34.56:54321",
    "http://[::1]:54321",
    "https://example.supabase.co",
  ])("allows the encrypted or loopback Supabase URL %s", (value) => {
    expect(
      parseBrowserEnvironment({
        VITE_SUPABASE_URL: value,
        VITE_SUPABASE_ANON_KEY: "sb_publishable_example",
      }).supabaseUrl,
    ).toBe(value);
  });

  it.each([
    "sb_secret_do-not-bundle",
    `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`,
  ])("rejects a privileged browser key without echoing it", (key) => {
    try {
      parseBrowserEnvironment({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_ANON_KEY: key,
      });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserEnvironmentError);
      expect(String(error)).toContain("VITE_SUPABASE_ANON_KEY");
      expect(String(error)).not.toContain(key);
    }
  });

  it.each([
    "sb_publishable_example",
    `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`,
  ])("allows the browser-safe Supabase key %s", (key) => {
    expect(
      parseBrowserEnvironment({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_ANON_KEY: key,
      }).supabaseAnonKey,
    ).toBe(key);
  });
});
