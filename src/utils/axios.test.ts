import { AxiosError, AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "./cache.js";
import { RateLimitError } from "./error.js";

// Both shared clients (default and kisskh) come from axios.create — one mock
// instance serves every axiosGet call. vi.hoisted: the module-level
// createClient in axios.ts runs at import, before test-file consts initialize
const { http } = vi.hoisted(() => ({ http: vi.fn() }));

vi.mock("axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("axios")>();
  return {
    ...actual,
    default: Object.assign(actual.default, { create: () => ({ get: http }) }),
  };
});

import { axiosGet } from "./axios.js";

function responseOf(status: number, headers: Record<string, string> = {}) {
  const response = {
    status,
    headers,
    data: undefined,
  } as AxiosResponse;
  return new AxiosError(
    `status ${status}`,
    undefined,
    undefined,
    undefined,
    response,
  );
}

// Unique urls per test: successes cache for hours, so a shared url would
// skip the mock on the next test
let counter = 0;
const freshUrl = () => `https://api.example.test/${++counter}`;

beforeEach(() => {
  http.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("axiosGet", () => {
  it("caches a successful response for the url", async () => {
    const url = freshUrl();
    http.mockResolvedValueOnce({ data: { ok: 1 } });
    await expect(axiosGet(url)).resolves.toEqual({ ok: 1 });
    await expect(axiosGet(url)).resolves.toEqual({ ok: 1 });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("sleeps the server's retry-after instead of the fixed backoff", async () => {
    const url = freshUrl();
    http
      .mockRejectedValueOnce(responseOf(429, { "retry-after": "1" }))
      .mockResolvedValueOnce({ data: { ok: 2 } });
    const start = Date.now();
    await expect(axiosGet(url)).resolves.toEqual({ ok: 2 });
    // ~1s server-mandated wait (the fixed backoff would be 30ms)
    expect(Date.now() - start).toBeGreaterThanOrEqual(950);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("gives up immediately when retry-after exceeds the budget", async () => {
    const url = freshUrl();
    http.mockRejectedValue(responseOf(429, { "retry-after": "30" }));
    const start = Date.now();
    await expect(axiosGet(url)).rejects.toBeInstanceOf(RateLimitError);
    // No sleeping past the deadline for a 30s wait against a 3s budget
    expect(Date.now() - start).toBeLessThan(1500);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("falls back to linear backoff without a retry-after header", async () => {
    const url = freshUrl();
    http
      .mockRejectedValueOnce(responseOf(429))
      .mockResolvedValueOnce({ data: { ok: 3 } });
    await expect(axiosGet(url)).resolves.toEqual({ ok: 3 });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("negative-caches a failed fetch for a minute, then retries", async () => {
    const url = freshUrl();
    http.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    await expect(axiosGet(url)).resolves.toBeNull();
    // Sentinel hit: no second upstream attempt while fresh
    await expect(axiosGet(url)).resolves.toBeNull();
    expect(http).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(61 * 1000);
    http.mockResolvedValueOnce({ data: { ok: 4 } });
    await expect(axiosGet(url)).resolves.toEqual({ ok: 4 });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("does not negative-cache kisskh urls (mirror failover owns those)", async () => {
    const url = "https://kisskh.test/api/DramaList/List?page=1";
    http.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(axiosGet(url)).resolves.toBeNull();
    await expect(axiosGet(url)).resolves.toBeNull();
    expect(http).toHaveBeenCalledTimes(2);
    // Leave the shared cache clean of the kisskh key
    cache.delete(`url:${url}`);
  });
});
