/** Session-only read cache. Never writes personal records to browser storage. */
interface CacheEntry {
  promise: Promise<unknown>;
  expires: number;
  value?: unknown;
  hasValue: boolean;
  stale: boolean;
}

export class NavigationCache {
  private entries = new Map<string, CacheEntry>();
  private controller = new AbortController();
  // Bumped by invalidate()/clear() so a read already in flight when a write
  // starts can tell, once it resolves, that it must not resurrect pre-write
  // data as fresh.
  private epoch = 0;

  constructor(private readonly ttl = 60_000) {}

  /** Stale-while-revalidate: keep serving old values to peek() until refetches land. */
  invalidate = () => {
    this.epoch++;
    for (const entry of this.entries.values()) entry.stale = true;
  };

  clear = () => {
    this.epoch++;
    this.entries.clear();
    this.controller.abort();
    this.controller = new AbortController();
  };

  /** Synchronous, no load triggered. Returns a clone of the freshest known value, if any. */
  peek<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || !entry.hasValue) return undefined;
    return structuredClone(entry.value) as T;
  }

  async read<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    let entry = this.entries.get(key);
    if (!entry || entry.stale || entry.expires <= Date.now()) {
      // Bound memory even when browsing many project details or calendar weeks.
      if (!entry && this.entries.size >= 100)
        this.entries.delete(this.entries.keys().next().value!);
      const previous = entry;
      const sharedSignal = this.controller.signal;
      const startEpoch = this.epoch;
      const current: CacheEntry = {
        promise: Promise.resolve().then(() => {
          sharedSignal.throwIfAborted();
          return load(sharedSignal);
        }),
        expires: Infinity,
        value: previous?.value,
        hasValue: previous?.hasValue ?? false,
        stale: false,
      };
      this.entries.set(key, current);
      current.promise = current.promise.then(
        (value) => {
          current.value = value;
          current.hasValue = true;
          // A write that started (and invalidated) after this load began must
          // not resurrect data resolved before the write as fresh: leave the
          // entry stale so the next read refetches, while peek can still
          // serve this newer value in the meantime.
          if (this.epoch === startEpoch) {
            current.expires = Date.now() + this.ttl;
            current.stale = false;
          } else {
            current.expires = 0;
            current.stale = true;
          }
          return value;
        },
        (error) => {
          if (this.entries.get(key) === current) {
            if (current.hasValue) {
              // Keep serving the last known value; only drop the entry when there was none.
              current.expires = 0;
              current.stale = true;
            } else {
              this.entries.delete(key);
            }
          }
          throw error;
        },
      );
      entry = current;
    }
    // A page leaving must not cancel a shared preload needed by the next page.
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      entry.promise
        .then((value) => {
          if (!signal?.aborted) resolve(structuredClone(value) as T);
        }, reject)
        .finally(() => signal?.removeEventListener("abort", abort));
    });
  }
}

function readKey(namespace: string, property: PropertyKey, keyArgs: unknown[]): string {
  return `${namespace}:${String(property)}:${JSON.stringify(keyArgs)}`;
}

/** Strip signal args the same way for both the fetch key and the peek key. */
function keyArgsFor(args: unknown[]): unknown[] {
  const keyArgs = args.map((arg) => {
    if (arg instanceof AbortSignal) return null;
    if (arg && typeof arg === "object") {
      const options = arg as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(options)
          .filter(([key]) => key !== "signal")
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return arg;
  });
  // Optional trailing signals, and options objects left empty once the signal is stripped
  // (e.g. `{ signal }` alone), do not distinguish otherwise identical reads.
  const isEmpty = (value: unknown) =>
    value == null ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0);
  while (keyArgs.length && isEmpty(keyArgs[keyArgs.length - 1])) keyArgs.pop();
  return keyArgs;
}

/** Symbol used by cacheNavigationService's Proxy to expose a synchronous peek for reads. */
export const PEEK = Symbol("navigationCache.peek");

/**
 * Synchronous read of a cached value already known for a proxied service's read method.
 * Returns undefined when nothing is cached yet, or when `service` is not a cached proxy.
 * Keys ignore AbortSignal args (and options objects left empty once a signal is stripped),
 * so `peekRead(service, "loadWorkspace")` matches a call made as `service.loadWorkspace({ signal })`.
 */
export function peekRead<T extends object, K extends keyof T>(
  service: T,
  method: K,
  ...args: T[K] extends (...a: infer A) => unknown ? A : never
): T[K] extends (...a: never[]) => Promise<infer R> ? R | undefined : never {
  const peek = (service as unknown as Record<symbol, unknown>)[PEEK] as
    ((property: PropertyKey, args: unknown[]) => unknown) | undefined;
  return peek?.(method, args) as never;
}

/** Decorate the existing service boundary; all unlisted operations stay uncached. */
export function cacheNavigationService<T extends object>(
  service: T,
  cache: NavigationCache,
  namespace: string,
  reads: readonly (keyof T)[],
  writes: readonly (keyof T)[],
): T {
  return new Proxy(service, {
    get(target, property) {
      if (property === PEEK) {
        return (peekProperty: PropertyKey, args: unknown[]) => {
          if (!reads.includes(peekProperty as keyof T)) return undefined;
          return cache.peek(readKey(namespace, peekProperty, keyArgsFor(args)));
        };
      }
      const method = Reflect.get(target, property) as unknown;
      if (typeof method !== "function") return method;
      if (reads.includes(property as keyof T))
        return (...args: unknown[]) => {
          let signal: AbortSignal | undefined;
          for (const arg of args) {
            if (arg instanceof AbortSignal) signal = arg;
            else if (
              arg &&
              typeof arg === "object" &&
              (arg as Record<string, unknown>).signal instanceof AbortSignal
            )
              signal = (arg as Record<string, unknown>).signal as AbortSignal;
          }
          const keyArgs = keyArgsFor(args);
          return cache.read(
            readKey(namespace, property, keyArgs),
            (sharedSignal) => {
              const sharedArgs = args.map((arg) =>
                arg instanceof AbortSignal
                  ? sharedSignal
                  : arg && typeof arg === "object" && "signal" in arg
                    ? { ...arg, signal: sharedSignal }
                    : arg,
              );
              return Reflect.apply(method, target, sharedArgs) as Promise<unknown>;
            },
            signal,
          );
        };
      if (writes.includes(property as keyof T))
        return async (...args: unknown[]) => {
          cache.invalidate();
          try {
            return await Reflect.apply(method, target, args);
          } finally {
            cache.invalidate();
          }
        };
      return method.bind(target);
    },
  });
}
