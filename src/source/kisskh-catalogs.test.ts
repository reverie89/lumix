import { describe, expect, it } from "vitest";
import {
  expandKisskhCatalogs,
  getKisskhQuery,
  isSubtitleSourceHost,
  normalizeKisskhTiers,
} from "./kisskh-catalogs.js";

describe("expandKisskhCatalogs", () => {
  it("expands each type pick to its own row", () => {
    const ids = expandKisskhCatalogs({
      type: ["TVSeries", "Anime"],
      region: [],
      status: [],
      update: [],
    });
    expect(ids).toEqual([
      "kisskh.series.TVSeries",
      "kisskh.series.Anime",
    ]);
  });

  it("adds a series and a movies row per region", () => {
    const ids = expandKisskhCatalogs({
      type: [],
      region: ["Korean"],
      status: [],
      update: [],
    });
    expect(ids.sort()).toEqual([
      "kisskh.movie.Korean",
      "kisskh.series.Korean",
    ]);
  });

  it("maps US to series and movies rows (Hollywood upstream)", () => {
    const ids = expandKisskhCatalogs({
      type: [],
      region: ["US"],
      status: [],
      update: [],
    });
    expect(ids.sort()).toEqual(["kisskh.movie.US", "kisskh.series.US"]);
  });

  it("keeps status rows series-only and update rows paired", () => {
    const ids = expandKisskhCatalogs({
      type: [],
      region: [],
      status: ["Ongoing"],
      update: ["Release Date"],
    });
    expect(ids.sort()).toEqual([
      "kisskh.movie.Release Date",
      "kisskh.series.Ongoing",
      "kisskh.series.Release Date",
    ]);
  });

  it("expands tiers in the configured order", () => {
    const ids = expandKisskhCatalogs({
      order: ["update", "region", "type", "status"],
      type: ["TVSeries"],
      region: ["Korean"],
      status: [],
      update: ["Popular"],
    });
    expect(ids).toEqual([
      "kisskh.series.Popular",
      "kisskh.movie.Popular",
      "kisskh.series.Korean",
      "kisskh.movie.Korean",
      "kisskh.series.TVSeries",
    ]);
  });

  it("drops unknown options", () => {
    const ids = expandKisskhCatalogs({
      type: ["Nonsense"],
      region: ["Atlantis"],
      status: ["Paused"],
      update: ["Random"],
    });
    expect(ids).toEqual([]);
  });

  it("expands __all__ to every option of the tier", () => {
    const ids = expandKisskhCatalogs({
      type: ["__all__"],
      region: [],
      status: ["__all__"],
      update: [],
    });
    expect(ids).toContain("kisskh.series.TVSeries");
    expect(ids).toContain("kisskh.movie.Movies");
    expect(ids).toContain("kisskh.series.Anime");
    expect(ids).toContain("kisskh.series.Hollywood");
    expect(ids).toContain("kisskh.movie.Hollywood");
    expect(ids).toContain("kisskh.series.Ongoing");
    expect(ids).toContain("kisskh.series.Completed");
  });
});

describe("getKisskhQuery", () => {
  it("defaults the API type from the Stremio type", () => {
    expect(getKisskhQuery("Korean", "series")).toEqual({
      type: "1",
      country: "2",
      status: "0",
      order: "2",
    });
    expect(getKisskhQuery("Korean", "movie")).toMatchObject({ type: "2" });
  });

  it("resolves type categories regardless of the Stremio type", () => {
    expect(getKisskhQuery("Anime", "series")?.type).toBe("3");
    expect(getKisskhQuery("Hollywood", "movie")?.type).toBe("4");
    expect(getKisskhQuery("Movies", "series")?.type).toBe("2");
  });

  it("resolves US like Hollywood (no country filter)", () => {
    const query = getKisskhQuery("US", "series");
    expect(query).toMatchObject({ type: "4", country: "0" });
  });

  it("resolves status and update sorts", () => {
    expect(getKisskhQuery("Ongoing", "series")).toMatchObject({
      status: "1",
      type: "1",
    });
    expect(getKisskhQuery("Completed", "series")).toMatchObject({
      status: "2",
    });
    expect(getKisskhQuery("Popular", "movie")).toMatchObject({ order: "1" });
    expect(getKisskhQuery("Release Date", "movie")).toMatchObject({ order: "3" });
    expect(getKisskhQuery("Last Update", "series")).toMatchObject({ order: "2" });
  });

  it("returns null for unknown names", () => {
    expect(getKisskhQuery("Search", "series")).toBeNull();
    expect(getKisskhQuery("Koreaan", "series")).toBeNull();
  });
});

describe("normalizeKisskhTiers", () => {
  it("keeps known options in order and dedupes", () => {
    const tiers = normalizeKisskhTiers({
      type: ["TVSeries", "TVSeries", "Bogus"],
      region: ["Korean", "US"],
      status: ["Ongoing"],
      update: ["Last Update"],
    });
    expect(tiers).toEqual({
      // No order given: the canonical tier order
      order: ["type", "region", "status", "update"],
      type: ["TVSeries"],
      region: ["Korean", "US"],
      status: ["Ongoing"],
      update: ["Last Update"],
    });
  });

  it("normalizes the tier order: unknown dropped, missing appended", () => {
    const tiers = normalizeKisskhTiers({
      order: ["update", "bogus", "update", "region"],
      type: [],
      region: [],
      status: [],
      update: [],
    });
    expect(tiers.order).toEqual(["update", "region", "type", "status"]);
  });

  it("expands __all__ to every known option", () => {
    const tiers = normalizeKisskhTiers({
      type: ["__all__"],
      region: ["__all__"],
      status: [],
      update: [],
    });
    expect(tiers.type).toEqual(["TVSeries", "Movies", "Anime", "Hollywood"]);
    expect(tiers.region).toEqual([
      "Korean",
      "Chinese",
      "Japanese",
      "Hongkong",
      "Thai",
      "Taiwanese",
      "Philippine",
      "Indonesian",
      "Singaporean",
      "Vietnamese",
      "Turkish",
      "Indian",
      "Malaysian",
      "US",
    ]);
    expect(tiers.status).toEqual([]);
    expect(tiers.update).toEqual([]);
  });
});

describe("isSubtitleSourceHost", () => {
  it("accepts kisskh mirrors and the kisskh CDN", () => {
    expect(isSubtitleSourceHost("sub.cdnvideo11.shop")).toBe(true);
    expect(isSubtitleSourceHost("hls08.cdnvideo11.shop")).toBe(true);
    expect(isSubtitleSourceHost("cdnvideo11.shop")).toBe(true);
  });

  it("rejects lookalike and unrelated hosts", () => {
    expect(isSubtitleSourceHost("cdnvideo11.shop.evil.com")).toBe(false);
    expect(isSubtitleSourceHost("evil-cdnvideo11.shop")).toBe(false);
    expect(isSubtitleSourceHost("169.254.169.254")).toBe(false);
    expect(isSubtitleSourceHost("localhost")).toBe(false);
  });
});
