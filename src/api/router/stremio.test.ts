import { describe, expect, it } from "vitest";
import { Provider } from "../../utils/config.js";
import { defaultConfig } from "../../lib/manifest.js";
import {
  IYF_DEFAULT_MIRRORS,
  KISSKH_DEFAULT_MIRRORS,
  OLE_DEFAULT_MIRRORS,
} from "../../utils/constant.js";
import {
  IYF_HIDDEN_CATALOGS,
} from "../../source/iyf-catalogs.js";
import {
  OLE_HIDDEN_CATALOGS,
} from "../../source/ole-catalogs.js";
import { decodeConfig, getResourceLimitResponse } from "./stremio.js";

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value), "utf-8").toString("base64");

const tierConfig = {
  providers: {
    kisskh: {
      mirrors: [
        "https://kisskh.test",
        "http://kisskh.test", // insecure but allowed: any http(s) URL is a mirror
        "https://kisskh.example.evil.com", // a mirror is any http(s) URL: lookalike hosts pass too
        "https://other.com",
        "kisskh.test", // no scheme: rejected (the config page adds https://)
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
        "https://kisskh.test",
        "http://kisskh.test",
        "https://kisskh.example.evil.com",
        "https://other.com",
      ],
      // No order given: the canonical tier order
      order: ["type", "region", "status", "update"],
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

  it("deduplicates mirrors, keeping the first occurrence's form", () => {
    const config = decodeConfig(
      encode({
        providers: {
          kisskh: {
            mirrors: [
              "https://KissKh.TEST/",
              "https://kisskh.test", // same mirror, different case: dropped
              "https://kisskh.test/", // same mirror, trailing slash: dropped
              "https://kisskh2.test",
            ],
          },
        },
      }),
    );
    expect(config.providers.kisskh?.mirrors).toEqual([
      "https://KissKh.TEST/",
      "https://kisskh2.test",
    ]);
  });

  it("keeps a picked zh language and reads absent, invalid or legacy values as en", () => {
    expect(decodeConfig(encode({ language: "zh", ...tierConfig })).language).toBe(
      "zh",
    );
    expect(decodeConfig(encode(tierConfig)).language).toBe("en");
    expect(
      decodeConfig(encode({ language: "fr", ...tierConfig })).language,
    ).toBe("en");
    const legacy = {
      catalogs: ["kisskh.series.Korean"],
      catalog: ["kisskh"],
      stream: ["kisskh"],
    };
    expect(decodeConfig(encode(legacy)).language).toBe("en");
  });

  it("normalizes ole tiers and keeps both providers when both are picked", () => {
    const config = decodeConfig(
      encode({
        providers: {
          kisskh: { mirrors: [], type: ["TVSeries"], region: [], status: [], update: [] },
          ole: {
            mirrors: ["api.ole.test"], // no scheme: the page would add https://
            type: ["Movies", "TVSeries"],
            region: ["Korean", "午夜影院"],
            update: ["Popular"],
          },
        },
      }),
    );
    expect(config.providers.ole).toEqual({
      mirrors: [],
      // No order given: the canonical tier order
      order: ["type", "region", "update"],
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

  it("orders providers and tiers by the config's order fields", () => {
    const config = decodeConfig(
      encode({
        order: ["ole", "bogus", "kisskh"],
        providers: {
          kisskh: {
            mirrors: [],
            order: ["region", "type", "status", "update"],
            type: ["TVSeries"],
            region: ["Korean"],
            status: [],
            update: [],
          },
          ole: {
            mirrors: [],
            type: ["Movies"],
            region: [],
            update: [],
          },
        },
      }),
    );
    expect(config.catalog).toEqual([Provider.OLE, Provider.KISSKH]);
    // 欧乐 rows first, kisskh region rows before its type rows, hidden
    // search rows last within each provider
    expect(config.catalogs).toEqual([
      "ole.movie.Movies",
      "ole.series.Search",
      "ole.movie.Search",
      "kisskh.series.Korean",
      "kisskh.movie.Korean",
      "kisskh.series.TVSeries",
      "kisskh.series.Search",
      "kisskh.movie.Search",
    ]);
  });

  it("appends providers missing from the order after the named ones", () => {
    const config = decodeConfig(
      encode({
        order: ["OLE"], // case-insensitive; kisskh missing: appended after
        providers: {
          kisskh: { mirrors: [], type: ["TVSeries"], region: [], status: [], update: [] },
          ole: { mirrors: [], type: ["TVSeries"], region: [], update: [] },
        },
      }),
    );
    expect(config.catalog).toEqual([Provider.OLE, Provider.KISSKH]);
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
    expect(fallback.catalog).toEqual([
      Provider.KISSKH,
      Provider.OLE,
      Provider.IYF,
    ]);
    expect(fallback.catalogs.length).toBeGreaterThan(0);
    // Valid JSON of the wrong shape falls back to the default catalogs
    const wrongShape = decodeConfig(encode("just a string"));
    expect(wrongShape.providers.kisskh).toBeDefined();
    expect(wrongShape.providers.ole).toBeDefined();
    expect(wrongShape.providers.iyf).toBeDefined();
    expect(wrongShape.catalog).toEqual([
      Provider.KISSKH,
      Provider.OLE,
      Provider.IYF,
    ]);
    // Deeply nested JSON that crashes JSON.parse is caught like any other
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 100000; i++) deep = { nested: deep };
    const crashed = decodeConfig(encode(deep));
    expect(crashed.catalogs.length).toBeGreaterThan(0);
  });

  it("decodes the saved default-config link into the built-in defaultConfig", () => {
    // The link the deployment owner saved as lumix's default: a fresh config
    // page and the unconfigured manifest must serve exactly this selection,
    // so decodeConfig has to reproduce defaultConfig from it. The mirror
    // lists come from the same constants the page pre-fills from (public.ts
    // injects them into the page), so the link and the constants cannot drift.
    const savedLink = {
      language: "en",
      order: ["kisskh", "ole", "iyf"],
      providers: {
        kisskh: {
          mirrors: KISSKH_DEFAULT_MIRRORS,
          order: ["update", "type", "region", "status"],
          type: ["TVSeries", "Movies"],
          region: ["Korean", "Chinese", "US"],
          status: [],
          update: ["Last Update"],
        },
        ole: {
          mirrors: OLE_DEFAULT_MIRRORS,
          order: ["type", "region", "update"],
          type: ["TVSeries", "Movies", "Variety", "ShortDrama"],
          region: ["Chinese", "Hongkong", "US"],
          update: [],
        },
        iyf: {
          mirrors: IYF_DEFAULT_MIRRORS,
          order: ["type", "region", "year", "quality", "sort"],
          type: ["TVSeries", "Movies"],
          region: ["Chinese", "Hongkong"],
          year: [],
          quality: [],
          sort: [],
        },
      },
    };
    const config = decodeConfig(
      Buffer.from(JSON.stringify(savedLink), "utf-8").toString("base64url"),
    );
    expect(config.catalogs).toEqual(defaultConfig.catalogs);
    expect(config.catalog).toEqual(defaultConfig.catalog);
    expect(config.stream).toEqual(defaultConfig.stream);
    expect(config.providers.kisskh).toEqual({
      ...defaultConfig.providers.kisskh,
      mirrors: KISSKH_DEFAULT_MIRRORS,
    });
    expect(config.providers.ole).toEqual({
      ...defaultConfig.providers.ole,
      mirrors: OLE_DEFAULT_MIRRORS,
    });
    expect(config.providers.iyf).toEqual({
      ...defaultConfig.providers.iyf,
      mirrors: IYF_DEFAULT_MIRRORS,
    });
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

  it("normalizes iyf tiers and appends the hidden search rows", () => {
    const config = decodeConfig(
      encode({
        order: ["iyf"],
        providers: {
          iyf: {
            mirrors: ["https://iyf.test"],
            type: ["TVSeries", "Bogus"],
            region: ["Chinese", "Atlantis"],
            year: ["ThisYear"],
            quality: ["8K"],
            sort: ["Popular"],
          },
        },
      }),
    );
    expect(config.providers.iyf).toEqual({
      mirrors: ["https://iyf.test"],
      order: ["type", "region", "year", "quality", "sort"],
      type: ["TVSeries"],
      region: ["Chinese"],
      year: ["ThisYear"],
      quality: [],
      sort: ["Popular"],
    });
    expect(config.catalog).toEqual([Provider.IYF]);
    expect(config.catalogs).toEqual([
      "iyf.series.TVSeries",
      "iyf.series.Chinese",
      "iyf.movie.Chinese",
      "iyf.series.ThisYear",
      "iyf.movie.ThisYear",
      "iyf.series.Popular",
      "iyf.movie.Popular",
      ...IYF_HIDDEN_CATALOGS,
    ]);
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
