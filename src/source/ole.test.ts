import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MetaDetail } from "@stremio-addon/sdk";
import { OleScraper, vvParam } from "./ole.js";
import { Provider } from "../utils/config.js";
import { OLE_DEFAULT_MIRRORS } from "../utils/constant.js";

const axiosGet = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) => null as unknown),
);
vi.mock("../utils/axios.js", () => ({
  axiosGet: (...args: unknown[]) => axiosGet(...args),
}));

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
  code: 0,
  msg: "ok",
  data: {
    total: 6834,
    list: [
      {
        id: 84191,
        typeId1: 2,
        name: "美国人质",
        pic: "upload/vod/a.jpg",
        picThumb: "upload/vod/a.jpg_384x560.jpg",
        vip: false,
      },
      {
        // VIP蓝光影院 shelf row: vip flag set, no free stream url upstream
        id: 7579,
        typeId1: 6,
        name: "复仇者联盟3：无限战争",
        pic: "upload/vod/b.jpg",
        vip: true,
      },
    ],
  },
};

const detailFixture = {
  code: 0,
  msg: "ok",
  data: {
    id: 85005,
    typeId1: 2,
    name: "再次奔向你",
    pic: "upload/vod/20260926-1/c.jpg",
    picThumb: "upload/vod/20260926-1/c.jpg_384x560.jpg",
    area: "韩国",
    lang: "韩语",
    year: "2026",
    vip: false,
    content: "简介内容",
    urls: [
      { index: 1, title: "第01集", url: "https://cdn.test/ep1/master.m3u8", vip: false },
      { index: 2, title: "第02集", url: "https://cdn.test/ep2/master.m3u8", vip: false },
      { index: 3, title: "第03集", url: "", vip: true },
    ],
  },
};

const searchFixture = {
  code: 0,
  msg: "ok",
  data: {
    total: 3,
    data: [
      { type: "vod", total: 1, list: [{ id: 9, typeId1: 1, name: "某电影", pic: "p.jpg", vip: false }] },
      { type: "vod", total: 2, list: null },
      {
        type: "vod",
        total: 2,
        list: [
          { id: 10, typeId1: 2, name: "某剧集", pic: "s.jpg", vip: false },
          { id: 11, typeId1: 6, name: "某VIP电影", pic: "v.jpg", vip: true },
        ],
      },
    ],
  },
};

const scraper = new OleScraper(Provider.OLE);

beforeEach(() => {
  axiosGet.mockReset();
  dbUpsertStream.mockReset();
  dbGetProviderContent.mockReset();
  dbUpsertProviderContent.mockReset();
  dbGetContentByProviderId.mockReset();
  dbGetContentByProviderId.mockResolvedValue(undefined);
  tmdbEnabled.mockReturnValue(false);
});

