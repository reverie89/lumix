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

const dbGetContentByProviderId = vi.fn(async () => undefined);
vi.mock("../db/queries.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/queries.js")>();
  return {
    ...actual,
    getContentByProviderId: () => dbGetContentByProviderId(),
  };
});

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
  tmdbEnabled.mockReturnValue(false);
  searchDetail.mockReset();
  searchDetail.mockResolvedValue(null);
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

describe("searchCatalog", () => {
  it("hides Coming-labeled titles from search too", async () => {
    axiosGet.mockResolvedValue(searchFixture);
    const metas = await scraper.searchCatalog(
      { type: "series", extra: { search: "heart" } } as any,
      { providers: {} } as any,
    );
    expect(metas.map((meta) => meta.id)).toEqual(["kisskh:13632"]);
  });
});
