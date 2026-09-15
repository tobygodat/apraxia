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
  coverImage: string | null,
): HomeAppearanceService {
  return {
    async load(_userId, signal) {
      signal.throwIfAborted();
      const stored = storage.getItem(key);
      return validateAppearance(
        stored
          ? JSON.parse(stored)
          : { title: "", coverImage, coverPositionX: 72, coverPositionY: 28 },
      );
    },
    async save(_userId, value, signal) {
      signal.throwIfAborted();
      const valid = validateAppearance(value);
      storage.setItem(key, JSON.stringify(valid));
      return valid;
    },
  };
}

/** A crop test pattern, generated as an actual wide or portrait image. */
export function createFixtureCover(portrait: boolean): string {
  const canvas = document.createElement("canvas");
  canvas.width = portrait ? 600 : 1440;
  canvas.height = portrait ? 800 : 600;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#d3e6df");
  gradient.addColorStop(0.5, "#607968");
  gradient.addColorStop(1, "#17252e");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#ffffff80";
  context.lineWidth = 3;
  for (let i = 1; i < 4; i++) {
    context.strokeRect(
      (i * canvas.width) / 8,
      (i * canvas.height) / 8,
      canvas.width * (1 - i / 4),
      canvas.height * (1 - i / 4),
    );
  }
  context.font = "24px sans-serif";
  context.fillStyle = "#fff";
  context.fillText("Top · cover crop check", 24, 40);
  context.fillText("Bottom · cover crop check", 24, canvas.height - 24);
  return validateAppearance({ title: "", coverImage: canvas.toDataURL("image/webp", 0.8) })
    .coverImage!;
}
