import { beforeEach, describe, expect, it, vi } from "vitest";
import ProviderService from "./provider-service.js";
import { Provider } from "../../source/provider.js";
import { ContentDetail } from "../../source/meta.js";
import { tmdb } from "../../source/tmdb.js";

// isTmdbEnabled reads ENV at call time, but ENV parses once at import — the
// hoisted key makes the enabled state real for this file's import order
const { tmdbEnabled } = vi.hoisted(() => {
  process.env.TMDB_API_KEY = "test-key";
  return { tmdbEnabled: vi.fn(() => true) };
});
const dbGet = vi.fn();

vi.mock("../../source/tmdb.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../source/tmdb.js")
  >();
  return { ...actual, isTmdbEnabled: () => tmdbEnabled() };
});

vi.mock("../../db/queries.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/queries.js")>();
  return { ...actual, getContentByProviderId: (id: string) => dbGet(id) };
});

const searchDetail = vi.spyOn(tmdb, "searchDetail");

beforeEach(() => {
  dbGet.mockReset();
  searchDetail.mockReset();
  tmdbEnabled.mockReturnValue(true);
});

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

  it("searches TMDB once for an unmapped title and returns the detail for persisting", async () => {
    dbGet.mockResolvedValue(undefined);
    const detail = { thumbnail: "https://img/tmdb2.jpg" } as ContentDetail;
    searchDetail.mockResolvedValue(detail);
    const result = await ProviderService.resolveProviderPoster(
      Provider.OLE,
      42,
      "New Title",
      "https://img/ole.jpg",
      "movie",
    );
    expect(result).toEqual({ poster: "https://img/tmdb2.jpg", detail });
    expect(searchDetail).toHaveBeenCalledWith("New Title", "movie");
    expect(dbGet).toHaveBeenCalledWith("ole:42");
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

  it("skips TMDB entirely when no key is configured", async () => {
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
    expect(searchDetail).not.toHaveBeenCalled();
  });
});
