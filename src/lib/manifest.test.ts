import { describe, expect, it } from "vitest";
import type {
  IyfSettings,
  KisskhSettings,
  OleSettings,
  UserConfig,
} from "../utils/config.js";
import { buildManifest, defaultConfig } from "./manifest.js";
import { Provider } from "../utils/config.js";
import { KISSKH_HIDDEN_CATALOGS, normalizeKisskhTiers } from "../source/kisskh-catalogs.js";
import { OLE_HIDDEN_CATALOGS, normalizeOleTiers } from "../source/ole-catalogs.js";
import { IYF_HIDDEN_CATALOGS, normalizeIyfTiers } from "../source/iyf-catalogs.js";
import {
  MANIFEST_DESCRIPTION_ZH,
  PROVIDER_LABELS,
  TIER_LABELS_ZH,
} from "../utils/constant.js";

describe("buildManifest logo", () => {
  it("stamps the logo with the requesting origin without poisoning the memo", () => {
    const first = buildManifest(undefined, "https://a.example.com");
    expect(first.logo).toBe("https://a.example.com/img/lumix.ico");
    // The default-manifest memo must not pin the first origin it served
    const second = buildManifest(undefined, "https://b.example.com");
    expect(second.logo).toBe("https://b.example.com/img/lumix.ico");
  });
});

describe("defaultConfig", () => {
  it("pins the default kisskh tiers and order", () => {
    const kisskh = defaultConfig.providers.kisskh as KisskhSettings;
    expect(kisskh.order).toEqual(["update", "type", "region", "status"]);
    expect(kisskh.update).toEqual(["Last Update"]);
    expect(kisskh.type).toEqual(["TVSeries", "Movies"]);
    expect(kisskh.region).toEqual(["Korean", "Chinese", "US"]);
    // status defaults to none — no Ongoing/Completed rows anywhere
    expect(kisskh.status).toEqual([]);
  });

  it("pins the default ole tiers and order", () => {
    const ole = defaultConfig.providers.ole as OleSettings;
    expect(ole.order).toEqual(["type", "region", "update"]);
    expect(ole.type).toEqual(["TVSeries", "Movies", "Variety", "ShortDrama"]);
    expect(ole.region).toEqual(["Chinese", "Hongkong", "US"]);
    // update defaults to none — no Popular/Score rows anywhere
    expect(ole.update).toEqual([]);
  });

  it("pins the default iyf tiers — enabled alongside kisskh and ole", () => {
    const iyf = defaultConfig.providers.iyf as IyfSettings;
    expect(iyf.order).toEqual(["type", "region", "year", "quality", "sort"]);
    expect(iyf.type).toEqual(["TVSeries", "Movies"]);
    expect(iyf.region).toEqual(["Chinese", "Hongkong"]);
    // year/quality/sort default to none — no bucket or ranking rows
    expect(iyf.year).toEqual([]);
    expect(iyf.quality).toEqual([]);
    expect(iyf.sort).toEqual([]);
    // Third in line after kisskh and 欧乐: the unconfigured manifest and
    // default traffic scrape it too
    expect(defaultConfig.catalog).toEqual([
      Provider.KISSKH,
      Provider.OLE,
      Provider.IYF,
    ]);
    expect(defaultConfig.stream).toEqual([
      Provider.KISSKH,
      Provider.OLE,
      Provider.IYF,
    ]);
    expect(
      defaultConfig.catalogs.some((id) => id.startsWith("iyf.")),
    ).toBe(true);
  });

  it("expands the default tiers with no status or year rows, update rows first, kisskh then ole then iyf", () => {
    expect(defaultConfig.catalogs).toEqual([
      "kisskh.series.Last Update",
      "kisskh.movie.Last Update",
      "kisskh.series.TVSeries",
      "kisskh.movie.Movies",
      "kisskh.series.Korean",
      "kisskh.movie.Korean",
      "kisskh.series.Chinese",
      "kisskh.movie.Chinese",
      "kisskh.series.US",
      "kisskh.movie.US",
      ...KISSKH_HIDDEN_CATALOGS,
      "ole.series.TVSeries",
      "ole.movie.Movies",
      "ole.series.Variety",
      "ole.series.ShortDrama",
      "ole.series.Chinese",
      "ole.movie.Chinese",
      "ole.series.Hongkong",
      "ole.movie.Hongkong",
      "ole.series.US",
      "ole.movie.US",
      ...OLE_HIDDEN_CATALOGS,
      "iyf.series.TVSeries",
      "iyf.movie.Movies",
      "iyf.series.Chinese",
      "iyf.movie.Chinese",
      "iyf.series.Hongkong",
      "iyf.movie.Hongkong",
      ...IYF_HIDDEN_CATALOGS,
    ]);
  });

  it("serves the default catalogs in the unconfigured manifest", () => {
    const manifest = buildManifest(undefined);
    expect(manifest.catalogs.map((catalog) => catalog.id)).toEqual(
      defaultConfig.catalogs,
    );
  });
});

