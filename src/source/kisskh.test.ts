import { beforeEach, describe, expect, it, vi } from "vitest";
import { KisskhScraper } from "./kisskh.js";
import { Provider } from "../utils/config.js";
import { KISSKH_DEFAULT_MIRRORS } from "../utils/constant.js";
import { tmdb } from "./tmdb.js";

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

// Route mocked upstreams by URL: one getStreams run fires the token script
// chain, the series detail and the episode endpoint through axiosGet
function routeAxios(routes: [string, unknown][]) {
  axiosGet.mockImplementation((...args: unknown[]) => {
    const url = args[0] as string;
    const hit = routes.find(([fragment]) => url.includes(fragment));
    return Promise.resolve(hit ? hit[1] : null);
  });
}

const { tmdbEnabled } = vi.hoisted(() => ({
  tmdbEnabled: vi.fn(() => false),
}));
vi.mock("./tmdb.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmdb.js")>();
  return { ...actual, isTmdbEnabled: () => tmdbEnabled() };
});
// dotenv loads the developer's .env, whose real key would send searchDetail
// to the network — pin the poster search off so these tests stay offline
const searchDetail = vi.spyOn(tmdb, "searchDetail");
// The type gate consults verifyType per title; the spy decides verdicts
// (null keeps the item) without touching isTmdbEnabled
const verifyType = vi.spyOn(tmdb, "verifyType");

// Raw List rows as upstream serves them: pre-premiere shows carry a
// "Coming <date>" label, live ones a blank/whitespace one (or none)
const catalogFixture = {
  data: [
    {
      id: 13795,
      title: "100 Days of Deception (2026)",
      episodesCount: 1,
      thumbnail: "https://img/a.jpg",
      label: " Coming Oct 10",
    },
    {
      id: 13907,
      title: "The Lament of Autumn (2026)",
      episodesCount: 4,
      thumbnail: "https://img/b.jpg",
      label: "Coming Oct 11",
    },
    {
      id: 13632,
      title: "Take Charge of My Heart (2026)",
      episodesCount: 10,
      thumbnail: "https://img/c.jpg",
      label: "",
    },
    {
      id: 13826,
      title: "Shadow Punisher (2026)",
      episodesCount: 20,
      thumbnail: "https://img/d.jpg",
      label: " ",
    },
    {
      id: 12178,
      title: "Beyond Time's Gaze",
      episodesCount: 43,
      thumbnail: "https://img/e.jpg",
    },
  ],
};

const searchFixture = [
  {
    id: 13907,
    title: "The Lament of Autumn (2026)",
    episodesCount: 4,
    thumbnail: "https://img/b.jpg",
    label: "Coming Oct 11",
  },
  {
    id: 13632,
    title: "Take Charge of My Heart (2026)",
    episodesCount: 10,
    thumbnail: "https://img/c.jpg",
    label: " ",
  },
];

const scraper = new KisskhScraper(Provider.KISSKH);

beforeEach(() => {
  axiosGet.mockReset();
  dbGetContentByProviderId.mockResolvedValue(undefined);
  dbGetProviderContent.mockResolvedValue(undefined);
  dbUpsertStream.mockReset();
  dbUpsertProviderContent.mockReset();
  tmdbEnabled.mockReturnValue(false);
  searchDetail.mockReset();
  searchDetail.mockResolvedValue(null);
  verifyType.mockReset();
  verifyType.mockResolvedValue(null);
});

describe("getCatalog", () => {
  it("drops Coming-labeled rows and keeps blank-labeled ones", async () => {
    axiosGet.mockResolvedValue(catalogFixture);
    const metas = await scraper.getCatalog(
      {
        id: "kisskh.series.TVSeries",
        type: "series",
        extra: { skip: 0 },
      } as any,
      { providers: {} } as any,
    );
    expect(metas.map((meta) => meta.id)).toEqual([
      "kisskh:13632",
      "kisskh:13826",
      "kisskh:12178",
    ]);
    const url = (axiosGet.mock.calls[0]?.[0] ?? "") as string;
    expect(url).toContain(
      `${KISSKH_DEFAULT_MIRRORS[0]}/api/DramaList/List?page=1`,
    );
  });
});

