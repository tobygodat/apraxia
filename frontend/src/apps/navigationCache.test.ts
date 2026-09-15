import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheNavigationService, NavigationCache, peekRead } from "./navigationCache";

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
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
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
    const old = cache.read(
      "page",
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    cache.clear();
    finish("old user");
    await old;
    expect(await cache.read("page", async () => "new user")).toBe("new user");
  });

  it("peek misses before any read and returns undefined", () => {
    const cache = new NavigationCache();
    expect(cache.peek("page")).toBeUndefined();
  });

  it("peek hits after a read resolves", async () => {
    const cache = new NavigationCache();
    await cache.read("page", async () => ({ title: "Saved" }));
    expect(cache.peek<{ title: string }>("page")).toEqual({ title: "Saved" });
  });

  it("peek keeps serving the old value while a stale refetch is pending", async () => {
    const cache = new NavigationCache();
    await cache.read("page", async () => "first");
    cache.invalidate();
    let finish!: (value: string) => void;
    const pending = cache.read(
      "page",
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    expect(cache.peek("page")).toBe("first");
    await Promise.resolve();
    finish("second");
    await pending;
    expect(cache.peek("page")).toBe("second");
  });

  it("does not resurrect pre-write data when a read in flight resolves after invalidate", async () => {
    const cache = new NavigationCache();
    let finish!: (value: string) => void;
    const inFlight = cache.read(
      "page",
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await Promise.resolve();
    cache.invalidate();
    finish("stale-write-race");
    expect(await inFlight).toBe("stale-write-race");
    // peek can still serve the resolved value while it stays marked stale.
    expect(cache.peek("page")).toBe("stale-write-race");
    // The next read must refetch instead of trusting the pre-write result.
    const load = vi.fn(async () => "fresh");
    expect(await cache.read("page", load)).toBe("fresh");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("peekRead reads through cacheNavigationService, matching keys that strip signals", async () => {
    const cache = new NavigationCache();
    const source = {
      list: vi.fn(async (_options: { status: string; signal: AbortSignal }) => ["record"]),
    };
    const service = cacheNavigationService(source, cache, "collection", ["list"], []);
    expect(
      peekRead(service, "list", { status: "active", signal: new AbortController().signal }),
    ).toBeUndefined();
    await service.list({ status: "active", signal: new AbortController().signal });
    expect(
      peekRead(service, "list", { status: "active", signal: new AbortController().signal }),
    ).toEqual(["record"]);
  });

  it("peekRead on an unproxied service returns undefined", () => {
    const plain = { list: async () => ["record"] };
    expect(peekRead(plain, "list")).toBeUndefined();
  });

  it("keys an options object holding only a signal the same as no options at all", async () => {
    const cache = new NavigationCache();
    const source = {
      loadWorkspace: vi.fn(async (_options?: { signal?: AbortSignal }) => ["record"]),
    };
    const service = cacheNavigationService(source, cache, "todos", ["loadWorkspace"], []);
    await service.loadWorkspace({ signal: new AbortController().signal });
    expect(peekRead(service, "loadWorkspace")).toEqual(["record"]);
    expect(await service.loadWorkspace()).toEqual(["record"]);
    expect(source.loadWorkspace).toHaveBeenCalledTimes(1);
  });

  it("keeps peekRead working through an object that adds fields before the proxy wraps it", async () => {
    const cache = new NavigationCache();
    const source = { status: vi.fn(async () => "connected") };
    const withExtra = cacheNavigationService(
      { ...source, invalidate: cache.invalidate },
      cache,
      "calendar",
      ["status"],
      [],
    );
    expect(peekRead(withExtra, "status")).toBeUndefined();
    await withExtra.status();
    expect(peekRead(withExtra, "status")).toBe("connected");
  });
});
