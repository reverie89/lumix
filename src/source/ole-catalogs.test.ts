import { describe, expect, it } from "vitest";
import {
  expandOleCatalogs,
  getOleQuery,
  normalizeOleTiers,
} from "./ole-catalogs.js";

describe("expandOleCatalogs", () => {
  it("expands each type pick to its own row (Movies is the movie side)", () => {
    const ids = expandOleCatalogs({
      type: ["Movies", "Anime"],
      region: [],
      update: [],
    });
    expect(ids.sort()).toEqual(["ole.movie.Movies", "ole.series.Anime"]);
  });

  it("adds a series and a movies row per region", () => {
    const ids = expandOleCatalogs({
      type: [],
      region: ["Korean"],
      update: [],
    });
    expect(ids.sort()).toEqual([
      "ole.movie.Korean",
      "ole.series.Korean",
    ]);
  });

  it("adds a series and a movies row per update pick", () => {
    const ids = expandOleCatalogs({
      type: [],
      region: [],
      update: ["Popular"],
    });
    expect(ids.sort()).toEqual([
      "ole.movie.Popular",
      "ole.series.Popular",
    ]);
  });

  it("expands tiers in the configured order", () => {
    const ids = expandOleCatalogs({
      order: ["update", "type", "region"],
      type: ["TVSeries"],
      region: ["Korean"],
      update: ["Popular"],
    });
    expect(ids).toEqual([
      "ole.series.Popular",
      "ole.movie.Popular",
      "ole.series.TVSeries",
      "ole.series.Korean",
      "ole.movie.Korean",
    ]);
  });

  it("drops unknown options", () => {
    const ids = expandOleCatalogs({
      type: ["午夜影院"],
      region: ["亚特兰蒂斯"],
      update: ["Random"],
    });
    expect(ids).toEqual([]);
  });

  it("expands __all__ to every option of the tier", () => {
    const ids = expandOleCatalogs({
      type: ["__all__"],
      region: ["__all__"],
      update: ["__all__"],
    });
    expect(ids).toContain("ole.movie.Movies");
    expect(ids).toContain("ole.series.TVSeries");
    expect(ids).toContain("ole.series.Variety");
    expect(ids).toContain("ole.series.Anime");
    expect(ids).toContain("ole.series.ShortDrama");
    expect(ids).toContain("ole.series.Chinese");
    expect(ids).toContain("ole.movie.US");
    expect(ids).toContain("ole.series.Score");
    expect(ids).toContain("ole.movie.Release Date");
  });
});

describe("getOleQuery", () => {
  it("defaults the API type from the Stremio type", () => {
    expect(getOleQuery("Korean", "series")).toEqual({
      typeId1: "2",
      area: "韩国",
      update: "update",
    });
    expect(getOleQuery("Korean", "movie")).toMatchObject({ typeId1: "1" });
  });

  it("resolves type categories regardless of the Stremio type", () => {
    expect(getOleQuery("Movies", "series")?.typeId1).toBe("1");
    expect(getOleQuery("ShortDrama", "movie")?.typeId1).toBe("14");
    expect(getOleQuery("Variety", "series")?.typeId1).toBe("3");
  });

  it("resolves update picks", () => {
    expect(getOleQuery("Popular", "series")).toMatchObject({
      update: "hot",
    });
    expect(getOleQuery("Score", "movie")).toMatchObject({ update: "score" });
    expect(getOleQuery("Release Date", "series")).toMatchObject({
      update: "desc",
    });
    expect(getOleQuery("Last Update", "series")).toMatchObject({
      update: "update",
    });
  });

  it("returns null for unknown names", () => {
    expect(getOleQuery("Search", "series")).toBeNull();
    expect(getOleQuery("Hollywood", "series")).toBeNull();
    expect(getOleQuery("午夜影院", "series")).toBeNull();
  });
});

describe("normalizeOleTiers", () => {
  it("keeps known options in order and dedupes", () => {
    const tiers = normalizeOleTiers({
      type: ["Movies", "Movies", "Bogus"],
      region: ["Chinese", "US"],
      update: ["Popular"],
    });
    expect(tiers).toEqual({
      // No order given: the canonical tier order
      order: ["type", "region", "update"],
      type: ["Movies"],
      region: ["Chinese", "US"],
      update: ["Popular"],
    });
  });

  it("normalizes the tier order: unknown dropped, missing appended", () => {
    const tiers = normalizeOleTiers({
      order: ["region", "bogus", "region"],
      type: [],
      region: [],
      update: [],
    });
    expect(tiers.order).toEqual(["region", "type", "update"]);
  });

  it("expands __all__ to every known option", () => {
    const tiers = normalizeOleTiers({
      type: ["__all__"],
      region: ["__all__"],
      update: [],
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
      "US",
      "UK",
      "Thai",
      "French",
      "German",
      "Italian",
      "Spanish",
      "Canadian",
      "Russian",
      "Dutch",
      "Australian",
    ]);
    expect(tiers.update).toEqual([]);
  });
});
