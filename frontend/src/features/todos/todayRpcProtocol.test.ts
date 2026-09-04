// @vitest-environment node

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TodayPageRequest } from "../../../../shared/todayRpcContract";
import {
  collectTodaySnapshot,
  TodaySnapshotChangedError,
  verifyTodayReorderReceipt,
  type FetchTodayPage,
} from "./todayRpcProtocol";

const DATE = "2026-09-03";
const TOKEN_A = createHash("sha256").update("snapshot-a").digest("hex");
const TOKEN_B = createHash("sha256").update("snapshot-b").digest("hex");
const TOKEN_C = createHash("sha256").update("snapshot-c").digest("hex");
const TIMESTAMP = "2026-09-01T12:00:00.123456Z";
const INVALID_RESPONSE = /incomplete or invalid response/i;

interface WireTodo {
  id: string;
  text: string;
  due_date: string;
  due_time: string | null;
  project_id: string | null;
  project_title: string | null;
  today_rank: number | null;
  is_overdue: boolean;
  is_manually_ordered: boolean;
  created_at: string;
  updated_at: string;
}

function uuid(index: number): string {
  return `abcdefab-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function row(index: number, overrides: Partial<WireTodo> = {}): WireTodo {
  return {
    id: uuid(index),
    text: `Task ${index}`,
    due_date: DATE,
    due_time: null,
    project_id: null,
    project_title: null,
    today_rank: null,
    is_overdue: false,
    is_manually_ordered: false,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

function rows(count: number, first = 1): WireTodo[] {
  return Array.from({ length: count }, (_, index) => row(first + index));
}

function page(
  items: readonly WireTodo[],
  request: TodayPageRequest,
  snapshotToken = TOKEN_A,
  overrides: Record<string, unknown> = {},
) {
  return {
    local_date: DATE,
    offset: request.p_offset,
    total_count: items.length,
    snapshot_token: snapshotToken,
    items: items.slice(request.p_offset, request.p_offset + 200),
    ...overrides,
  };
}

function firstPage(items: readonly WireTodo[], overrides: Record<string, unknown> = {}) {
  return page(items, { p_local_date: DATE, p_offset: 0, p_limit: 200, p_snapshot_token: null }, TOKEN_A, overrides);
}

function fingerprint(ids: readonly string[]): string {
  return createHash("sha256").update(ids.map((id) => id.toLowerCase()).join(","), "utf8").digest("hex");
}

function receipt(ids: readonly string[], overrides: Record<string, unknown> = {}) {
  return {
    local_date: DATE,
    applied_count: ids.length,
    rank_step: 1024,
    order_fingerprint: fingerprint(ids),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail; });
  return { promise, resolve, reject };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => vi.restoreAllMocks());

describe("collectTodaySnapshot", () => {
  it.each([0, 1, 200, 201, 1001, 2500])("drains exactly %i valid rows in complete 200-row pages", async (count) => {
    const source = rows(count);
    const controller = new AbortController();
    const fetchPage = vi.fn<FetchTodayPage>(async (request) => page(source, request));

    const result = await collectTodaySnapshot(fetchPage, DATE, { signal: controller.signal });

    expect(result).toHaveLength(count);
    expect(result.map((todo) => todo.id)).toEqual(source.map((todo) => todo.id));
    expect(new Set(result.map((todo) => todo.id)).size).toBe(count);
    const pageCount = Math.max(1, Math.ceil(count / 200));
    expect(fetchPage).toHaveBeenCalledTimes(pageCount);
    expect(fetchPage.mock.calls.map(([request]) => request)).toEqual(
      Array.from({ length: pageCount }, (_, index) => ({
        p_local_date: DATE,
        p_offset: index * 200,
        p_limit: 200,
        p_snapshot_token: index === 0 ? null : TOKEN_A,
      })),
    );
    expect(fetchPage.mock.calls.every(([, options]) => options.signal === controller.signal)).toBe(true);
  });

  it("projects complete Today metadata without rounding dates, times, or timestamps", async () => {
    const item = row(1, {
      due_date: "2026-08-29", due_time: "09:00:00.123456", is_overdue: true,
      project_id: uuid(9000), project_title: "Reading group", today_rank: 1024, is_manually_ordered: true,
    });
    const providerRow = { ...item, user_id: uuid(9999), provider_metadata: { hidden: "not a domain field" } };
    const result = await collectTodaySnapshot(async () => firstPage([providerRow]), DATE, {
      signal: new AbortController().signal,
    });
    expect(result).toEqual([{
      id: item.id, text: item.text, completed: false, completedAt: null,
      dueDate: item.due_date, dueTime: item.due_time,
      projectId: item.project_id, projectTitle: item.project_title,
      todayRank: 1024, isManuallyOrdered: true, isOverdue: true,
      createdAt: TIMESTAMP, updatedAt: TIMESTAMP,
    }]);
  });

  it("does not publish the first page while a later page is pending or fails", async () => {
    const source = rows(201);
    const later = deferred<unknown>();
    const providerError = new Error("Later page unavailable");
    const onComplete = vi.fn();
    const fetchPage = vi.fn<FetchTodayPage>((request) => request.p_offset === 0
      ? Promise.resolve(page(source, request)) : later.promise);
    const result = collectTodaySnapshot(fetchPage, DATE, { signal: new AbortController().signal }).then(onComplete);
    const rejection = expect(result).rejects.toBe(providerError);
    await nextTurn();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(onComplete).not.toHaveBeenCalled();
    later.reject(providerError);
    await rejection;
    expect(onComplete).not.toHaveBeenCalled();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["null envelope", null],
    ["array envelope", []],
    ["missing envelope fields", {}],
    ["different date", firstPage(rows(1), { local_date: "2026-09-04" })],
    ["different offset", firstPage(rows(1), { offset: 1 })],
    ["string offset", firstPage(rows(1), { offset: "0" })],
    ["negative count", firstPage([], { total_count: -1 })],
    ["fractional count", firstPage(rows(1), { total_count: 1.5 })],
    ["unsafe count", firstPage(rows(1), { total_count: Number.MAX_SAFE_INTEGER + 1 })],
    ["NaN count", firstPage(rows(1), { total_count: Number.NaN })],
    ["infinite count", firstPage(rows(1), { total_count: Infinity })],
    ["string count", firstPage(rows(1), { total_count: "1" })],
    ["non-array items", firstPage(rows(1), { items: { 0: row(1), length: 1 } })],
    ["sparse items", firstPage(rows(1), { items: Array<unknown>(1) })],
    ["short token", firstPage(rows(1), { snapshot_token: "a".repeat(63) })],
    ["uppercase token", firstPage(rows(1), { snapshot_token: TOKEN_A.toUpperCase() })],
    ["newline-suffixed token", firstPage(rows(1), { snapshot_token: `${TOKEN_A}\n` })],
    ["non-string token", firstPage(rows(1), { snapshot_token: 123 })],
    ["truncated page", firstPage(rows(201), { items: rows(199) })],
    ["oversized page", firstPage(rows(201), { items: rows(201) })],
    ["extra items beyond total", firstPage(rows(1), { items: rows(2) })],
  ])("rejects %s without restarting", async (_label, response) => {
    const fetchPage = vi.fn<FetchTodayPage>(async () => response);
    await expect(collectTodaySnapshot(fetchPage, DATE, { signal: new AbortController().signal }))
      .rejects.toThrow(INVALID_RESPONSE);
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it.each([
    ["null row", null],
    ["array row", []],
    ["invalid UUID", { ...row(1), id: "not-a-uuid" }],
    ["empty task", { ...row(1), text: "  " }],
    ["missing due date", { ...row(1), due_date: null }],
    ["impossible due date", { ...row(1), due_date: "2026-02-30" }],
    ["future due date", { ...row(1), due_date: "2026-09-04" }],
    ["wrong overdue flag", { ...row(1), is_overdue: true }],
    ["non-boolean overdue flag", { ...row(1), is_overdue: "false" }],
    ["wrong manual-order flag", { ...row(1), is_manually_ordered: true }],
    ["invalid time", { ...row(1), due_time: "25:00:00" }],
    ["invalid project ID", { ...row(1), project_id: "project" }],
    ["invalid project title", { ...row(1), project_title: 9 }],
    ["missing project title", { ...row(1), project_title: undefined }],
    ["nonpositive rank", { ...row(1), today_rank: 0, is_manually_ordered: true }],
    ["fractional rank", { ...row(1), today_rank: 1.5, is_manually_ordered: true }],
    ["invalid creation timestamp", { ...row(1), created_at: "yesterday" }],
    ["missing update timestamp", { ...row(1), updated_at: undefined }],
  ])("rejects a malformed %s without exposing any rows", async (_label, item) => {
    const fetchPage = vi.fn<FetchTodayPage>(async () => firstPage(rows(1), { items: [item] }));
    await expect(collectTodaySnapshot(fetchPage, DATE, { signal: new AbortController().signal }))
      .rejects.toThrow(INVALID_RESPONSE);
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it.each(["within a page", "across pages"])("rejects case-insensitive duplicate UUIDs %s", async (position) => {
    const source = position === "within a page" ? rows(2) : rows(201);
    source[source.length - 1] = row(1, { id: uuid(1).toUpperCase() });
    const fetchPage = vi.fn<FetchTodayPage>(async (request) => page(source, request));
    await expect(collectTodaySnapshot(fetchPage, DATE, { signal: new AbortController().signal }))
      .rejects.toThrow(INVALID_RESPONSE);
    expect(fetchPage).toHaveBeenCalledTimes(position === "within a page" ? 1 : 2);
  });

  it.each(["within a page", "across pages"])("rejects out-of-order rows %s", async (position) => {
    const source = position === "within a page" ? rows(2) : rows(201);
    source[source.length - 1] = row(9000, { due_date: "2026-09-02", is_overdue: true });
    const fetchPage = vi.fn<FetchTodayPage>(async (request) => page(source, request));
    await expect(collectTodaySnapshot(fetchPage, DATE, { signal: new AbortController().signal }))
      .rejects.toThrow(INVALID_RESPONSE);
    expect(fetchPage).toHaveBeenCalledTimes(position === "within a page" ? 1 : 2);
  });

  it("rejects a truncated final page instead of returning a partial snapshot", async () => {
    const source = rows(201);
    const fetchPage = vi.fn<FetchTodayPage>(async (request) => page(source, request, TOKEN_A,
      request.p_offset === 200 ? { items: [] } : {}));
    await expect(collectTodaySnapshot(fetchPage, DATE, { signal: new AbortController().signal }))
      .rejects.toThrow(INVALID_RESPONSE);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each(["typed snapshot error", "token mismatch", "count mismatch"])(
    "restarts at zero and discards old rows on %s",
    async (change) => {
      const oldRows = rows(401);
      const newRows = rows(201, 5000);
      let attempt = 0;
      const fetchPage = vi.fn<FetchTodayPage>(async (request) => {
        if (request.p_offset === 0) attempt += 1;
        if (attempt > 1) return page(newRows, request, TOKEN_C);
        if (request.p_offset === 0) return page(oldRows, request);
        if (change === "typed snapshot error") throw new TodaySnapshotChangedError();
        return page(oldRows, request, change === "token mismatch" ? TOKEN_B : TOKEN_A,
          change === "count mismatch" ? { total_count: 402 } : {});
      });

      const result = await collectTodaySnapshot(fetchPage, DATE, { signal: new AbortController().signal });

      expect(result.map((todo) => todo.id)).toEqual(newRows.map((todo) => todo.id));
      expect(fetchPage.mock.calls.map(([request]) => request.p_offset)).toEqual([0, 200, 0, 200]);
      expect(fetchPage.mock.calls.map(([request]) => request.p_snapshot_token)).toEqual([null, TOKEN_A, null, TOKEN_C]);
    },
  );

  it("permits a complete third attempt after exactly two snapshot restarts", async () => {
    const source = rows(201, 5000);
    let attempt = 0;
    const fetchPage = vi.fn<FetchTodayPage>(async (request) => {
      if (request.p_offset === 0) attempt += 1;
      if (attempt < 3 && request.p_offset === 200) throw new TodaySnapshotChangedError();
      return page(attempt < 3 ? rows(201, attempt * 1000) : source, request);
    });
    const result = await collectTodaySnapshot(fetchPage, DATE, { signal: new AbortController().signal });
    expect(result.map((todo) => todo.id)).toEqual(source.map((todo) => todo.id));
    expect(fetchPage.mock.calls.map(([request]) => request.p_offset)).toEqual([0, 200, 0, 200, 0, 200]);
  });

  it.each(["typed snapshot error", "token mismatch", "count mismatch"])(
    "stops after three attempts when %s repeats",
    async (change) => {
      const source = rows(401);
      const fetchPage = vi.fn<FetchTodayPage>(async (request) => {
        if (request.p_offset === 0) return page(source, request);
        if (change === "typed snapshot error") throw new TodaySnapshotChangedError();
        return page(source, request, change === "token mismatch" ? TOKEN_B : TOKEN_A,
          change === "count mismatch" ? { total_count: 402 } : {});
      });
      await expect(collectTodaySnapshot(fetchPage, DATE, { signal: new AbortController().signal }))
        .rejects.toBeInstanceOf(TodaySnapshotChangedError);
      expect(fetchPage.mock.calls.map(([request]) => request.p_offset)).toEqual([0, 200, 0, 200, 0, 200]);
    },
  );

  it.each([
    new Error("Connection unavailable"),
    Object.assign(new Error("Changed by name only"), { name: "TodaySnapshotChangedError" }),
    { code: "40001", message: "Only the adapter may classify this provider error" },
  ])("does not retry an unclassified provider failure", async (failure) => {
    const fetchPage = vi.fn<FetchTodayPage>(async () => { throw failure; });
    await expect(collectTodaySnapshot(fetchPage, DATE, { signal: new AbortController().signal })).rejects.toBe(failure);
    expect(fetchPage).toHaveBeenCalledOnce();
  });

  it("does not treat a malformed changed-count envelope as a retryable snapshot", async () => {
    const source = rows(201);
    const fetchPage = vi.fn<FetchTodayPage>(async (request) => page(source, request, TOKEN_A,
      request.p_offset === 200 ? { total_count: 199, items: [] } : {}));
    await expect(collectTodaySnapshot(fetchPage, DATE, { signal: new AbortController().signal }))
      .rejects.toThrow(INVALID_RESPONSE);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("does not start a read after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchPage = vi.fn<FetchTodayPage>();
    await expect(collectTodaySnapshot(fetchPage, DATE, { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("settles cancellation despite an ignored signal and observes late provider %s", async (settlement) => {
    const controller = new AbortController();
    const provider = deferred<unknown>();
    const fetchPage = vi.fn<FetchTodayPage>(() => provider.promise);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const outcome = collectTodaySnapshot(fetchPage, DATE, { signal: controller.signal })
        .then(() => "unexpected success", (error: unknown) => error);
      controller.abort();
      expect(await Promise.race([outcome, nextTurn().then(() => "still pending")]))
        .toMatchObject({ name: "AbortError" });
      if (settlement === "resolve") provider.resolve(firstPage(rows(201)));
      else provider.reject(new TodaySnapshotChangedError());
      await nextTurn();
      expect(fetchPage).toHaveBeenCalledOnce();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener("unhandledRejection", unhandled);
    }
  });
});

describe("verifyTodayReorderReceipt", () => {
  it("verifies SHA-256 of lowercase comma-joined IDs and returns their requested order", async () => {
    const ids = Object.freeze([uuid(3).toUpperCase(), uuid(1), uuid(2)]);
    const response = Object.freeze(receipt(ids));
    const result = await verifyTodayReorderReceipt(response, DATE, ids, { signal: new AbortController().signal });
    expect(result).toEqual(ids.map((todoId, index) => ({ todoId, todayRank: (index + 1) * 1024 })));
    expect(ids).toEqual([uuid(3).toUpperCase(), uuid(1), uuid(2)]);
  });

  it("returns every one of 1001 reordered IDs with exact 1024-spaced ranks", async () => {
    const ids = rows(1001).map((todo) => todo.id).reverse();
    const result = await verifyTodayReorderReceipt(receipt(ids), DATE, ids, { signal: new AbortController().signal });
    expect(result).toHaveLength(1001);
    expect(result).toEqual(ids.map((todoId, index) => ({ todoId, todayRank: (index + 1) * 1024 })));
    expect(result[1000]).toEqual({ todoId: ids[1000], todayRank: 1_025_024 });
  });

  it("accepts the empty-order SHA-256 receipt without inventing a rank", async () => {
    const response = receipt([]);
    expect(response.order_fingerprint).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    await expect(verifyTodayReorderReceipt(response, DATE, [], { signal: new AbortController().signal })).resolves.toEqual([]);
  });

  it.each([
    ["null receipt", null],
    ["array receipt", []],
    ["missing fields", {}],
    ["different date", receipt([uuid(1)], { local_date: "2026-09-04" })],
    ["wrong count", receipt([uuid(1)], { applied_count: 0 })],
    ["string count", receipt([uuid(1)], { applied_count: "1" })],
    ["wrong rank step", receipt([uuid(1)], { rank_step: 1 })],
    ["string rank step", receipt([uuid(1)], { rank_step: "1024" })],
    ["wrong fingerprint", receipt([uuid(1)], { order_fingerprint: TOKEN_A })],
    ["uppercase fingerprint", receipt([uuid(1)], { order_fingerprint: fingerprint([uuid(1)]).toUpperCase() })],
    ["short fingerprint", receipt([uuid(1)], { order_fingerprint: "a".repeat(63) })],
    ["non-string fingerprint", receipt([uuid(1)], { order_fingerprint: 123 })],
  ])("rejects a %s", async (_label, response) => {
    await expect(verifyTodayReorderReceipt(response, DATE, [uuid(1)], { signal: new AbortController().signal }))
      .rejects.toThrow(INVALID_RESPONSE);
  });

  it.each(["reversed", "no separators", "uppercase IDs"])("rejects a hash made from %s instead of canonical saved order", async (method) => {
    const ids = [uuid(1).toUpperCase(), uuid(2)];
    const input = method === "reversed" ? [...ids].reverse().map((id) => id.toLowerCase()).join(",")
      : method === "no separators" ? ids.map((id) => id.toLowerCase()).join("") : ids.join(",");
    const response = receipt(ids, { order_fingerprint: createHash("sha256").update(input).digest("hex") });
    await expect(verifyTodayReorderReceipt(response, DATE, ids, { signal: new AbortController().signal }))
      .rejects.toThrow(INVALID_RESPONSE);
  });

  it.each([
    ["duplicate IDs", [uuid(1), uuid(1)]],
    ["case-insensitive duplicate IDs", [uuid(1), uuid(1).toUpperCase()]],
    ["invalid ID", ["not-a-uuid"]],
    ["newline-suffixed ID", [`${uuid(1)}\n`]],
    ["leading whitespace ID", [` ${uuid(1)}`]],
  ])("rejects %s even when the receipt hashes that input", async (_label, ids) => {
    await expect(verifyTodayReorderReceipt(receipt(ids), DATE, ids, { signal: new AbortController().signal }))
      .rejects.toThrow(INVALID_RESPONSE);
  });

  it("rejects a sparse ID array rather than silently omitting holes", async () => {
    const ids = Array<string>(1);
    await expect(verifyTodayReorderReceipt({
      local_date: DATE, applied_count: 1, rank_step: 1024, order_fingerprint: fingerprint([]),
    }, DATE, ids, { signal: new AbortController().signal })).rejects.toThrow(INVALID_RESPONSE);
  });

  it("does not start hashing after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const digest = vi.spyOn(crypto.subtle, "digest");
    await expect(verifyTodayReorderReceipt(receipt([uuid(1)]), DATE, [uuid(1)], { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(digest).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("settles cancellation during hashing and observes its late %s", async (settlement) => {
    const controller = new AbortController();
    const pendingDigest = deferred<ArrayBuffer>();
    const digest = vi.spyOn(crypto.subtle, "digest").mockReturnValue(pendingDigest.promise);
    const ids = [uuid(2).toUpperCase(), uuid(1)];
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const outcome = verifyTodayReorderReceipt(receipt(ids), DATE, ids, { signal: controller.signal })
        .then(() => "unexpected success", (error: unknown) => error);
      expect(digest).toHaveBeenCalledOnce();
      expect(digest.mock.calls[0]![0]).toBe("SHA-256");
      expect(new TextDecoder().decode(digest.mock.calls[0]![1] as Uint8Array))
        .toBe(ids.map((id) => id.toLowerCase()).join(","));
      controller.abort();
      expect(await Promise.race([outcome, nextTurn().then(() => "still pending")]))
        .toMatchObject({ name: "AbortError" });
      if (settlement === "resolve") pendingDigest.resolve(new ArrayBuffer(32));
      else pendingDigest.reject(new Error("Late digest failure"));
      await nextTurn();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener("unhandledRejection", unhandled);
    }
  });
});
