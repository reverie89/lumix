import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MetaDetail } from "@stremio-addon/sdk";
import { IyfScraper, iyfFamily, iyfSignature } from "./iyf.js";
import { Provider } from "../utils/config.js";
import { IYF_DEFAULT_MIRRORS } from "../utils/constant.js";

const axiosGet = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => null as unknown),
);
vi.mock("../utils/axios.js", () => ({
  axiosGet: (...args: unknown[]) => axiosGet(...args),
}));

// Route mocked upstreams by URL: a single getCatalog/getMeta run fires the
// iyf api AND the TMDB search (resolveProviderPoster) through axiosGet
function routeAxios(routes: [string, unknown][]) {
  axiosGet.mockImplementation((...args: unknown[]) => {
    const url = args[0] as string;
    const hit = routes.find(([fragment]) => url.includes(fragment));
    return Promise.resolve(hit ? hit[1] : null);
  });
}

const dbUpsertStream = vi.fn();
const dbGetProviderContent = vi.fn();
const dbUpsertProviderContent = vi.fn();
const dbGetContentByProviderId = vi.fn(async () => undefined);
vi.mock("../db/queries.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/queries.js")>();
  return {
    ...actual,
    getStreamsJoinProvider: vi.fn(async () => []),
    getContentByProviderId: () => dbGetContentByProviderId(),
    getProviderContentById: (id: string) => dbGetProviderContent(id),
    upsertProviderContent: (row: unknown) => dbUpsertProviderContent(row),
    upsertStream: (rows: unknown) => dbUpsertStream(rows),
  };
});

const { tmdbEnabled } = vi.hoisted(() => ({
  tmdbEnabled: vi.fn(() => false),
}));
vi.mock("./tmdb.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmdb.js")>();
  return { ...actual, isTmdbEnabled: () => tmdbEnabled() };
});

const listFixture = {
  data: {
    code: 0,
    msg: "",
    info: [
      {
        recordcount: 2,
        result: [
          {
            key: "nn9OH0QmRgC",
            title: "魅影神捕",
            image: "https://static.iyf.test/upload/video/a.jpg",
            atypeName: "电视剧",
            regional: "大陆",
            year: 2026,
          },
          {
            // VIP-only shelf rows exist upstream; the shelf name gates them
            key: "VIPROW00001",
            title: "付费大片",
            image: "https://static.iyf.test/upload/video/v.jpg",
            atypeName: "午夜版",
            year: 2026,
          },
        ],
      },
    ],
  },
};

const searchFixture = {
  data: {
    code: 0,
    msg: "",
    info: [
      {
        recordcount: 3,
        result: [
          {
            // briefsearch rows carry no key — it rides in contxt, and the
            // poster field is imgPath (the list rows use key/image)
            contxt: "SERIESKEY1",
            title: "某剧集",
            imgPath: "https://static.iyf.test/upload/video/s.jpg",
            atypeName: "电视剧",
          },
          {
            contxt: "MOVIEKEY01",
            title: "某电影",
            imgPath: "https://static.iyf.test/upload/video/m.jpg",
            atypeName: "电影",
          },
          {
            // Site uploads/news share the search index — dropped
            contxt: "NOISEKEY01",
            title: "某新闻",
            atypeName: "新闻",
          },
        ],
      },
    ],
  },
};

const detailFixture = {
  data: {
    code: 0,
    msg: "",
    info: [
      {
        id: 50376,
        key: "thAxXxmZ8A7",
        title: "恋爱充电中",
        cid: "0,1,4,133",
        imgPath: "https://static.iyf.test/upload/video/d.jpg",
        regional: "韩国",
        post_Year: "2026",
        contxt: "简介内容",
      },
    ],
  },
};

const playlistFixture = {
  data: {
    code: 0,
    msg: "",
    info: [
      {
        playList: [
          { id: 1611853, key: "gxs5GuW6p12", name: "01", isVip: false },
          { id: 1611855, key: "i6QlMvMW794", name: "02", isVip: false },
          { id: 1611856, key: "VIP00000001", name: "03", isVip: true },
        ],
      },
    ],
  },
};

const playFixture = {
  data: {
    code: 0,
    msg: "",
    info: [
      {
        uniqueKey: "50376_1611853",
        needLogin: 0,
        flvPathList: [
          {
            // The front-ad mp4 rides every play response — not the content
            isHls: false,
            result: "https://cdn.test/ad.mp4",
          },
          {
            isHls: true,
            result: "https://cdn.test/ep1/chunklist.m3u8?vhash=x",
          },
        ],
      },
    ],
  },
};

const scraper = new IyfScraper(Provider.IYF);

beforeEach(() => {
  axiosGet.mockReset();
  dbUpsertStream.mockReset();
  dbGetProviderContent.mockReset();
  dbUpsertProviderContent.mockReset();
  dbGetContentByProviderId.mockReset();
  dbGetContentByProviderId.mockResolvedValue(undefined);
  tmdbEnabled.mockReturnValue(false);
});

