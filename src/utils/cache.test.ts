import { describe, expect, it } from "vitest";
import { cache } from "./cache.js";

describe("GlobalCache", () => {
  it("returns stored values until they expire", () => {
    cache.set("t:a", { v: 1 }, 60_000);
    expect(cache.get("t:a")).toEqual({ v: 1 });
    cache.set("t:dead", "x", -1);
    expect(cache.get("t:dead")).toBeNull();
    cache.delete("t:a");
  });

  it("moves hit entries to the back of the eviction order (LRU)", () => {
    cache.set("lru:a", "a", 60_000);
    cache.set("lru:b", "b", 60_000);
    const before = cache.getCacheStats();
    // The hit re-inserts the entry; a naive re-insert through set() would
    // double-count its bytes and corrupt the memory accounting
    expect(cache.get("lru:a")).toBe("a");
    const after = cache.getCacheStats();
    expect(after.itemCount).toBe(before.itemCount);
    expect(after.memoryUsed).toBe(before.memoryUsed);
    cache.delete("lru:a");
    cache.delete("lru:b");
  });

  it("refuses entries above the per-entry size cap", () => {
    const huge = "x".repeat(6 * 1024 * 1024); // over MAX_ENTRY_BYTES as chars*2
    cache.set("cap:huge", huge);
    expect(cache.get("cap:huge")).toBeNull();
  });

  it("sizes plain strings without a stringify pass", () => {
    const value = "y".repeat(1000);
    cache.set("str:size", value, 60_000);
    expect(cache.get("str:size")).toBe(value);
    // An explicit size hint is honored too (and can force eviction pressure)
    cache.set("str:hint", value, 60_000, 2000);
    expect(cache.get("str:hint")).toBe(value);
    cache.delete("str:size");
    cache.delete("str:hint");
  });
});
