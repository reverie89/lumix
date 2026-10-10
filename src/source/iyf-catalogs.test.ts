import { describe, expect, it } from "vitest";
import {
  expandIyfCatalogs,
  getIyfQuery,
  normalizeIyfTiers,
} from "./iyf-catalogs.js";

describe("expandIyfCatalogs", () => {
  it("expands each type pick to its own row (Movies is the movie side)", () => {
    const ids = expandIyfCatalogs({
      type: ["Movies", "Anime"],
      region: [],
      year: [],
      quality: [],
      sort: [],
    });
    expect(ids.sort()).toEqual(["iyf.movie.Movies", "iyf.series.Anime"]);
  });

  it("adds a series and a movies row per region, year, quality and sort pick", () => {
    for (const [tier, pick] of [
      ["region", "Chinese"],
      ["year", "ThisYear"],
      ["quality", "4K"],
      ["sort", "Popular"],
    ] as const) {
      const ids = expandIyfCatalogs({
        type: [],
        region: [],
        year: [],
        quality: [],
        sort: [],
        [tier]: [pick],
      });
      expect(ids.sort()).toEqual([
        `iyf.movie.${pick}`,
        `iyf.series.${pick}`,
      ]);
    }
  });

  it("expands tiers in the configured order", () => {
    const ids = expandIyfCatalogs({
      order: ["sort", "type", "region"],
      type: ["TVSeries"],
      region: ["Korean"],
      year: [],
      quality: [],
      sort: ["Popular"],
    });
    expect(ids).toEqual([
      "iyf.series.Popular",
      "iyf.movie.Popular",
      "iyf.series.TVSeries",
      "iyf.series.Korean",
      "iyf.movie.Korean",
    ]);
  });

  it("drops unknown options", () => {
    const ids = expandIyfCatalogs({
      type: ["午夜版"],
      region: ["亚特兰蒂斯"],
      year: ["虚空"],
      quality: ["8K"],
      sort: ["Random"],
    });
    expect(ids).toEqual([]);
  });

  it("expands __all__ to every option of the tier", () => {
    const ids = expandIyfCatalogs({
      type: ["__all__"],
      region: ["__all__"],
      year: ["__all__"],
      quality: ["__all__"],
      sort: ["__all__"],
    });
    expect(ids).toContain("iyf.movie.Movies");
    expect(ids).toContain("iyf.series.TVSeries");
    expect(ids).toContain("iyf.series.Variety");
    expect(ids).toContain("iyf.series.Anime");
    expect(ids).toContain("iyf.series.ShortDrama");
    expect(ids).toContain("iyf.series.Western");
    expect(ids).toContain("iyf.movie.Others");
    expect(ids).toContain("iyf.series.ThisYear");
    expect(ids).toContain("iyf.movie.1080P");
    expect(ids).toContain("iyf.series.Latest");
  });
});

describe("getIyfQuery", () => {
  it("defaults the cid from the Stremio type and sorts by add time", () => {
    expect(getIyfQuery("Korean", "series")).toEqual({
      cid: "0,1,4",
      region: "韩国",
      year: "",
      quality: "",
      orderby: "0",
    });
    expect(getIyfQuery("Korean", "movie")).toMatchObject({ cid: "0,1,3" });
  });

  it("resolves type categories regardless of the Stremio type", () => {
    expect(getIyfQuery("Movies", "series")?.cid).toBe("0,1,3");
    expect(getIyfQuery("ShortDrama", "movie")?.cid).toBe("0,1,8");
    expect(getIyfQuery("Variety", "series")?.cid).toBe("0,1,5");
    expect(getIyfQuery("Anime", "series")?.cid).toBe("0,1,6");
  });

  it("resolves sort picks", () => {
    expect(getIyfQuery("Popular", "series")).toMatchObject({ orderby: "1" });
    expect(getIyfQuery("Score", "movie")).toMatchObject({ orderby: "2" });
    expect(getIyfQuery("Latest", "series")).toMatchObject({ orderby: "0" });
  });

  it("resolves region, year and quality picks", () => {
    expect(getIyfQuery("Chinese", "series")).toMatchObject({ region: "大陆" });
    expect(getIyfQuery("ThisYear", "movie")).toMatchObject({ year: "今年" });
    expect(getIyfQuery("1080P", "series")).toMatchObject({
      quality: "1080P",
    });
  });

  it("returns null for unknown names", () => {
    expect(getIyfQuery("Search", "series")).toBeNull();
    expect(getIyfQuery("US", "series")).toBeNull();
    expect(getIyfQuery("午夜版", "series")).toBeNull();
  });
});

describe("normalizeIyfTiers", () => {
  it("keeps known options in order and dedupes", () => {
    const tiers = normalizeIyfTiers({
      type: ["Movies", "Movies", "Bogus"],
      region: ["Chinese", "Western"],
      year: [],
      quality: ["4K"],
      sort: ["Popular"],
    });
    expect(tiers).toEqual({
      // No order given: the canonical tier order
      order: ["type", "region", "year", "quality", "sort"],
      type: ["Movies"],
      region: ["Chinese", "Western"],
      year: [],
      quality: ["4K"],
      sort: ["Popular"],
    });
  });

  it("normalizes the tier order: unknown dropped, missing appended", () => {
    const tiers = normalizeIyfTiers({
      order: ["quality", "bogus", "quality"],
      type: [],
      region: [],
      year: [],
      quality: [],
      sort: [],
    });
    expect(tiers.order).toEqual([
      "quality",
      "type",
      "region",
      "year",
      "sort",
    ]);
  });

  it("expands __all__ to every known option", () => {
    const tiers = normalizeIyfTiers({
      type: ["__all__"],
      region: ["__all__"],
      year: ["__all__"],
      quality: ["__all__"],
      sort: ["__all__"],
    });
    expect(tiers.type).toEqual([
      "TVSeries",
      "Movies",
      "Variety",
      "Anime",
      "ShortDrama",
    ]);
    expect(tiers.region).toEqual([
      "Chinese",
      "Hongkong",
      "Taiwanese",
      "Japanese",
      "Korean",
      "Western",
      "UK",
      "Thai",
      "Others",
    ]);
    expect(tiers.year).toEqual([
      "ThisYear",
      "LastYear",
      "Earlier",
      "Nineties",
      "Eighties",
      "Nostalgia",
    ]);
    expect(tiers.quality).toEqual(["4K", "1080P", "900P", "720P"]);
    expect(tiers.sort).toEqual(["Popular", "Score", "Latest"]);
  });
});