describe("iyfSignature", () => {
  it("matches the live API for a known query", () => {
    // Captured from the site bundle and accepted by m10.iyf.test (a wrong
    // signature answers 用户签名错误)
    expect(
      iyfSignature(
        "cinema=1&device=1&player=CkPlayer&tech=HLS&country=US&lang=cns&v=1&id=fFbERQGe4L5&region=US",
        "1791615056767",
      ),
    ).toBe("vv=f7ed00969a793e045d33d285569b49d0&pub=1791615056767");
  });

  it("signs the decoded values, so encoded and raw forms agree", () => {
    // The upstream decodes each value before checking the hash — signing the
    // percent-encoded form fails on every non-ASCII (Chinese) value
    const encoded = iyfSignature(
      "cinema=1&v=1&region=%E5%A4%A7%E9%99%86",
      "1791615056767",
    );
    const raw = iyfSignature("cinema=1&v=1&region=大陆", "1791615056767");
    expect(encoded).toBe(raw);
  });

  it("is hex-only and pub-prefixed", () => {
    const signature = iyfSignature("cinema=1&v=1", "1700000000000");
    expect(signature).toMatch(/^vv=[0-9a-f]{32}&pub=1700000000000$/);
  });
});

describe("iyfFamily", () => {
  it("derives the API hosts from a family root", () => {
    expect(iyfFamily("https://iyf.test")).toEqual({
      api: "https://m10.iyf.test",
      rank: "https://rankv21.iyf.test",
      image: "https://static.iyf.test",
      site: "https://www.iyf.test/",
    });
    expect(iyfFamily("https://aiyifan.test/")?.api).toBe("https://m10.aiyifan.test");
  });

  it("accepts a subdomain pick and strips the prefix", () => {
    expect(iyfFamily("https://m10.iyf.test")?.api).toBe("https://m10.iyf.test");
    expect(iyfFamily("https://rankv21.aiyifan.test")?.api).toBe(
      "https://m10.aiyifan.test",
    );
  });

  it("rejects non-URLs and non-http(s) schemes", () => {
    expect(iyfFamily("not a url")).toBeNull();
    expect(iyfFamily("ftp://iyf.test")).toBeNull();
  });
});

describe("getCatalog", () => {
  it("maps list rows to previews against the selected family", async () => {
    routeAxios([["api/list/Search", listFixture]]);
    const metas = await scraper.getCatalog(
      {
        id: "iyf.series.TVSeries",
        type: "series",
        extra: { skip: 0 },
      } as any,
      { providers: {} } as any,
    );
    // The section cid scopes the rows; shelf-name gating is a search-time
    // concern (the list corpus is already scoped, search's is not)
    expect(metas).toHaveLength(2);
    expect(metas[0]).toMatchObject({
      id: "iyf:nn9OH0QmRgC",
      name: "魅影神捕",
      type: "series",
      poster: "https://static.iyf.test/upload/video/a.jpg",
    });
    const url = (axiosGet.mock.calls[0]?.[0] ?? "") as string;
    // The catalog walks the config's mirrors, falling back to the env-driven
    // deployment default (vitest pins a synthetic host in vitest.config.ts)
    expect(url).toContain(
      "https://m10.iyf.test/api/list/Search?cinema=1&page=1&size=16&orderby=0&desc=1&cid=0,1,4",
    );
    expect(url).toMatch(/&vv=[0-9a-f]{32}&pub=\d+$/);
  });

  it("sends region, year and quality shelves as query filters", async () => {
    const config = { providers: {} } as any;
    for (const [id, fragment] of [
      ["iyf.series.Chinese", "&region=%E5%A4%A7%E9%99%86"],
      ["iyf.series.ThisYear", "&year=%E4%BB%8A%E5%B9%B4"],
      ["iyf.series.4K", "&vipResource=4K"],
      ["iyf.series.Popular", "&orderby=1"],
    ] as const) {
      routeAxios([["api/list/Search", listFixture]]);
      axiosGet.mockClear();
      await scraper.getCatalog({ id, type: "series", extra: {} } as any, config);
      // The catalog call precedes the TMDB poster lookups
      const url = (axiosGet.mock.calls[0]?.[0] ?? "") as string;
      expect(url, id).toContain(fragment);
    }
  });

  it("returns empty on an api error envelope", async () => {
    axiosGet.mockResolvedValue({
      data: { code: 1, msg: "用户签名错误", info: [] },
    });
    const metas = await scraper.getCatalog(
      { id: "iyf.series.TVSeries", type: "series", extra: {} } as any,
      { providers: {} } as any,
    );
    expect(metas).toEqual([]);
  });
});

describe("searchCatalog", () => {
  it("queries the rank host unsigned and filters by shelf", async () => {
    axiosGet.mockResolvedValue(searchFixture);
    const series = await scraper.searchCatalog(
      { type: "series", extra: { search: "某" } } as any,
      { providers: {} } as any,
    );
    expect(series.map((meta) => meta.id)).toEqual(["iyf:SERIESKEY1"]);
    const movies = await scraper.searchCatalog(
      { type: "movie", extra: { search: "某" } } as any,
      { providers: {} } as any,
    );
    expect(movies.map((meta) => meta.id)).toEqual(["iyf:MOVIEKEY01"]);
    const url = (axiosGet.mock.calls[0]?.[0] ?? "") as string;
    expect(url).toContain("https://rankv21.iyf.test/v3/list/briefsearch?");
    expect(url).toContain("tags=%E6%9F%90");
    expect(url).not.toContain("vv=");
  });
});

