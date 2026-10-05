import { Logger } from "./logger.js";

type CacheValue = {
  value: any;
  size: number;
  expiresAt: number;
};

export const TTL_SECS = {
  content: 24 * 60 * 60,
  stream: 0.5 * 60 * 60,
  // How long a "TMDB has no such title" verdict stands (search_miss rows)
  miss: 7 * 24 * 60 * 60,
};
export const TTL_MS = {
  content: TTL_SECS.content * 1000,
  stream: TTL_SECS.stream * 1000,
  miss: TTL_SECS.miss * 1000,
};

/**
 * Shared expiry test for the db-backed cache rows (stream, subtitle, search
 * miss): a row is live until updatedAt + ttl. A missing ttl reads as
 * expired so a row can't serve forever by accident.
 */
export const isExpired = (updatedAt: Date, ttl?: number | null): boolean =>
  updatedAt.getTime() + (ttl ?? 0) < Date.now();

const logger = new Logger("CACHE");
class GlobalCache {
  private cache = new Map<string, CacheValue>();
  // Recommended default cache size in MB
  private MAX_BYTES = 100 * 1024 * 1024;
  // One entry larger than this is dropped instead of stored: a huge response
  // would otherwise evict the whole cache (the eviction loop stops when the
  // map is empty) just to keep a single oversized value.
  private MAX_ENTRY_BYTES = 5 * 1024 * 1024;
  private currentByteSize = 0;

  /**
   * @param key Unique identifier (e.g., episode ID)
   * @param value The decrypted subtitle string
   * @param ttlMs Time to live in miliseconds (default 2 hour)
   * @param sizeBytes Known serialized size — skips the stringify-based
   *   estimate (callers holding already-serialized strings should pass it)
   */
  set(
    key: string,
    value: any,
    ttlMs: number = 2 * 60 * 60 * 1000,
    sizeBytes?: number,
  ): void {
    // 1. Size the value: strings (the largest payloads — upstream bundles,
    //    subtitles, playlists) are measured without a stringify round-trip
    const newSize =
      sizeBytes ??
      (typeof value === "string"
        ? value.length * 2
        : JSON.stringify(value).length * 2);
    if (newSize > this.MAX_ENTRY_BYTES) {
      logger.warn(`Entry too large, skipping | ${key}`);
      return;
    }

    // 2. Clear old entry if it exists
    this.delete(key);

    // 3. EVICTION LOGIC: If adding this exceeds the limit, delete the oldest
    while (
      this.currentByteSize + newSize > this.MAX_BYTES &&
      this.cache.size > 0
    ) {
      const oldestKey = this.cache.keys().next().value || ""; // Maps iterate in insertion order
      logger.log(`Memory Limit. Evicting oldest | ${oldestKey}`);
      this.delete(oldestKey);
    }
    const expiresAt = Date.now() + ttlMs;

    // 4. Set the new item
    this.cache.set(key, { value, size: newSize, expiresAt });
    this.currentByteSize += newSize;
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      logger.log(`Expired | ${key}`);
      this.delete(key);
      return null;
    }
    // LRU: re-insert so a hit moves the entry to the back of the eviction
    // order; hot entries survive bursts of one-off writes
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  delete(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentByteSize -= entry.size;
      this.cache.delete(key);
    }
  }

  getCacheStats() {
    return {
      itemCount: this.cache.size,
      memoryUsed: (this.currentByteSize / (1024 * 1024)).toFixed(2),
      maxLimit: (this.MAX_BYTES / (1024 * 1024)).toFixed(2),
      usagePercent: ((this.currentByteSize / this.MAX_BYTES) * 100).toFixed(1),
    };
  }

  clearAll() {
    this.cache.clear();
    this.currentByteSize = 0;
  }
}

export const cache = new GlobalCache();
