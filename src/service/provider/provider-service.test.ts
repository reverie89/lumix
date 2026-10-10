import { beforeEach, describe, expect, it, vi } from "vitest";
import ProviderService, {
  ProviderContentSource,
} from "./provider-service.js";
import { Provider } from "../../utils/config.js";
import { ContentDetail } from "../../source/meta.js";
import { cache } from "../../utils/cache.js";
import { tmdb } from "../../source/tmdb.js";

// isTmdbEnabled reads ENV at call time, but ENV parses once at import — the
// hoisted key makes the enabled state real for this file's import order
const { tmdbEnabled } = vi.hoisted(() => {
  process.env.TMDB_API_KEY = "test-key";
  return { tmdbEnabled: vi.fn(() => true) };
});
const dbGet = vi.fn();
const dbGetByTmdb = vi.fn();
const dbUpsertContent = vi.fn();
const dbGetProviderContent = vi.fn();
const dbUpsertProviderContent = vi.fn();

vi.mock("../../source/tmdb.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../source/tmdb.js")
  >();
  return { ...actual, isTmdbEnabled: () => tmdbEnabled() };
});

vi.mock("../../db/queries.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/queries.js")>();
  return {
    ...actual,
    getContentByProviderId: (id: string) => dbGet(id),
    getContentByTmdb: (tmdbId: string, type: string) =>
      dbGetByTmdb(tmdbId, type),
    upsertContent: (id: string, detail: ContentDetail) =>
      dbUpsertContent(id, detail),
    getProviderContentById: (id: string) => dbGetProviderContent(id),
    upsertProviderContent: (row: unknown) => dbUpsertProviderContent(row),
  };
});

const searchDetail = vi.spyOn(tmdb, "searchDetail");

beforeEach(() => {
  dbGet.mockReset();
  dbGetByTmdb.mockReset();
  dbUpsertContent.mockReset();
  dbGetProviderContent.mockReset();
  dbUpsertProviderContent.mockReset();
  searchDetail.mockReset();
  tmdbEnabled.mockReturnValue(true);
});

const tmdbDetail = {
  id: "119863",
  tmdbId: 119863,
  title: "TMDB Title",
  year: 2024,
  type: "series",
  thumbnail: "https://img/tmdb.jpg",
} as ContentDetail;