describe("buildManifest language", () => {
  const languageConfig = (language: "en" | "zh"): UserConfig => ({
    ...defaultConfig,
    language,
    catalogs: [
      "kisskh.series.Korean",
      "kisskh.movie.Search",
      "ole.movie.Chinese",
    ],
    catalog: [Provider.KISSKH, Provider.OLE],
    stream: [],
  });

  it("localizes catalog names and the description for a zh config", () => {
    const manifest = buildManifest(languageConfig("zh"));
    expect(manifest.description).toBe(MANIFEST_DESCRIPTION_ZH);
    expect(manifest.catalogs.map((catalog) => catalog.name)).toEqual([
      "[L/kisskh] 韩国",
      "[L/kisskh] 搜索",
      "[L/欧乐] 大陆",
    ]);
  });

  it("keeps the English catalog names and description otherwise", () => {
    const manifest = buildManifest(languageConfig("en"));
    expect(manifest.catalogs.map((catalog) => catalog.name)).toEqual([
      "[L/kisskh] Korean",
      "[L/kisskh] Search",
      "[L/欧乐] Chinese",
    ]);
    // Same description the unconfigured manifest serves
    expect(manifest.description).toBe(buildManifest(undefined).description);
  });

  it("labels every tier option of every provider in zh (no catalog name falls back to the raw token)", () => {
    const kisskh = normalizeKisskhTiers({
      type: ["__all__"],
      region: ["__all__"],
      status: ["__all__"],
      update: ["__all__"],
    });
    const ole = normalizeOleTiers({
      type: ["__all__"],
      region: ["__all__"],
      update: ["__all__"],
    });
    const iyf = normalizeIyfTiers({
      type: ["__all__"],
      region: ["__all__"],
      year: ["__all__"],
      quality: ["__all__"],
      sort: ["__all__"],
    });
    // Explicit tier keys: the normalized shapes also carry `order`, whose
    // entries (tier names) are not catalog options
    const options = new Set([
      ...kisskh.type,
      ...kisskh.region,
      ...kisskh.status,
      ...kisskh.update,
      ...ole.type,
      ...ole.region,
      ...ole.update,
      ...iyf.type,
      ...iyf.region,
      ...iyf.year,
      ...iyf.quality,
      ...iyf.sort,
      // hidden search catalogs get manifest names too
      "Search",
    ]);
    expect(options.size).toBeGreaterThan(0);
    for (const option of options) {
      expect(TIER_LABELS_ZH[option], `missing zh label for ${option}`).toBeTruthy();
    }
    for (const provider of [Provider.KISSKH, Provider.OLE, Provider.IYF]) {
      expect(PROVIDER_LABELS[provider], `missing label for ${provider}`).toBeTruthy();
    }
  });

});
