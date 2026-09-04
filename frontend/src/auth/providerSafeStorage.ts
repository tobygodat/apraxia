import type { SupabaseClientOptions } from "@supabase/supabase-js";

type SupportedStorage = NonNullable<
  NonNullable<SupabaseClientOptions<"public">["auth"]>["storage"]
>;

type MaybePromise<T> = T | Promise<T>;

interface SanitizedValue {
  changed: boolean;
  value: string;
}

interface SanitizedJsonValue {
  changed: boolean;
  value: unknown;
}

const PROVIDER_TOKEN_KEYS = new Set([
  "provider_token",
  "provider_refresh_token",
]);

function isPromise<T>(value: MaybePromise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | undefined)?.then === "function";
}

function stripProviderTokens(value: unknown): SanitizedJsonValue {
  if (Array.isArray(value)) {
    let changed = false;
    const sanitized = value.map((item) => {
      const result = stripProviderTokens(item);
      changed ||= result.changed;
      return result.value;
    });

    return { changed, value: sanitized };
  }

  if (value === null || typeof value !== "object") {
    return { changed: false, value };
  }

  let changed = false;
  const sanitizedEntries: Array<[string, unknown]> = [];

  for (const [key, nestedValue] of Object.entries(value)) {
    if (PROVIDER_TOKEN_KEYS.has(key)) {
      changed = true;
      continue;
    }

    const result = stripProviderTokens(nestedValue);
    changed ||= result.changed;
    sanitizedEntries.push([key, result.value]);
  }

  return { changed, value: Object.fromEntries(sanitizedEntries) };
}

function sanitizeStorageValue(value: string): SanitizedValue {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return { changed: false, value };
  }

  if (parsed === null || typeof parsed !== "object") {
    return { changed: false, value };
  }

  const sanitized = stripProviderTokens(parsed);

  if (!sanitized.changed) {
    return { changed: false, value };
  }

  return {
    changed: true,
    value: JSON.stringify(sanitized.value),
  };
}

/**
 * Prevents OAuth provider credentials from entering Supabase Auth storage.
 *
 * Supabase access and refresh tokens remain intact so session restoration and
 * automatic refresh continue to work. Reads are sanitized as well as writes so
 * sessions persisted before this wrapper was installed are repaired in place.
 */
export function createProviderSafeStorage(
  storage: SupportedStorage,
): SupportedStorage {
  const providerSafeStorage: SupportedStorage = {
    getItem(key) {
      const storedValue = storage.getItem(key);

      const sanitizeAndRewrite = (
        value: string | null,
      ): MaybePromise<string | null> => {
        if (value === null) return null;

        const sanitized = sanitizeStorageValue(value);
        if (!sanitized.changed) return value;

        const rewrite = storage.setItem(key, sanitized.value);
        if (isPromise(rewrite)) {
          return rewrite.then(() => sanitized.value);
        }

        return sanitized.value;
      };

      if (isPromise(storedValue)) {
        return storedValue.then(sanitizeAndRewrite);
      }

      return sanitizeAndRewrite(storedValue);
    },

    setItem(key, value) {
      return storage.setItem(key, sanitizeStorageValue(value).value);
    },

    removeItem(key) {
      return storage.removeItem(key);
    },
  };

  if ("isServer" in storage) {
    providerSafeStorage.isServer = storage.isServer;
  }

  return providerSafeStorage;
}
