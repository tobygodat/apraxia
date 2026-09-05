import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheNavigationService, NavigationCache } from "./navigationCache";

afterEach(() => vi.useRealTimers());

describe("session navigation cache", () => {
  it("shares preload requests and isolates returned records from edits", async () => {
    const cache = new NavigationCache();
    const load = vi.fn(async () => [{ title: "Saved" }]);
    const [first, second] = await Promise.all([cache.read("page", load), cache.read("page", load)]);
    first[0].title = "Draft";
    expect(second[0].title).toBe("Saved");
    expect((await cache.read("page", load))[0].title).toBe("Saved");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps a shared request alive when one page navigates away", async () => {
    const cache = new NavigationCache();
    const controller = new AbortController();
    let finish!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const first = cache.read("page", load, controller.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = cache.read("page", load);
    await Promise.resolve();
    controller.abort();
    finish("ready");
    await rejected;
    expect(await second).toBe("ready");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("expires reads, retries failures, and clears at the account boundary", async () => {
    vi.useFakeTimers();
    const cache = new NavigationCache(1000);
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("ready");
    await expect(cache.read("page", load)).rejects.toThrow("offline");
    expect(await cache.read("page", load)).toBe("ready");
    await vi.advanceTimersByTimeAsync(1001);
    await cache.read("page", load);
    cache.clear();
    await cache.read("page", load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("distinguishes filters and invalidates all related reads after writes", async () => {
    const cache = new NavigationCache();
    const source = {
      list: vi.fn(async (_options: { status: string; signal: AbortSignal }) => ["record"]),
      save: vi.fn(async () => undefined),
    };
    const service = cacheNavigationService(source, cache, "collection", ["list"], ["save"]);
    const options = () => ({ status: "active", signal: new AbortController().signal });
    await service.list(options());
    await service.list(options());
    expect(source.list).toHaveBeenCalledTimes(1);
    await service.list({ ...options(), status: "all" });
    await service.save();
    await service.list(options());
    expect(source.list).toHaveBeenCalledTimes(3);
  });

  it("does not reuse an old in-flight result after cleanup", async () => {
    const cache = new NavigationCache();
    let finish!: (value: string) => void;
    const old = cache.read("page", () => new Promise<string>(resolve => { finish = resolve; }));
    await Promise.resolve();
    cache.clear();
    finish("old user");
    await old;
    expect(await cache.read("page", async () => "new user")).toBe("new user");
  });
});
