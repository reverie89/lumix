import { describe, expect, it } from "vitest";

const { limiterKey } = await import("./stremio.js");

const IP = "203.0.113.7";

describe("limiterKey", () => {
  it("splits the catalog budget per provider", () => {
    expect(limiterKey("catalog", IP, "/catalog/series/kisskh.series.Korean.json")).toBe(
      `${IP}:kisskh`,
    );
    expect(limiterKey("catalog", IP, "/catalog/series/ole.series.TVSeries.json")).toBe(
      `${IP}:ole`,
    );
    expect(limiterKey("catalog", IP, "/catalog/series/iyf.series.TVSeries.json")).toBe(
      `${IP}:iyf`,
    );
  });

  it("splits config-scoped and search catalog requests too", () => {
    const path = "/eyJvcmRlciI6W119/catalog/series/kisskh.series.Search.json";
    expect(limiterKey("catalog", IP, path)).toBe(`${IP}:kisskh`);
  });

  it("keeps one budget per IP for cross-provider meta and stream lookups", () => {
    expect(limiterKey("meta", IP, "/meta/series/kisskh:12345.json")).toBe(IP);
    expect(limiterKey("stream", IP, "/stream/series/tt1234567.json")).toBe(IP);
    expect(limiterKey("subtitles", IP, "/subtitles/series/kisskh:12345.json")).toBe(IP);
  });

  it("falls back to the bare IP when a catalog id carries no provider prefix", () => {
    expect(limiterKey("catalog", IP, "/catalog/series/unknown.series.Korean.json")).toBe(IP);
  });
});