describe("getCatalog type gate", () => {
  it("drops items whose TMDB-verified type contradicts the row, keeps unsure ones", async () => {
    axiosGet.mockResolvedValue({
      data: [
        {
          id: 1,
          title: "Agreeing Drama",
          episodesCount: 16,
          thumbnail: "https://img/a.jpg",
          label: "",
        },
        {
          id: 2,
          title: "Secretly a Movie",
          episodesCount: 3,
          thumbnail: "https://img/b.jpg",
          label: "",
        },
        {
          id: 3,
          title: "Unknown to TMDB",
          episodesCount: 8,
          thumbnail: "https://img/c.jpg",
          label: "",
        },
      ],
    });
    verifyType.mockImplementation(async (title: string) =>
      title === "Secretly a Movie"
        ? "movie"
        : title === "Agreeing Drama"
          ? "series"
          : null,
    );
    const metas = await scraper.getCatalog(
      {
        id: "kisskh.series.TVSeries",
        type: "series",
        extra: { skip: 0 },
      } as any,
      { providers: {} } as any,
    );
    expect(metas.map((meta) => meta.id)).toEqual(["kisskh:1", "kisskh:3"]);
  });
});

describe("searchCatalog", () => {
  it("hides Coming-labeled titles from search too", async () => {
    axiosGet.mockResolvedValue(searchFixture);
    const metas = await scraper.searchCatalog(
      { type: "series", extra: { search: "heart" } } as any,
      { providers: {} } as any,
    );
    expect(metas.map((meta) => meta.id)).toEqual(["kisskh:13632"]);
  });

  it("lets a TMDB verdict override the episode-count guess", async () => {
    axiosGet.mockResolvedValue([
      {
        id: 5,
        title: "One Part Movie",
        episodesCount: 1,
        thumbnail: "https://img/e.jpg",
        label: "",
      },
      {
        id: 6,
        title: "Multi Part Movie",
        episodesCount: 3,
        thumbnail: "https://img/f.jpg",
        label: "",
      },
    ]);
    verifyType.mockImplementation(async (title: string) =>
      title === "Multi Part Movie" ? "movie" : null,
    );
    const metas = await scraper.searchCatalog(
      { type: "movie", extra: { search: "movie" } } as any,
      { providers: {} } as any,
    );
    // "Multi Part Movie" fails the ==1 guess but the verdict keeps it;
    // "One Part Movie" has no verdict and rides the guess
    expect(metas.map((meta) => meta.id)).toEqual(["kisskh:5", "kisskh:6"]);
  });

  it("drops a search hit whose verdict contradicts the tab", async () => {
    axiosGet.mockResolvedValue([
      {
        id: 7,
        title: "Series in the Movie Tab",
        episodesCount: 40,
        thumbnail: "https://img/g.jpg",
        label: "",
      },
    ]);
    verifyType.mockResolvedValue("series");
    const metas = await scraper.searchCatalog(
      { type: "movie", extra: { search: "series" } } as any,
      { providers: {} } as any,
    );
    expect(metas).toEqual([]);
  });
});

// Shaped like the live upstream: episodes carry id/number/sub, and kisskh
// also lists episodes before they air — episode 3 here is the unaired one
const seriesDetail = {
  id: "14166",
  thumbnail: "https://img/a.jpg",
  title: "River of No Return (2026)",
  country: "China",
  description: "",
  episodesCount: 3,
  releaseDate: "2026-11-20T09:11:33",
  episodes: [
    { id: 229837, number: 1, sub: 5 },
    { id: 229916, number: 2, sub: 5 },
    { id: 230007, number: 3, sub: 0 },
  ],
};

