import { describe, expect, it, vi } from "vitest";

describe("tmdb optional key", () => {
  it("resolves null without network when no key is configured", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    vi.resetModules();
    const { tmdb, isTmdbEnabled } = await import("./tmdb.js");
    expect(isTmdbEnabled()).toBe(false);
    const detail = await tmdb.searchDetail("Any Title", "series");
    expect(detail).toBeNull();
    vi.unstubAllEnvs();
  });
});
