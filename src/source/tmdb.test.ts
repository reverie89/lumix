import { beforeEach, describe, expect, it, vi } from "vitest";
import { axiosGet } from "../utils/axios.js";

// No network: every request resolves from fixtures keyed by URL shape
const fixtures = vi.hoisted(() => {
  // Full TmdbTvImage shape: the logo picker's param is strictly typed
  const img = (file_path: string, iso_639_1: string) => ({
    file_path,
    iso_639_1,
    aspect_ratio: 1.78,
    height: 1080,
    width: 1920,
    iso_3166_1: "US",
    vote_average: 0,
    vote_count: 0,
  });
  return {
    tvSearch: {
      results: [
        {
          id: 119863,
          name: "The Glory",
          original_name: "The Glory",
          overview: "english overview",
          first_air_date: "2022-12-30",
          poster_path: "/poster.jpg",
        },
      ],
    },
    tvDetail: {
      id: 119863,
      name: "黑暗荣耀",
      overview: "中文简介",
      first_air_date: "2022-12-30",
      poster_path: "/poster.jpg",
      images: {
        logos: [img("/en-logo.png", "en"), img("/zh-logo.png", "zh")],
        backdrops: [img("/en-backdrop.jpg", "en")],
        posters: [],
      },
      external_ids: { imdb_id: "tt22810590" },
    },
    // Upcoming title: TMDB serves an empty air date and a null poster
    tvDetailUndated: {
      id: 337252,
      name: "Ash",
      overview: "upcoming",
      first_air_date: "",
      poster_path: null,
      images: {
        logos: [],
        backdrops: [],
        posters: [],
      },
      external_ids: { imdb_id: null },
    },
    img,
  };
});

vi.mock("../utils/axios.js", () => ({
  axiosGet: vi.fn(async (url: string) =>
    url.includes("/search/") ? fixtures.tvSearch : fixtures.tvDetail,
  ),
}));

// Same pattern as the optional-key test below: stub the key in, re-resolve
// the module graph, drop the stub on the way out. resetModules also rebuilds
// the db graph, so each import migrates its fresh in-memory sqlite — the
// searchMiss negative cache reads/writes it on every searchDetail.
const importTmdb = async () => {
  vi.stubEnv("TMDB_API_KEY", "test-key");
  vi.resetModules();
  const { initMigrations } = await import("../db/drizzle.js");
  await initMigrations();
  return await import("./tmdb.js");
};

const requestedUrls = () => vi.mocked(axiosGet).mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.mocked(axiosGet).mockClear();
});