describe("resolveProviderPoster", () => {
  it("serves stored art for a linked provider id without searching TMDB", async () => {
    dbGet.mockResolvedValue({ poster: "https://img/tmdb.jpg" });
    searchDetail.mockResolvedValue(null);
    const result = await ProviderService.resolveProviderPoster(
      Provider.KISSKH,
      11923,
      "Known Title",
      "https://img/kisskh.jpg",
      "series",
    );
    expect(result).toEqual({
      poster: "https://img/tmdb.jpg",
      detail: null,
    });
    expect(searchDetail).not.toHaveBeenCalled();
    expect(dbGet).toHaveBeenCalledWith("kisskh:11923");
  });

  it("searches TMDB once for an unmapped title and persists the mapping", async () => {
    dbGet.mockResolvedValue(undefined);
    dbGetByTmdb.mockResolvedValue(undefined);
    dbUpsertContent.mockResolvedValue("content-1");
    dbGetProviderContent.mockResolvedValue(undefined);
    searchDetail.mockResolvedValue(tmdbDetail);
    const result = await ProviderService.resolveProviderPoster(
      Provider.OLE,
      42,
      "New Title",
      "https://img/ole.jpg",
      "series",
    );
    expect(result).toEqual({ poster: "https://img/tmdb.jpg", detail: tmdbDetail });
    expect(searchDetail).toHaveBeenCalledWith("New Title", "series");
    expect(dbGet).toHaveBeenCalledWith("ole:42");
    expect(dbUpsertContent).toHaveBeenCalledWith(expect.any(String), tmdbDetail);
    expect(dbUpsertProviderContent).toHaveBeenCalledWith({
      id: "ole:42",
      contentId: "content-1",
      title: "New Title",
      provider: "ole",
      externalId: "42",
      year: 2024,
    });
  });

  it("links an existing content row without creating a new one", async () => {
    // The kisskh gap: content row present (written via another provider or
    // the meta path) but this provider unmapped — the link must still be
    // written or the title re-searches on every restart. The existing row is
    // refreshed in place (same id), never replaced by a fresh uuid.
    dbGet.mockResolvedValue(undefined);
    dbGetByTmdb.mockResolvedValue({ id: "content-77" });
    dbGetProviderContent.mockResolvedValue(undefined);
    searchDetail.mockResolvedValue(tmdbDetail);
    const result = await ProviderService.resolveProviderPoster(
      Provider.KISSKH,
      7,
      "Known Elsewhere",
      "https://img/kisskh.jpg",
      "series",
    );
    expect(result).toEqual({ poster: "https://img/tmdb.jpg", detail: tmdbDetail });
    expect(dbUpsertContent).toHaveBeenCalledWith("content-77", tmdbDetail);
    expect(dbUpsertProviderContent).toHaveBeenCalledWith({
      id: "kisskh:7",
      contentId: "content-77",
      title: "Known Elsewhere",
      provider: "kisskh",
      externalId: "7",
      year: 2024,
    });
  });

  it("updates an existing provider link to the freshly resolved content row", async () => {
    dbGet.mockResolvedValue(undefined);
    dbGetByTmdb.mockResolvedValue(undefined);
    dbUpsertContent.mockResolvedValue("content-2");
    dbGetProviderContent.mockResolvedValue({
      id: "kisskh:9",
      contentId: null,
      provider: "kisskh",
      externalId: "9",
      title: "Stale Title",
      year: 1999,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    searchDetail.mockResolvedValue(tmdbDetail);
    await ProviderService.resolveProviderPoster(
      Provider.KISSKH,
      9,
      "Fresh Title",
      "https://img/kisskh.jpg",
      "series",
    );
    expect(dbUpsertProviderContent).toHaveBeenCalledWith({
      id: "kisskh:9",
      contentId: "content-2",
      provider: "kisskh",
      externalId: "9",
      title: "Fresh Title",
      year: 1999,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it("probes the content row under the override tmdb id when given one", async () => {
    dbGet.mockResolvedValue(undefined);
    dbGetByTmdb.mockResolvedValue({ id: "content-known" });
    dbGetProviderContent.mockResolvedValue(undefined);
    searchDetail.mockResolvedValue(tmdbDetail);
    await ProviderService.resolveProviderPoster(
      Provider.KISSKH,
      12422,
      "Remapped Title",
      "https://img/kisskh.jpg",
      "series",
      "307602",
    );
    expect(dbGetByTmdb).toHaveBeenCalledWith("307602", "series");
    // The existing row refreshes in place under the probed id — its stored
    // tmdb id becomes the resolved detail's own — and stays the link target
    expect(dbUpsertContent).toHaveBeenCalledWith("content-known", tmdbDetail);
    expect(dbUpsertProviderContent).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: "content-known" }),
    );
  });

  it("falls back to the provider image when the linked row has no poster", async () => {
    dbGet.mockResolvedValue({ poster: null });
    const result = await ProviderService.resolveProviderPoster(
      Provider.KISSKH,
      7,
      "No Art",
      "https://img/kisskh.jpg",
      "series",
    );
    expect(result).toEqual({
      poster: "https://img/kisskh.jpg",
      detail: null,
    });
    expect(searchDetail).not.toHaveBeenCalled();
  });

  it("falls back to the provider image when no key is configured", async () => {
    // The disabled-key gate lives inside searchDetail itself; the outcome
    // contract is the provider's own image with no resolved detail
    tmdbEnabled.mockReturnValue(false);
    const result = await ProviderService.resolveProviderPoster(
      Provider.KISSKH,
      9,
      "Any Title",
      "https://img/kisskh.jpg",
      "series",
    );
    expect(result).toEqual({
      poster: "https://img/kisskh.jpg",
      detail: null,
    });
  });
});

describe("syncContentAndProvider", () => {
  it("exits before any TMDB call when the provider link already has content", async () => {
    dbGetProviderContent.mockResolvedValue({ contentId: "content-1" });
    const persistSpy = vi.spyOn(ProviderService, "persistContentMapping");
    await ProviderService.syncContentAndProvider(
      { title: "Known", type: "series" } as ContentDetail,
      "5",
      Provider.KISSKH,
    );
    expect(searchDetail).not.toHaveBeenCalled();
    expect(persistSpy).not.toHaveBeenCalled();
    persistSpy.mockRestore();
  });

  it("searches and delegates the linkage write to persistContentMapping", async () => {
    dbGetProviderContent.mockResolvedValue(undefined);
    searchDetail.mockResolvedValue(tmdbDetail);
    const persistSpy = vi
      .spyOn(ProviderService, "persistContentMapping")
      .mockResolvedValue(undefined);
    await ProviderService.syncContentAndProvider(
      { title: "Stream Title", type: "series", year: 2024 } as ContentDetail,
      "5",
      Provider.KISSKH,
    );
    expect(searchDetail).toHaveBeenCalledWith("Stream Title", "series");
    expect(persistSpy).toHaveBeenCalledWith(
      tmdbDetail,
      Provider.KISSKH,
      "5",
      "Stream Title",
    );
    persistSpy.mockRestore();
  });
});

describe("resolveProviderDetail", () => {
  const source: ProviderContentSource = {
    provider: Provider.OLE,
    idField: "oleId",
    fetchDetail: vi.fn(async () => ({ title: "Cache Test", year: 2026 })),
  };

  beforeEach(() => {
    cache.clearAll();
  });

  it("attaches season/episode on a warm cache hit, not only on the first call", async () => {
    // Miss path via the providerContent row — the branch that caches
    vi.spyOn(ProviderService, "getDbContent").mockResolvedValue(null);
    dbGetProviderContent.mockResolvedValue({
      id: "ole:85005",
      contentId: null,
      provider: "ole",
      externalId: "85005",
      title: "Cache Test",
      year: 2026,
    });
    const first = await ProviderService.resolveProviderDetail(
      source,
      "85005",
      "series",
      "1",
      "2",
    );
    const second = await ProviderService.resolveProviderDetail(
      source,
      "85005",
      "series",
      "1",
      "3",
    );
    expect(first).toMatchObject({ season: 1, episode: 2 });
    expect(second).toMatchObject({ season: 1, episode: 3 });
    // The shared cache entry stays episode-free for the next caller
    expect(cache.get("content:ole:85005")).toEqual({
      id: "85005",
      title: "Cache Test",
      year: 2026,
      type: "series",
      oleId: "85005",
    });
    // The second call was served by the cache, not a re-resolution
    expect(ProviderService.getDbContent).toHaveBeenCalledTimes(1);
    expect(source.fetchDetail).not.toHaveBeenCalled();
  });
});
