/** Session-only read cache. Never writes personal records to browser storage. */
export class NavigationCache {
  private entries = new Map<string, { promise: Promise<unknown>; expires: number }>();
  private controller = new AbortController();

  constructor(private readonly ttl = 60_000) {}

  invalidate = () => { this.entries.clear(); };

  clear = () => {
    this.entries.clear();
    this.controller.abort();
    this.controller = new AbortController();
  };

  async read<T>(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    let entry = this.entries.get(key);
    if (!entry || entry.expires <= Date.now()) {
      // Bound memory even when browsing many project details or calendar weeks.
      if (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value!);
      const sharedSignal = this.controller.signal;
      const current = { promise: Promise.resolve().then(() => { sharedSignal.throwIfAborted(); return load(sharedSignal); }), expires: Infinity };
      this.entries.set(key, current);
      current.promise = current.promise.then(value => {
        current.expires = Date.now() + this.ttl;
        return value;
      }, error => {
        if (this.entries.get(key) === current) this.entries.delete(key);
        throw error;
      });
      entry = current;
    }
    // A page leaving must not cancel a shared preload needed by the next page.
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      entry.promise.then(value => {
        if (!signal?.aborted) resolve(structuredClone(value) as T);
      }, reject).finally(() => signal?.removeEventListener("abort", abort));
    });
  }
}

/** Decorate the existing service boundary; all unlisted operations stay uncached. */
export function cacheNavigationService<T extends object>(
  service: T, cache: NavigationCache, namespace: string,
  reads: readonly (keyof T)[], writes: readonly (keyof T)[],
): T {
  return new Proxy(service, {
    get(target, property) {
      const method = Reflect.get(target, property) as unknown;
      if (typeof method !== "function") return method;
      if (reads.includes(property as keyof T)) return (...args: unknown[]) => {
        let signal: AbortSignal | undefined;
        const keyArgs = args.map(arg => {
          if (arg instanceof AbortSignal) { signal = arg; return null; }
          if (arg && typeof arg === "object") {
            const options = arg as Record<string, unknown>;
            if (options.signal instanceof AbortSignal) signal = options.signal;
            return Object.fromEntries(Object.entries(options).filter(([key]) => key !== "signal").sort(([a], [b]) => a.localeCompare(b)));
          }
          return arg;
        });
        // Optional trailing signals do not distinguish otherwise identical reads.
        while (keyArgs.length && keyArgs[keyArgs.length - 1] == null) keyArgs.pop();
        return cache.read(`${namespace}:${String(property)}:${JSON.stringify(keyArgs)}`, sharedSignal => {
          const sharedArgs = args.map(arg => arg instanceof AbortSignal ? sharedSignal
            : arg && typeof arg === "object" && "signal" in arg ? { ...arg, signal: sharedSignal } : arg);
          return Reflect.apply(method, target, sharedArgs) as Promise<unknown>;
        }, signal);
      };
      if (writes.includes(property as keyof T)) return async (...args: unknown[]) => {
        cache.invalidate();
        try { return await Reflect.apply(method, target, args); }
        finally { cache.invalidate(); }
      };
      return method.bind(target);
    },
  });
}
