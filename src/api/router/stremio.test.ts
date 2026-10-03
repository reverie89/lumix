import { describe, expect, it } from "vitest";
import { Provider } from "../../source/provider.js";
import { decodeConfig, getResourceLimitResponse } from "./stremio.js";

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value), "utf-8").toString("base64");

const tierConfig = {
  providers: {
    kisskh: {
      mirrors: [
        "https://kisskh.example.evil.com", // hostnames no longer matter
        "https://other.com",
      ],
      type: ["TVSeries", "Bogus"],
      region: ["Korean", "Atlantis"],
      status: ["Completed"],
      update: ["Latest"],
    },
  },
};

describe("decodeConfig", () => {
  it("normalizes mirrors and tier picks", () => {
    const config = decodeConfig(encode(tierConfig));
    expect(config.providers.kisskh?.mirrors).toEqual([
      "https://kisskh.example.evil.com",
      "https://other.com",
    ]);
    expect(config.providers.kisskh?.type).toEqual(["TVSeries"]);
    expect(config.providers.kisskh?.region).toEqual(["Korean"]);
    expect(config.providers.kisskh?.status).toEqual(["Completed"]);
    expect(config.providers.kisskh?.update).toEqual(["Latest"]);
    expect(config.catalog).toEqual([Provider.KISSKH]);
    expect(config.stream).toEqual([Provider.KISSKH]);
    expect(config.catalogs).toContain("kisskh.series.TVSeries");
    expect(config.catalogs).toContain("kisskh.series.Korean");
    expect(config.catalogs).toContain("kisskh.series.Search");
  });

  it("falls back to the default config on malformed input", () => {
    const fallback = decodeConfig("not-json-at-all");
    expect(fallback.catalog).toEqual([Provider.KISSKH]);
    expect(fallback.catalogs.length).toBeGreaterThan(0);
    // Valid JSON of the wrong shape falls back to the default catalogs
    const wrongShape = decodeConfig(encode("just a string"));
    expect(wrongShape.providers.kisskh).toBeDefined();
    expect(wrongShape.catalog).toEqual([Provider.KISSKH]);
    // Deeply nested JSON that crashes JSON.parse is caught like any other
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 100000; i++) deep = { nested: deep };
    const crashed = decodeConfig(encode(deep));
    expect(crashed.catalogs.length).toBeGreaterThan(0);
  });

  it("keeps only known kisskh catalogs from legacy flat configs", () => {
    const config = decodeConfig(
      encode({
        catalogs: [
          "kisskh.series.Korean",
          "kisskh.series.Bogus",
          "onetouchtv.series.X",
          "kisskh.movie.Search",
        ],
        catalog: ["kisskh", "onetouchtv"],
        stream: ["kisskh"],
      }),
    );
    expect(config.catalogs).toEqual([
      "kisskh.series.Korean",
      "kisskh.movie.Search",
    ]);
    expect(config.catalog).toEqual([Provider.KISSKH]);
    expect(config.stream).toEqual([Provider.KISSKH]);
  });
});

describe("getResourceLimitResponse", () => {
  it("returns an empty subtitle list instead of a placeholder track", () => {
    // A placeholder track would be parsed as a real subtitle by players
    // and render nothing
    const response = getResourceLimitResponse(
      "subtitles",
      "Too Many Requests\nRetry after 30 seconds",
      "https://addon.example.com",
    );
    expect(response).toEqual({ subtitles: [] });
  });

  it("keeps the placeholder entry for stream responses, linked to the requesting origin", () => {
    const response = getResourceLimitResponse(
      "stream",
      "wait",
      "https://addon.example.com",
    ) as { streams: { externalUrl?: string }[] };
    expect(response.streams.length).toBe(1);
    expect(response.streams[0]?.externalUrl).toBe("https://addon.example.com");
  });
});
