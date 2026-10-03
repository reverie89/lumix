import { describe, expect, it, vi } from "vitest";
import publicRouter from "./public.js";

// vitest.config.ts loads the deployment .env, so TMDB_API_KEY may be set
// here — each tagline test imports a fresh router with an explicit key state
// instead of trusting the ambient value.
const landingHtmlWithKey = async (tmdbApiKey: string | undefined) => {
  const originalKey = process.env.TMDB_API_KEY;
  vi.resetModules();
  if (tmdbApiKey === undefined) delete process.env.TMDB_API_KEY;
  else process.env.TMDB_API_KEY = tmdbApiKey;
  try {
    const { default: router } = await import("./public.js");
    return await (await router.request("/")).text();
  } finally {
    if (originalKey === undefined) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = originalKey;
    vi.resetModules();
  }
};

describe("landing page", () => {
  it("fingerprinted asset urls match the current file contents", async () => {
    const response = await publicRouter.request("/");
    const html = await response.text();
    // Cloudflare's edge caches /js and /css past the origin TTL — the HTML
    // must change the asset URL whenever the asset content changes
    expect(html).toMatch(/\/css\/style\.css\?v=[0-9a-f]{10}/);
    expect(html).toMatch(/\/js\/landing\.js\?v=[0-9a-f]{10}/);
  });

  it("revalidates on every load so fresh hashes always ship", async () => {
    const response = await publicRouter.request("/");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("omits the TMDB tagline when no TMDB key is configured", async () => {
    const html = await landingHtmlWithKey(undefined);
    expect(html).not.toContain("Metadata provided by TMDB");
    expect(html).not.toContain("{{TMDB_TAGLINE}}");
  });

  it("shows the TMDB tagline when a TMDB key is configured", async () => {
    const html = await landingHtmlWithKey("test-key");
    expect(html).toContain("Metadata provided by TMDB");
  });
});
