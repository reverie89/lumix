import { beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { ContentDetail } from "../source/meta.js";
import {
  getContentByTmdb,
  getStreamsJoinProvider,
  getSubtitlesJoinProvider,
  pruneExpiredRows,
  upsertContent,
  upsertProviderContent,
  upsertStream,
  upsertSubtitles,
} from "./queries.js";
import { initMigrations } from "./drizzle.js";
import { sqlite } from "./sqlite.js";

beforeAll(async () => {
  await initMigrations();
});

const tmdbContent = (tmdbId: number): ContentDetail => ({
  id: tmdbId.toString(),
  tmdbId,
  title: `Test Show ${tmdbId}`,
  year: 2024,
  type: "series",
  overview: "overview",
});

function providerContentRow(externalId: string, title: string) {
  return {
    id: `kisskh:${externalId}`,
    contentId: null,
    provider: "kisskh" as const,
    externalId,
    title,
    year: 2024,
  };
}

describe("upsertContent", () => {
  it("updates the existing row when a fresh uuid re-inserts the same tmdb id", async () => {
    const first = await upsertContent(uuidv7(), tmdbContent(987001));
    expect(first).toBeDefined();
    // A concurrent request inserts with a different uuid but the same
    // (tmdbId, type): the existing row must be updated, not a second created
    const second = await upsertContent(uuidv7(), tmdbContent(987001));
    expect(second).toBe(first);
    const row = await getContentByTmdb("987001", "series");
    expect(row?.id).toBe(first);
  });
});

describe("upsertStream", () => {
  it("conflicts on url across re-scrapes with fresh uuids", async () => {
    const providerContentId = "kisskh:987002";
    await upsertProviderContent(providerContentRow("987002", "Test Stream"));
    const url = "https://cdn.kisskh.test/video987002.mp4";
    const row = {
      id: uuidv7(),
      providerContentId,
      provider: "kisskh",
      externalId: "987002",
      season: "1",
      episode: "1",
      url,
      ttl: 1000,
    };
    await upsertStream([row]);
    // A re-scrape writes a fresh uuid for the same url: the existing row
    // must be updated, not duplicated
    await upsertStream([{ ...row, id: uuidv7(), ttl: 2000 }]);
    const rows = await getStreamsJoinProvider(providerContentId, 1, 1);
    expect(rows?.length).toBe(1);
    expect(rows?.[0]?.stream.ttl).toBe(2000);
  });
});

describe("upsertSubtitles", () => {
  it("conflicts on the composite natural key", async () => {
    const providerContentId = "kisskh:987003";
    await upsertProviderContent(
      providerContentRow("987003", "Test Subtitle Show"),
    );
    const row = {
      id: uuidv7(),
      providerContentId,
      url: "https://cdn.kisskh.test/sub.txt",
      lang: "eng",
      season: "1",
      episode: "1",
      ttl: 1000,
    };
    await upsertSubtitles([row]);
    await upsertSubtitles([
      { ...row, id: uuidv7(), url: "https://cdn.kisskh.test/sub-v2.txt" },
    ]);
    const subs = await getSubtitlesJoinProvider(providerContentId, 1, 1);
    expect(subs?.length).toBe(1);
    expect(subs?.[0]?.subtitle.url).toBe("https://cdn.kisskh.test/sub-v2.txt");
  });
});

describe("pruneExpiredRows", () => {
  it("deletes rows whose ttl has passed and keeps fresh ones", async () => {
    const providerContentId = "kisskh:987004";
    await upsertProviderContent(providerContentRow("987004", "Test Prune"));
    const url = (n: string) => `https://cdn.kisskh.test/prune-${n}.mp4`;
    const base = {
      providerContentId,
      provider: "kisskh",
      externalId: "987004",
      season: "1",
      episode: "1",
    };
    const expired = new Date(Date.now() - 10 * 60 * 1000);
    await upsertStream([
      { ...base, id: uuidv7(), url: url("old"), ttl: 1000 },
      { ...base, id: uuidv7(), url: url("fresh"), ttl: 60 * 60 * 1000 },
    ]);
    // Backdate one row past its ttl — upsert can't set updatedAt directly
    sqlite.prepare("UPDATE stream SET updated_at = ? WHERE url = ?").run(
      expired.getTime(),
      url("old"),
    );

    await pruneExpiredRows();

    const rows = await getStreamsJoinProvider(providerContentId, 1, 1);
    expect(rows?.length).toBe(1);
    expect(rows?.[0]?.stream.url).toBe(url("fresh"));
  });
});
