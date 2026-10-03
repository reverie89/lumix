import { describe, expect, it, vi } from "vitest";

vi.mock("../../source/kisskh-subtitle.js", () => ({
  getSubtitleVtt: vi.fn(async (url: string) =>
    url.includes("ok")
      ? "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nhello"
      : null,
  ),
}));

// Small limit so the 429 path is reachable without 60 requests
process.env.SUBTITLES_PROXY_REQUEST_LIMIT = "2";

const { default: stremio } = await import("./stremio.js");

const encoded = (url: string) => `/subtitle/${encodeURIComponent(url)}`;
const request = (url: string, ip: string) =>
  stremio.request(encoded(url), { headers: { "x-forwarded-for": ip } });

describe("/subtitle proxy", () => {
  it("serves allowlisted http urls as vtt", async () => {
    const response = await request("http://kisskh.test/ok.en.srt", "1.1.1.1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/vtt; charset=utf-8",
    );
    expect((await response.text()).startsWith("WEBVTT")).toBe(true);
  });

  it("rejects non-http(s) schemes and non-allowlisted hosts", async () => {
    expect((await request("file:///etc/passwd", "2.2.2.2")).status).toBe(400);
    expect((await request("https://evil.com/ok.srt", "2.2.2.2")).status).toBe(
      400,
    );
  });

  it("rate limits with plain text 429, never the resource placeholder JSON", async () => {
    const url = "https://sub.cdnvideo11.shop/ok.en.srt";
    await request(url, "3.3.3.3");
    await request(url, "3.3.3.3");
    const limited = await request(url, "3.3.3.3");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-cache");
    expect(limited.headers.get("retry-after")).toBeTruthy();
    // Players would try to parse the placeholder JSON as VTT and fail
    const body = await limited.text();
    expect(body).toContain("Retry after");
    expect(body).not.toContain("subtitles");
  });
});
