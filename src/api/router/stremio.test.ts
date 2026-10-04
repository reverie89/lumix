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
      update: ["Last Update"],
    },
  },
};

describe("decodeConfig", () => {
  it("normalizes mirrors and tier picks", () => {
    const config = decodeConfig(encode(tierConfig));
    expect(config.providers.kisskh).toEqual({
      mirrors: [
        "https://kisskh.example.evil.com",
        "https://other.com",
      ],
      type: ["TVSeries"],
      region: ["Korean"],
      status: ["Completed"],
      update: ["Last Update"],
    });
    expect(config.catalog).toEqual([Provider.KISSKH]);
    expect(config.stream).toEqual([Provider.KISSKH]);
    expect(config.catalogs).toContain("kisskh.series.TVSeries");
    expect(config.catalogs).toContain("kisskh.series.Korean");
    expect(config.catalogs).toContain("kisskh.series.Search");
  });

  it("normalizes ole tiers and keeps both providers when both are picked", () => {
    const config = decodeConfig(
      encode({
        providers: {
          kisskh: { mirrors: [], type: ["TVSeries"], region: [], status: [], update: [] },
          ole: {
            type: ["Movies", "TVSeries"],
            region: ["Korean", "午夜影院"],
            update: ["Popular"],
          },
        },
      }),
    );
    expect(config.providers.ole).toEqual({
      mirrors: [],
      type: ["Movies", "TVSeries"],
      region: ["Korean"],
      update: ["Popular"],
    });
    expect(config.catalog).toEqual([Provider.KISSKH, Provider.OLE]);
    expect(config.stream).toEqual([Provider.KISSKH, Provider.OLE]);
    expect(config.catalogs).toContain("ole.movie.Movies");
    expect(config.catalogs).toContain("ole.series.TVSeries");
    expect(config.catalogs).toContain("ole.movie.Korean");
    expect(config.catalogs).toContain("ole.series.Search");
    // kisskh catalogs survive the merge
    expect(config.catalogs).toContain("kisskh.series.TVSeries");
  });

  it("expands ole __all__ tiers", () => {
    const config = decodeConfig(
      encode({
        providers: {
          ole: {
            mirrors: [],
            type: ["__all__"],
            region: ["__all__"],
            update: ["__all__"],
          },
        },
      }),
    );
    expect(config.catalog).toEqual([Provider.OLE]);
    expect(config.catalogs).toContain("ole.series.ShortDrama");
    expect(config.catalogs).toContain("ole.movie.Australian");
    expect(config.catalogs).toContain("ole.movie.Score");
  });

  it("decodes base64url configs (the config page emits url-safe base64)", () => {
    // The page emits base64url so a config can never split the URL path;
    // decodeConfig accepts both alphabets
    const config64 = Buffer.from(
      JSON.stringify({
        providers: {
          ole: { mirrors: [], type: ["TVSeries"], region: ["Korean"], update: [] },
        },
      }),
      "utf-8",
    ).toString("base64url");
    expect(config64).not.toMatch(/[+/=]/);
    const config = decodeConfig(config64);
    expect(config.providers.ole).toMatchObject({ type: ["TVSeries"], region: ["Korean"] });
    expect(config.catalog).toEqual([Provider.OLE]);
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
