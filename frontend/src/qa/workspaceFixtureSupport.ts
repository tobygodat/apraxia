import {
  validateAppearance,
  type HomeAppearanceService,
} from "../features/calendar/homeAppearance";
import type { FixtureStorage } from "./workspaceFixtureCalendar";

/** Only used in the QA entry; never reads auth storage or calls the network. */
export function delayedFixtureService<T extends object>(service: T, delayMs: number): T {
  return new Proxy(service, {
    get(target, property) {
      const method: unknown = Reflect.get(target, property);
      if (typeof method !== "function") return method;
      return async (...args: unknown[]) => {
        const signal = args.flatMap((arg) =>
          arg instanceof AbortSignal
            ? [arg]
            : arg && typeof arg === "object" && "signal" in arg && arg.signal instanceof AbortSignal
              ? [arg.signal]
              : [],
        )[0];
        signal?.throwIfAborted();
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
          }, delayMs);
          signal?.addEventListener("abort", abort, { once: true });
        });
        signal?.throwIfAborted();
        return structuredClone(await Reflect.apply(method, target, args));
      };
    },
  });
}

export function createFixtureAppearance(
  storage: FixtureStorage,
  key: string,
  title: string,
): HomeAppearanceService {
  return {
    async load(_userId, signal) {
      signal.throwIfAborted();
      const stored = storage.getItem(key);
      return validateAppearance(stored ? JSON.parse(stored) : { title });
    },
    async save(_userId, value, signal) {
      signal.throwIfAborted();
      const valid = validateAppearance(value);
      storage.setItem(key, JSON.stringify(valid));
      return valid;
    },
  };
}