const movieDetail = {
  id: "12905",
  thumbnail: "https://img/b.jpg",
  title: "Colony (2026)",
  country: "China",
  description: "",
  episodesCount: 1,
  releaseDate: "2026-01-01T00:00:00",
  episodes: [{ id: 219935, number: 1, sub: 0 }],
};

// Episode endpoint answers (content-type image/png, body JSON): Type 1 is
// media, Type 2 marks the pre-air countdown widget served as the "Video"
const episodeStream = {
  Video: "//cdn.test/hls/ep.m3u8",
  Video_tmp: "",
  ThirdParty: null,
  Type: 1,
  id: null,
  dataSaver: null,
};

const countdownStream = {
  Video: "//www.tickcounter.com/widget/countdown/10855855",
  Video_tmp: "",
  ThirdParty: null,
  Type: 2,
  id: null,
  dataSaver: null,
};

const tokenRoutes: [string, unknown][] = [
  ["/index.html", `<html><head><script src="common.js?v=1"></script></head></html>`],
  ["common.js", `function _0x54b991() { return "test-token"; }`],
];

describe("getStreams", () => {
  it("returns the episode stream for a Type 1 answer", async () => {
    routeAxios([
      ...tokenRoutes,
      ["/api/DramaList/Drama/14166", seriesDetail],
      ["/api/DramaList/Episode/229837", episodeStream],
    ]);
    const streams = await scraper.getStreams(
      {
        id: "kisskh:14166:1:1",
        kisskhId: "14166",
        title: "River of No Return (2026)",
        type: "series",
        season: 1,
        episode: 1,
      } as any,
      { providers: {} } as any,
    );
    expect(streams).toHaveLength(1);
    // _fixUrl upgrades the protocol-relative url to https
    expect(streams[0]?.url).toBe("https://cdn.test/hls/ep.m3u8");
    expect(streams[0]?.description).toBe("S01E01");
  });

  it("returns a movie stream for a Type 1 answer too", async () => {
    routeAxios([
      ...tokenRoutes,
      ["/api/DramaList/Drama/12905", movieDetail],
      ["/api/DramaList/Episode/219935", episodeStream],
    ]);
    const streams = await scraper.getStreams(
      {
        id: "kisskh:12905:1:1",
        kisskhId: "12905",
        title: "Colony (2026)",
        type: "movie",
        episode: 1,
      } as any,
      { providers: {} } as any,
    );
    expect(streams).toHaveLength(1);
    expect(streams[0]?.url).toBe("https://cdn.test/hls/ep.m3u8");
  });

  it("returns no stream when the episode is the pre-air countdown", async () => {
    routeAxios([
      ...tokenRoutes,
      ["/api/DramaList/Drama/14166", seriesDetail],
      ["/api/DramaList/Episode/230007", countdownStream],
    ]);
    const streams = await scraper.getStreams(
      {
        id: "kisskh:14166:1:3",
        kisskhId: "14166",
        title: "River of No Return (2026)",
        type: "series",
        season: 1,
        episode: 3,
      } as any,
      { providers: {} } as any,
    );
    expect(streams).toEqual([]);
  });

  it("keeps streaming answers that carry no Type at all", async () => {
    routeAxios([
      ...tokenRoutes,
      ["/api/DramaList/Drama/14166", seriesDetail],
      [
        "/api/DramaList/Episode/229916",
        { Video: "//cdn.test/hls/ep2.m3u8", Video_tmp: "" },
      ],
    ]);
    const streams = await scraper.getStreams(
      {
        id: "kisskh:14166:1:2",
        kisskhId: "14166",
        title: "River of No Return (2026)",
        type: "series",
        season: 1,
        episode: 2,
      } as any,
      { providers: {} } as any,
    );
    expect(streams.map((stream) => stream.url)).toEqual([
      "https://cdn.test/hls/ep2.m3u8",
    ]);
  });
});