describe("tmdb optional key", () => {
  it("resolves null without network when no key is configured", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    vi.resetModules();
    const { tmdb, isTmdbEnabled } = await import("./tmdb.js");
    expect(isTmdbEnabled()).toBe(false);
    const detail = await tmdb.searchDetail("Any Title", "series");
    expect(detail).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("tmdbLanguage", () => {
  it("maps only a zh config to zh-CN (undefined keeps English URLs bare)", async () => {
    const { tmdbLanguage } = await importTmdb();
    expect(tmdbLanguage({ language: "zh" })).toBe("zh-CN");
    expect(tmdbLanguage({ language: "en" })).toBeUndefined();
    expect(tmdbLanguage({ language: "fr" })).toBeUndefined();
    expect(tmdbLanguage(undefined)).toBeUndefined();
    vi.unstubAllEnvs();
  });
});

describe("searchDetail negative cache", () => {
  it("records a miss on an unmatched title and skips re-searching it", async () => {
    const { tmdb } = await importTmdb();
    vi.mocked(axiosGet).mockResolvedValueOnce({ results: [] });
    const first = await tmdb.searchDetail("Unmatchable Show", "series");
    expect(first).toBeNull();
    // One upstream search happened; the recorded miss suppresses the next
    expect(requestedUrls()).toHaveLength(1);
    const second = await tmdb.searchDetail("Unmatchable Show", "series");
    expect(second).toBeNull();
    expect(requestedUrls()).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  it("does not suppress searches that matched", async () => {
    const { tmdb } = await importTmdb();
    await tmdb.searchDetail("The Glory", "series");
    await tmdb.searchDetail("The Glory", "series");
    // No miss recorded for a found title — both searches ran
    expect(requestedUrls().length).toBeGreaterThanOrEqual(4);
    vi.unstubAllEnvs();
  });

  it("does not record a miss when the upstream search fails", async () => {
    const { tmdb } = await importTmdb();
    vi.mocked(axiosGet).mockRejectedValueOnce(new Error("503 upstream"));
    const failed = await tmdb.searchDetail("The Glory", "series");
    expect(failed).toBeNull();
    expect(requestedUrls()).toHaveLength(1);
    // A failure is transient, not a verdict: the next search runs, and only
    // that completed no-match records the miss that then suppresses retries
    vi.mocked(axiosGet).mockResolvedValueOnce({ results: [] });
    const empty = await tmdb.searchDetail("The Glory", "series");
    expect(empty).toBeNull();
    expect(requestedUrls()).toHaveLength(2);
    await tmdb.searchDetail("The Glory", "series");
    expect(requestedUrls()).toHaveLength(2);
    vi.unstubAllEnvs();
  });

  it("does not record a miss when the post-match detail fetch fails", async () => {
    const { tmdb } = await importTmdb();
    vi.mocked(axiosGet)
      .mockResolvedValueOnce(fixtures.tvSearch) // search matches
      .mockRejectedValueOnce(new Error("timeout")); // detail fetch fails
    const failed = await tmdb.searchDetail("The Glory", "series");
    expect(failed).toBeNull();
    expect(requestedUrls()).toHaveLength(2);
    // The title was never a miss — the next search starts from the top
    vi.mocked(axiosGet).mockResolvedValueOnce({ results: [] });
    await tmdb.searchDetail("The Glory", "series");
    expect(requestedUrls()).toHaveLength(3);
    vi.unstubAllEnvs();
  });
});

describe("TMDB language threading", () => {
  it("localizes the post-match detail fetch, never the search", async () => {
    const { tmdb } = await importTmdb();
    const detail = await tmdb.searchDetail(
      "The Glory",
      "series",
      undefined,
      "zh-CN",
    );
    const [searchUrl, detailUrl] = requestedUrls();
    // Matching must stay English: a localized search result would break
    // matchTitle (and the title-driven provider searches downstream)
    expect(searchUrl).toBe(
      "https://api.tmdb.org/3/search/tv?query=The+Glory",
    );
    expect(detailUrl).toBe(
      "https://api.tmdb.org/3/tv/119863?append_to_response=images,external_ids" +
        "&include_image_language=zh,en,null&language=zh-CN",
    );
    expect(detail?.overview).toBe("中文简介");
    expect(detail?.logo?.endsWith("/zh-logo.png")).toBe(true);
    vi.unstubAllEnvs();
  });

  it("keeps English requests parameter-free (URLs unchanged, cache-safe)", async () => {
    const { tmdb } = await importTmdb();
    const detail = await tmdb.searchDetail("The Glory", "series");
    const [searchUrl, detailUrl] = requestedUrls();
    expect(searchUrl).toBe(
      "https://api.tmdb.org/3/search/tv?query=The+Glory",
    );
    expect(detailUrl).toBe(
      "https://api.tmdb.org/3/tv/119863?append_to_response=images,external_ids",
    );
    expect(detail?.logo?.endsWith("/en-logo.png")).toBe(true);
    vi.unstubAllEnvs();
  });

  it("prefers the requested language's art with en and first as fallbacks", async () => {
    const { tmdb } = await importTmdb();
    const images = fixtures.tvDetail.images;
    expect(
      tmdb.extractLogoAndBackground(images, "zh-CN").logo?.endsWith(
        "/zh-logo.png",
      ),
    ).toBe(true);
    // English (no language) keeps preferring the en art
    expect(
      tmdb.extractLogoAndBackground(images).logo?.endsWith("/en-logo.png"),
    ).toBe(true);
    const zhOnly = {
      ...images,
      logos: [fixtures.img("/zh-logo.png", "zh")],
      backdrops: [fixtures.img("/zh-backdrop.jpg", "zh")],
    };
    expect(
      tmdb.extractLogoAndBackground(zhOnly, "zh-CN").logo?.endsWith(
        "/zh-logo.png",
      ),
    ).toBe(true);
    // Nothing in the preferred or en language: first entry wins
    const noLang = {
      ...images,
      logos: [fixtures.img("/no-lang.png", "xx")],
    };
    expect(
      tmdb.extractLogoAndBackground(noLang, "zh-CN").logo?.endsWith(
        "/no-lang.png",
      ),
    ).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("verifyType", () => {
  const movieSearchFixture = {
    results: [
      {
        id: 500,
        title: "The Glory",
        original_title: "The Glory",
        overview: "movie overview",
        release_date: "2021-01-01",
        poster_path: "/movie-poster.jpg",
      },
    ],
  };
  const movieOnlyUrl = (url: string) => url.includes("/search/movie");
  const tvSearchResult = (name: string) => ({
    results: [
      {
        id: 1,
        name,
        original_name: name,
        overview: "tv overview",
        first_air_date: "2022-01-01",
        poster_path: null,
      },
    ],
  });

  it("returns null without requests when no key is configured", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    vi.resetModules();
    const { tmdb } = await import("./tmdb.js");
    expect(await tmdb.verifyType("Any Title")).toBeNull();
    expect(requestedUrls()).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it("trusts the only confident surface", async () => {
    const { tmdb } = await importTmdb();
    vi.mocked(axiosGet)
      .mockResolvedValueOnce(fixtures.tvSearch) // /search/tv matches
      .mockResolvedValueOnce({ results: [] }); // /search/movie empty
    expect(await tmdb.verifyType("The Glory")).toBe("series");
    const kinds = requestedUrls().map((url) => (movieOnlyUrl(url) ? "movie" : "tv"));
    expect(kinds).toEqual(["tv", "movie"]);
    vi.unstubAllEnvs();
  });

  it("trusts the movie surface when tv matches nothing", async () => {
    const { tmdb } = await importTmdb();
    vi.mocked(axiosGet)
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce(movieSearchFixture);
    expect(await tmdb.verifyType("The Glory")).toBe("movie");
    vi.unstubAllEnvs();
  });

  it("compares fuse scores when both surfaces match", async () => {
    const { tmdb } = await importTmdb();
    // Exact title on the movie surface beats the fuzzy tv candidate
    vi.mocked(axiosGet)
      .mockResolvedValueOnce(tvSearchResult("The Glory Show"))
      .mockResolvedValueOnce(movieSearchFixture);
    expect(await tmdb.verifyType("The Glory")).toBe("movie");
    vi.unstubAllEnvs();
  });

  it("prefers the better match regardless of surface order", async () => {
    const { tmdb } = await importTmdb();
    vi.mocked(axiosGet)
      .mockResolvedValueOnce(fixtures.tvSearch) // exact "The Glory" on tv
      .mockResolvedValueOnce({
        results: [
          {
            id: 2,
            title: "The Glory Road",
            original_title: "The Glory Road",
            overview: "",
            release_date: "2020-01-01",
            poster_path: null,
          },
        ],
      });
    expect(await tmdb.verifyType("The Glory")).toBe("series");
    vi.unstubAllEnvs();
  });

  it("records per-surface misses and short-circuits the next call", async () => {
    const { tmdb } = await importTmdb();
    vi.mocked(axiosGet).mockResolvedValue({ results: [] });
    expect(await tmdb.verifyType("Nowhere Title")).toBeNull();
    expect(requestedUrls()).toHaveLength(2);
    expect(await tmdb.verifyType("Nowhere Title")).toBeNull();
    expect(requestedUrls()).toHaveLength(2);
    vi.unstubAllEnvs();
  });

  it("skips only the surface that already missed", async () => {
    const { tmdb } = await importTmdb();
    const halfKnownMovie = {
      results: [
        {
          id: 3,
          title: "Half Known Title",
          original_title: "Half Known Title",
          overview: "",
          release_date: "2020-01-01",
          poster_path: null,
        },
      ],
    };
    // First call: tv empty (miss), movie matches
    vi.mocked(axiosGet)
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce(halfKnownMovie);
    expect(await tmdb.verifyType("Half Known Title")).toBe("movie");
    // Second call: the tv miss suppresses /search/tv; movie re-checks
    vi.mocked(axiosGet).mockClear();
    vi.mocked(axiosGet).mockResolvedValueOnce(halfKnownMovie);
    expect(await tmdb.verifyType("Half Known Title")).toBe("movie");
    expect(requestedUrls().every((url) => movieOnlyUrl(url))).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("degenerate TMDB responses", () => {
  it("maps an undated, artless series without NaN years or broken poster urls", async () => {
    const { tmdb } = await importTmdb();
    // The search hit and the detail are both degenerate: empty air date,
    // null poster — the shape TMDB serves for unreleased titles
    vi.mocked(axiosGet)
      .mockResolvedValueOnce({
        results: [
          {
            id: 337252,
            name: "Ash",
            original_name: "Ash",
            overview: "",
            first_air_date: "",
            poster_path: null,
          },
        ],
      })
      .mockResolvedValueOnce(fixtures.tvDetailUndated);
    const detail = await tmdb.searchDetail("Ash", "series");
    expect(detail?.tmdbId).toBe(337252);
    // A NaN year binds as NULL and fails the NOT NULL content insert
    expect(Number.isFinite(detail?.year ?? NaN)).toBe(true);
    expect(detail?.year).toBeGreaterThan(1900);
    expect(detail?.thumbnail).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain("w500null");
    vi.unstubAllEnvs();
  });

  it("maps an undated, artless movie find result the same way", async () => {
    const { tmdb } = await importTmdb();
    vi.mocked(axiosGet).mockResolvedValueOnce({
      movie_results: [
        {
          id: 337252,
          title: "Ash",
          original_title: "Ash",
          overview: "",
          release_date: "",
          poster_path: null,
        },
      ],
      person_results: [],
      tv_results: [],
      tv_episode_results: [],
      tv_season_results: [],
    });
    const detail = await tmdb.findDetailImdb("tt0000000", "movie");
    expect(detail?.tmdbId).toBe(337252);
    expect(Number.isFinite(detail?.year ?? NaN)).toBe(true);
    expect(detail?.thumbnail).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain("w500null");
    vi.unstubAllEnvs();
  });

  it("maps an undated series find result without NaN", async () => {
    const { tmdb } = await importTmdb();
    vi.mocked(axiosGet).mockResolvedValueOnce({
      movie_results: [],
      person_results: [],
      tv_results: [
        {
          id: 337252,
          name: "Ash",
          original_name: "Ash",
          overview: "",
          first_air_date: "",
          poster_path: null,
        },
      ],
      tv_episode_results: [],
      tv_season_results: [],
    });
    const detail = await tmdb.findDetailImdb("tt0000000", "series");
    expect(detail?.tmdbId).toBe(337252);
    expect(Number.isFinite(detail?.year ?? NaN)).toBe(true);
    vi.unstubAllEnvs();
  });
});
