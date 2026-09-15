import type { SupabaseClientOptions } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createProviderSafeStorage } from "./providerSafeStorage";

type SupportedStorage = NonNullable<
  NonNullable<SupabaseClientOptions<"public">["auth"]>["storage"]
>;

const STORAGE_KEY = "sb-example-auth-token";

function sessionJson(): string {
  return JSON.stringify({
    access_token: "supabase-access-token",
    refresh_token: "supabase-refresh-token",
    provider_token: "google-access-token",
    provider_refresh_token: "google-refresh-token",
    expires_at: 1_798_765_432,
    token_type: "bearer",
    user: {
      id: "user-123",
      identities: [
        {
          identity_data: {
            provider_token: "nested-google-token",
            provider_refresh_token: "nested-google-refresh-token",
            provider_token_hint: "keep-this-near-match",
          },
        },
      ],
      user_metadata: {
        oauth: {
          provider_token: "deep-google-token",
        },
        PROVIDER_TOKEN: "case-sensitive-near-match",
      },
    },
  });
}

function syncStorage(initialValue: string | null = null) {
  let value = initialValue;
  const storage: SupportedStorage = {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue;
    }),
    removeItem: vi.fn(() => {
      value = null;
    }),
  };

  return { storage, value: () => value };
}

describe("createProviderSafeStorage", () => {
  it("strips exact provider token fields recursively before a sync write", () => {
    const underlying = syncStorage();
    const storage = createProviderSafeStorage(underlying.storage);
    const original = sessionJson();

    storage.setItem(STORAGE_KEY, original);

    expect(original).toContain("google-access-token");
    expect(underlying.storage.setItem).toHaveBeenCalledOnce();

    const persisted = JSON.parse(underlying.value() ?? "null") as {
      access_token: string;
      refresh_token: string;
      user: {
        identities: Array<{
          identity_data: Record<string, unknown>;
        }>;
        user_metadata: Record<string, unknown>;
      };
    };

    expect(persisted.access_token).toBe("supabase-access-token");
    expect(persisted.refresh_token).toBe("supabase-refresh-token");
    expect(persisted).not.toHaveProperty("provider_token");
    expect(persisted).not.toHaveProperty("provider_refresh_token");
    expect(persisted.user.identities[0]?.identity_data).toEqual({
      provider_token_hint: "keep-this-near-match",
    });
    expect(persisted.user.user_metadata).toEqual({
      oauth: {},
      PROVIDER_TOKEN: "case-sensitive-near-match",
    });
  });

  it("sanitizes and rewrites a legacy sync value on read", () => {
    const legacy = sessionJson();
    const underlying = syncStorage(legacy);
    const storage = createProviderSafeStorage(underlying.storage);

    const result = storage.getItem(STORAGE_KEY);

    expect(result).toBe(underlying.value());
    expect(result).not.toContain("google-access-token");
    expect(result).not.toContain("google-refresh-token");
    expect(result).toContain("supabase-access-token");
    expect(result).toContain("supabase-refresh-token");
    expect(underlying.storage.setItem).toHaveBeenCalledOnce();
    expect(underlying.storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, result);
  });

  it("supports async reads, rewrites, writes, and removals", async () => {
    let value: string | null = sessionJson();
    const storage: SupportedStorage = {
      isServer: true,
      getItem: vi.fn(async () => value),
      setItem: vi.fn(async (_key: string, nextValue: string) => {
        value = nextValue;
      }),
      removeItem: vi.fn(async () => {
        value = null;
      }),
    };
    const safeStorage = createProviderSafeStorage(storage);

    const restored = await safeStorage.getItem(STORAGE_KEY);

    expect(restored).toBe(value);
    expect(restored).not.toContain("google-access-token");
    expect(restored).toContain("supabase-access-token");
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(safeStorage.isServer).toBe(true);

    await safeStorage.setItem(STORAGE_KEY, sessionJson());
    expect(value).not.toContain("google-refresh-token");
    expect(value).toContain("supabase-refresh-token");

    await safeStorage.removeItem(STORAGE_KEY);
    expect(value).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it.each([
    ["invalid JSON", "not-json"],
    ["a JSON string", '"pkce-code-verifier"'],
    ["a JSON number", "42"],
    ["a JSON boolean", "true"],
    ["JSON null", "null"],
    ["unchanged session JSON formatting", '{ "access_token": "a", "refresh_token": "r" }'],
  ])("preserves %s byte-for-byte", async (_description, rawValue) => {
    const underlying = syncStorage(rawValue);
    const storage = createProviderSafeStorage(underlying.storage);

    expect(await storage.getItem(STORAGE_KEY)).toBe(rawValue);
    expect(underlying.storage.setItem).not.toHaveBeenCalled();

    await storage.setItem(STORAGE_KEY, rawValue);
    expect(underlying.value()).toBe(rawValue);
  });

  it("does not mutate parsed session input while sanitizing", () => {
    const input = {
      access_token: "supabase-access-token",
      refresh_token: "supabase-refresh-token",
      nested: {
        provider_token: "google-access-token",
      },
    };
    const snapshot = structuredClone(input);
    const parse = vi.spyOn(JSON, "parse").mockReturnValue(input);
    const underlying = syncStorage();
    const storage = createProviderSafeStorage(underlying.storage);

    storage.setItem(STORAGE_KEY, "serialized-session");

    expect(parse).toHaveBeenCalledWith("serialized-session");
    expect(input).toEqual(snapshot);
  });

  it("never logs malformed or sensitive stored values", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const underlying = syncStorage(sessionJson());
    const storage = createProviderSafeStorage(underlying.storage);

    await storage.getItem(STORAGE_KEY);
    await storage.setItem(STORAGE_KEY, "{provider_token:secret}");

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
