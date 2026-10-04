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
    img,
  };
});

vi.mock("../utils/axios.js", () => ({
  axiosGet: vi.fn(async (url: string) =>
    url.includes("/search/") ? fixtures.tvSearch : fixtures.tvDetail,
  ),
}));

// Same pattern as the optional-key test below: stub the key in, re-resolve
// the module graph, drop the stub on the way out
const importTmdb = async () => {
  vi.stubEnv("TMDB_API_KEY", "test-key");
  vi.resetModules();
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