describe("getMeta", () => {
  it("builds videos from the free episodes of the playlist", async () => {
    routeAxios([
      ["/v3/video/detail", detailFixture],
      ["languagesplaylist", playlistFixture],
    ]);
    dbGetProviderContent.mockResolvedValue(undefined);
    const meta = await scraper.getMeta(
      {
        id: "thAxXxmZ8A7",
        iyfId: "thAxXxmZ8A7",
        title: "恋爱充电中",
        year: 2026,
        type: "series",
      } as any,
      "series",
      { providers: {} } as any,
    );
    expect(meta).toMatchObject({
      id: "iyf:thAxXxmZ8A7",
      name: "恋爱充电中",
      country: "韩国",
      poster: "https://static.iyf.test/upload/video/d.jpg",
    });
    // The vip entry is not an episode
    expect(meta?.videos?.map((video) => video.episode)).toEqual([1, 2]);
    expect(meta?.videos?.[0]?.id).toBe("iyf:thAxXxmZ8A7:1:1");
    expect(dbUpsertProviderContent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "iyf:thAxXxmZ8A7",
        provider: "iyf",
        externalId: "thAxXxmZ8A7",
      }),
    );
  });
});

describe("getStreams", () => {
  it("resolves the episode key and returns the hls path", async () => {
    routeAxios([
      ["/v3/video/detail", detailFixture],
      ["languagesplaylist", playlistFixture],
      ["/v3/video/play", playFixture],
    ]);
    const streams = await scraper.getStreams(
      {
        id: "thAxXxmZ8A7:1:2",
        iyfId: "thAxXxmZ8A7",
        title: "恋爱充电中",
        year: 2026,
        type: "series",
        season: 1,
        episode: 2,
      } as any,
      { providers: {} } as any,
    );
    expect(streams).toHaveLength(1);
    // The stream row keeps the signed url; the db row persists it clean
    // (cleanUrl strips the query, one row per upstream asset)
    expect(streams[0]?.url).toBe("https://cdn.test/ep1/chunklist.m3u8?vhash=x");
    expect(streams[0]?.description).toBe("S01E02");
    const playUrl = (axiosGet.mock.calls[2]?.[0] ?? "") as string;
    // The play call takes the requested episode's key
    expect(playUrl).toContain("/v3/video/play?cinema=1&id=i6QlMvMW794&");
    expect(dbUpsertStream).toHaveBeenCalledWith([
      expect.objectContaining({
        providerContentId: "iyf:thAxXxmZ8A7",
        season: "1",
        episode: "2",
        // The db replay row keeps the signed query — stripping it would
        // persist an unplayable url
        url: "https://cdn.test/ep1/chunklist.m3u8?vhash=x",
      }),
    ]);
  });

  it("falls back to the last free episode when the number is out of range", async () => {
    routeAxios([
      ["/v3/video/detail", detailFixture],
      ["languagesplaylist", playlistFixture],
      ["/v3/video/play", playFixture],
    ]);
    const streams = await scraper.getStreams(
      {
        id: "thAxXxmZ8A7:1:9",
        iyfId: "thAxXxmZ8A7",
        title: "恋爱充电中",
        year: 2026,
        type: "series",
        season: 1,
        episode: 9,
      } as any,
      { providers: {} } as any,
    );
    // Two free episodes exist; episode 9 clamps to the last one (ep 2's key)
    expect(streams[0]?.url).toBe("https://cdn.test/ep1/chunklist.m3u8?vhash=x");
    const playUrl = (axiosGet.mock.calls[2]?.[0] ?? "") as string;
    expect(playUrl).toContain("id=i6QlMvMW794");
  });

  it("returns no stream when the play response carries only ads", async () => {
    routeAxios([
      ["/v3/video/detail", detailFixture],
      ["languagesplaylist", playlistFixture],
      [
        "/v3/video/play",
        {
          data: {
            code: 0,
            msg: "",
            info: [
              { flvPathList: [{ isHls: false, result: "https://cdn.test/ad.mp4" }] },
            ],
          },
        },
      ],
    ]);
    const streams = await scraper.getStreams(
      {
        id: "thAxXxmZ8A7:1:1",
        iyfId: "thAxXxmZ8A7",
        title: "恋爱充电中",
        year: 2026,
        type: "series",
        season: 1,
        episode: 1,
      } as any,
      { providers: {} } as any,
    );
    expect(streams).toEqual([]);
  });
});

describe("getDetail", () => {
  it("throws the detail error for keys outside the site's alphabet", async () => {
    await expect(scraper.getDetail("../etc")).rejects.toMatchObject({
      name: "[IYF] Detail Error",
    });
  });
});