describe("vvParam", () => {
  it("matches the site's signature for known timestamps", () => {
    // Vectors captured against the live API (a wrong signature returns 401)
    expect(vvParam("1700000000")).toBe("249000ecf8310060b801007a28e300c1");
    expect(vvParam("999999999")).toBe("c8c1ff999f300052d7b0002cf3f1ff5b");
    expect(vvParam("1000000001")).toBe("40400043a060006054a0009b42b2017f");
  });

  it("is deterministic and hex-only", () => {
    const a = vvParam("1700000000");
    expect(a).toBe(vvParam("1700000000"));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("getCatalog", () => {
  it("maps list rows to previews and drops vip rows", async () => {
    axiosGet.mockResolvedValue(listFixture);
    const metas = await scraper.getCatalog(
      {
        id: "ole.series.TVSeries",
        type: "series",
        extra: { skip: 0 },
      } as any,
      { providers: {} } as any,
    );
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({
      id: "ole:84191",
      name: "美国人质",
      type: "series",
      poster: "https://static.olelive.com/upload/vod/a.jpg_384x560.jpg",
    });
    const url = (axiosGet.mock.calls[0]?.[0] ?? "") as string;
    // The catalog walks the config's mirrors, falling back to the env-driven
    // deployment default (vitest pins a synthetic host in vitest.config.ts)
    expect(url).toContain(
      `${OLE_DEFAULT_MIRRORS[0]}/v1/pub/vod/list/true/3/0/0/2/0/0/update/1/16?_vv=`,
    );
    expect(url).toMatch(/_vv=[0-9a-f]{32}$/);
  });

  it("gives movies a default video id", async () => {
    axiosGet.mockResolvedValue(listFixture);
    const metas = await scraper.getCatalog(
      { id: "ole.movie.Movies", type: "movie", extra: {} } as any,
      { providers: {} } as any,
    );
    // The fixture's single free row is a series (typeId1 2), but the movie
    // catalog still renders it — the API's typeId1 filters, not the client's
    expect((metas[0] as MetaDetail)?.behaviorHints?.defaultVideoId).toBe(
      "ole:84191:1:1",
    );
  });

  it("returns empty on an api error envelope", async () => {
    axiosGet.mockResolvedValue({ code: 401, msg: "用户签名错误" });
    const metas = await scraper.getCatalog(
      { id: "ole.series.TVSeries", type: "series", extra: {} } as any,
      { providers: {} } as any,
    );
    expect(metas).toEqual([]);
  });
});

describe("searchCatalog", () => {
  it("flattens groups, filters by side, and skips unplayable rows", async () => {
    axiosGet.mockResolvedValue(searchFixture);
    const series = await scraper.searchCatalog(
      { type: "series", extra: { search: "某" } } as any,
      { providers: {} } as any,
    );
    expect(series.map((meta) => meta.id)).toEqual(["ole:10"]);
    const movies = await scraper.searchCatalog(
      { type: "movie", extra: { search: "某" } } as any,
      { providers: {} } as any,
    );
    expect(movies.map((meta) => meta.id)).toEqual(["ole:9"]);
  });
});

describe("getMeta", () => {
  it("builds videos from the free episode urls", async () => {
    axiosGet.mockResolvedValue(detailFixture);
    dbGetProviderContent.mockResolvedValue(undefined);
    const meta = await scraper.getMeta(
      {
        id: "85005",
        oleId: "85005",
        title: "再次奔向你",
        year: 2026,
        type: "series",
      } as any,
      "series",
      { providers: {} } as any,
    );
    expect(meta).toMatchObject({
      id: "ole:85005",
      name: "再次奔向你",
      country: "韩国",
      poster: "https://static.olelive.com/upload/vod/20260926-1/c.jpg_384x560.jpg",
    });
    // The vip row (empty url) is not an episode
    expect(meta?.videos?.map((video) => video.episode)).toEqual([1, 2]);
    expect(dbUpsertProviderContent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ole:85005",
        provider: "ole",
        externalId: "85005",
      }),
    );
  });
});

describe("getStreams", () => {
  it("returns the requested episode's stream url", async () => {
    axiosGet.mockResolvedValue(detailFixture);
    const streams = await scraper.getStreams(
      {
        id: "85005:1:2",
        oleId: "85005",
        title: "再次奔向你",
        year: 2026,
        type: "series",
        season: 1,
        episode: 2,
      } as any,
      { providers: {} } as any,
    );
    expect(streams).toHaveLength(1);
    expect(streams[0]?.url).toBe("https://cdn.test/ep2/master.m3u8");
    expect(streams[0]?.description).toBe("S01E02");
    expect(dbUpsertStream).toHaveBeenCalledWith([
      expect.objectContaining({
        providerContentId: "ole:85005",
        season: "1",
        episode: "2",
        url: "https://cdn.test/ep2/master.m3u8",
      }),
    ]);
  });

  it("falls back to the last free episode when the number is out of range", async () => {
    axiosGet.mockResolvedValue(detailFixture);
    const streams = await scraper.getStreams(
      {
        id: "85005:1:99",
        oleId: "85005",
        title: "再次奔向你",
        year: 2026,
        type: "series",
        season: 1,
        episode: 99,
      } as any,
      { providers: {} } as any,
    );
    expect(streams[0]?.url).toBe("https://cdn.test/ep2/master.m3u8");
  });

  it("serves nothing without an id and no search hit", async () => {
    axiosGet.mockResolvedValue(searchFixture);
    const streams = await scraper.getStreams(
      {
        id: "tt123",
        title: "不存在的东西",
        year: 2001,
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
  it("rejects non-numeric ids before they reach the api path", async () => {
    await expect(
      scraper.getDetail("../evil", { providers: {} } as any),
    ).rejects.toThrow("Invalid ole id");
    expect(axiosGet).not.toHaveBeenCalled();
  });
});

describe("getSubtitles", () => {
  it("returns no tracks (subtitles are hardcoded upstream)", async () => {
    expect(await scraper.getSubtitles({} as any)).toEqual([]);
  });
});
