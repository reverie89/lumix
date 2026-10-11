import type { ContentType } from "@stremio-addon/sdk";
import { createHash, randomBytes } from "crypto";
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  sql,
} from "drizzle-orm";
import type { ContentDetail } from "../source/meta.js";
import { isExpired } from "../utils/cache.js";
import { handleError } from "../utils/error.js";
import { Logger } from "../utils/logger.js";
import { db } from "./drizzle.js";
import { content, EContentInsert, type EContent } from "./schema/content.js";
import {
  EProviderContentInsert,
  providerContent,
  type EProviderContent,
} from "./schema/provider_content.js";
import { stream, StreamInsert } from "./schema/stream.js";
import { ESubtitleInsert, subtitle } from "./schema/subtitle.js";
import { ESearchMissInsert, searchMiss } from "./schema/search_miss.js";
import { meta } from "./schema/meta.js";
import { visit, type EVisitInsert, type VisitKind } from "./schema/visit.js";

const logger = new Logger("DB");

// The addon only persists these two content types (kisskh serves no others);
// the SDK's ContentType is wider, so writes normalize through this map.
const dbType = (type: ContentType): "movie" | "series" =>
  type === "movie" ? "movie" : "series";

// CONTENT
/**
 * Upsert keyed on the real dedup constraint (tmdbId + type, `uq_content_tmdb`):
 * a fresh-uuid insert of an already-known title updates the existing row
 * instead of dying on the unique index. Returns the id of the row actually
 * written, so callers never link provider_content to a discarded uuid.
 */
export async function upsertContent(
  id: string,
  contentData: ContentDetail,
): Promise<string | undefined> {
  const row: EContentInsert = {
    id: id,
    title: contentData.title,
    year: contentData.year,
    type: dbType(contentData.type),
    imdbId: contentData.imdbId?.toString() ?? null,
    tmdbId: contentData.tmdbId?.toString() ?? null,
    poster: contentData.thumbnail,
  };

  try {
    const [written] = await db
      .insert(content)
      .values(row)
      .onConflictDoUpdate({
        target: [content.tmdbId, content.type],
        set: {
          title: row.title,
          year: row.year,
          type: row.type,
          imdbId: row.imdbId,
          tmdbId: row.tmdbId,
          poster: row.poster,
        },
      })
      .returning({ id: content.id });
    logger.debug(`Upserted content ${contentData.title}`);
    return written?.id;
  } catch (e: any) {
    handleError(e, logger, `Failed to upsert content ${contentData.title}`);
    return undefined;
  }
}

export async function getContentByTmdb(
  tmdbId: string,
  type: "movie" | "series",
): Promise<EContent | undefined> {
  const row = await db.query.content.findFirst({
    where: {
      tmdbId: tmdbId,
      type: type,
    },
  });
  return row;
}

export async function getProviderContentsById(id: string) {
  const rows = await db.query.content.findFirst({
    where: {
      id: id,
    },
    with: {
      providerContent: true,
    },
  });
  return rows;
}

export async function getContentJoinProviderById(
  type: "movie" | "series",
  imdbId?: string,
  tmdbId?: number,
) {
  // Callers pass exactly one id — probe just that unique index instead of
  // an OR over three with two dead empty-string matches
  const matches: Record<string, string>[] = [];
  if (imdbId) matches.push({ imdbId });
  if (tmdbId) matches.push({ tmdbId: tmdbId.toString() });
  if (matches.length === 0) return;
  const row = await db.query.content.findFirst({
    where: {
      type: type,
      ...(matches.length === 1 ? matches[0] : { OR: matches }),
    },
    with: {
      providerContent: true,
    },
  });
  return row;
}

/**
 * Delete rows whose ttl has passed — stream/subtitle/search-miss rows are
 * otherwise only filtered at read time and accumulate forever. Run at startup.
 */
export async function pruneExpiredRows() {
  const now = Date.now();
  try {
    for (const [name, table] of [
      ["stream", stream],
      ["subtitle", subtitle],
      ["search miss", searchMiss],
    ] as const) {
      const result = await db.run(
        sql`DELETE FROM ${table} WHERE ttl IS NOT NULL AND updated_at + ttl < ${now}`,
      );
      const removed = Number(result.changes ?? 0);
      if (removed > 0) {
        logger.log(`Pruned ${removed} expired ${name} rows`);
      }
    }
  } catch (e) {
    handleError(e, logger, `Failed to prune expired rows`);
  }
}

// PROVIDER_CONTENT
export type ProviderContentInsertInput = Omit<
  EProviderContentInsert,
  "createdAt" | "updatedAt"
>;

export async function upsertProviderContent(
  providerContentData: ProviderContentInsertInput,
) {
  const row = providerContentData;

  try {
    await db
      .insert(providerContent)
      .values(row)
      .onConflictDoUpdate({
        target: providerContent.id,
        set: {
          provider: row.provider,
          contentId: row.contentId,
          externalId: row.externalId,
          title: row.title,
          year: row.year,
        },
      });
    logger.debug(`Upserted provider_content ${row.id} ${row.title}`);
  } catch (e: any) {
    handleError(e, logger, `Failed to upsert provider_content ${row.title}`);
  }
}

export async function getProviderContentById(
  id: string,
): Promise<EProviderContent | undefined> {
  const [row] = await db
    .select()
    .from(providerContent)
    .where(eq(providerContent.id, id))
    .limit(1);
  return row;
}

/**
 * The content row linked to a provider_content id (e.g. `kisskh:<id>`) —
 * the stored TMDB art/mapping for a title, so catalog renders resolve
 * posters from the DB without re-searching TMDB.
 */
export async function getContentByProviderId(
  id: string,
): Promise<EContent | undefined> {
  const row = await db.query.providerContent.findFirst({
    where: { id },
    with: { content: true },
  });
  return row?.content ?? undefined;
}

export async function getCountProviderContent() {
  const number = await db
    .select({ count: count(providerContent.id) })
    .from(providerContent);
  return number;
}

// STREAMS
/**
 * Upsert keyed on `uq_stream_url`: stream rows are written with a fresh uuid
 * each scrape, so the url is the only stable identity.
 */
export async function upsertStream(rows: StreamInsert[]) {
  try {
    await db
      .insert(stream)
      .values(rows)
      .onConflictDoUpdate({
        target: stream.url,
        set: {
          providerContentId: sql.raw(
            `excluded.${stream.providerContentId.name}`,
          ),
          provider: sql.raw(`excluded.${stream.provider.name}`),
          externalId: sql.raw(`excluded.${stream.externalId.name}`),
          season: sql.raw(`excluded.${stream.season.name}`),
          episode: sql.raw(`excluded.${stream.episode.name}`),
          ttl: sql.raw(`excluded.${stream.ttl.name}`),
        },
      });
    const row = rows[0];
    logger.debug(
      `Upserted streams ${row?.providerContentId}:${row?.season}:${row?.episode}`,
    );
  } catch (e) {
    const row = rows[0];
    handleError(
      e,
      logger,
      `Failed to upsert streams ${row?.providerContentId}:${row?.season}:${row?.episode}`,
    );
  }
}

export async function getStreamsJoinProvider(
  id: string,
  season: number,
  episode: number,
) {
  const seasonString = season.toString();
  const episodeString = episode.toString();
  const rows = await db
    .select()
    .from(stream)
    .innerJoin(
      providerContent,
      eq(stream.providerContentId, providerContent.id),
    )
    .where(
      and(
        eq(stream.providerContentId, id),
        eq(stream.season, seasonString),
        eq(stream.episode, episodeString),
      ),
    );
  return rows;
}
export async function getCountStream() {
  const number = await db.select({ count: count(stream.id) }).from(stream);
  return number;
}

// SUBTITLES
export async function upsertSubtitles(
  subtitleRows: Omit<ESubtitleInsert, "createdAt">[],
) {
  const rows = subtitleRows.map((subtitle) => ({
    id: subtitle.id,
    providerContentId: subtitle.providerContentId,
    url: subtitle.url,
    lang: subtitle.lang,
    season: subtitle.season,
    episode: subtitle.episode,
    ttl: subtitle.ttl,
  }));

  try {
    await db
      .insert(subtitle)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          subtitle.providerContentId,
          subtitle.season,
          subtitle.episode,
          subtitle.lang,
        ],
        set: {
          url: sql.raw(`excluded.${subtitle.url.name}`),
          createdAt: sql.raw(`excluded.${subtitle.createdAt.name}`),
          ttl: sql.raw(`excluded.${subtitle.ttl.name}`),
        },
      });
    const row = rows[0];
    logger.debug(
      `Upserted subtitles ${row?.providerContentId}:${row?.season}:${row?.episode}`,
    );
  } catch (e) {
    const row = rows[0];
    handleError(
      e,
      logger,
      `Failed to upsert subtitles ${row?.providerContentId}:${row?.season}:${row?.episode}`,
    );
  }
}
export async function getSubtitlesJoinProvider(
  id: string,
  season: number,
  episode: number,
) {
  const row = await db
    .select()
    .from(subtitle)
    .innerJoin(
      providerContent,
      eq(subtitle.providerContentId, providerContent.id),
    )
    .where(
      and(
        eq(subtitle.providerContentId, id),
        eq(subtitle.season, season.toString()),
        eq(subtitle.episode, episode.toString()),
      ),
    );
  return row;
}
export async function getCountSubtitles() {
  const number = await db.select({ count: count(subtitle.id) }).from(subtitle);
  return number;
}

// SEARCH_MISS
/**
 * Remember titles TMDB could not match, so an unmatched catalog title costs
 * one search per miss TTL instead of one per restart (warm-cache re-renders
 * included). A re-record must re-arm both ttl and updatedAt — the prune and
 * read paths both expire on updated_at + ttl.
 */
export async function upsertSearchMiss(
  row: Omit<ESearchMissInsert, "createdAt" | "updatedAt">,
) {
  try {
    await db
      .insert(searchMiss)
      .values(row)
      .onConflictDoUpdate({
        target: [searchMiss.title, searchMiss.type],
        set: {
          ttl: sql.raw(`excluded.${searchMiss.ttl.name}`),
          updatedAt: sql.raw(`excluded.${searchMiss.updatedAt.name}`),
        },
      });
    logger.debug(`Upserted search miss ${row.title}`);
  } catch (e) {
    handleError(e, logger, `Failed to upsert search miss ${row.title}`);
  }
}

/**
 * Live miss rows only — expired rows are pruned at startup but linger
 * mid-run, so the read enforces updatedAt + ttl like the stream/subtitle
 * services do.
 */
export async function getSearchMiss(title: string, type: "movie" | "series") {
  try {
    const row = await db.query.searchMiss.findFirst({
      where: { title, type },
    });
    if (!row) return undefined;
    if (isExpired(row.updatedAt, row.ttl)) return undefined;
    return row;
  } catch (e) {
    handleError(e, logger, `Failed to read search miss ${title}`);
    return undefined;
  }
}

// META (key/value)
/**
 * Read a meta row or create it with `make` on first use. The re-read after
 * the conflict-tolerant insert returns the surviving value, so concurrent
 * first calls converge on one row.
 */
export async function getOrCreateMeta(
  key: string,
  make: () => string,
): Promise<string> {
  const read = () =>
    db
      .select({ value: meta.value })
      .from(meta)
      .where(eq(meta.key, key))
      .limit(1)
      .then((rows) => rows[0]?.value);
  const existing = await read();
  if (existing !== undefined) return existing;
  await db.insert(meta).values({ key, value: make() }).onConflictDoNothing();
  const written = await read();
  if (written === undefined) throw new Error(`Failed to persist meta ${key}`);
  return written;
}

// VISIT LOG
export type VisitKindCounts = Record<VisitKind, number>;

export interface VisitSummary {
  /** Request counts since local midnight, per kind */
  today: VisitKindCounts;
  /** Request counts over the last 7 days, per kind */
  week: VisitKindCounts;
  /** Distinct ip_hash values since local midnight (same-day dedup only) */
  uniqueToday: number;
  /** Distinct config_hash values since local midnight */
  installsToday: number;
  /** Manifest loads per local day, oldest first, zero-filled 14 days */
  daily: { day: string; count: number }[];
  /** Latest rows, newest first — display fields only */
  recent: {
    ts: number;
    kind: VisitKind;
    provider: string | null;
    client: string | null;
    status: number;
    durationMs: number;
  }[];
}

const VISIT_KINDS: VisitKind[] = [
  "landing",
  "manifest",
  "catalog",
  "meta",
  "stream",
  "subtitle",
];

// Visit rows feed the dashboard's counts and recent feed only — 30 days is
// plenty and keeps the table bounded (pruned at startup, below)
const VISIT_RETENTION_DAYS = 30;

const DAILY_CHART_DAYS = 14;

export async function insertVisit(row: EVisitInsert) {
  try {
    await db.insert(visit).values(row);
  } catch (e) {
    handleError(e, logger, "Failed to insert visit row");
  }
}

export async function pruneVisits() {
  const cutoff = Date.now() - VISIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    const result = await db.run(sql`DELETE FROM ${visit} WHERE ts < ${cutoff}`);
    const removed = Number(result.changes ?? 0);
    if (removed > 0) {
      logger.log(
        `Pruned ${removed} visit rows older than ${VISIT_RETENTION_DAYS} days`,
      );
    }
  } catch (e) {
    handleError(e, logger, "Failed to prune visit rows");
  }
}

const localMidnight = (): Date => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

const localDayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const kindCounts = async (since: Date): Promise<VisitKindCounts> => {
  const rows = await db
    .select({ kind: visit.kind, n: count(visit.id) })
    .from(visit)
    .where(gte(visit.ts, since))
    .groupBy(visit.kind);
  const out = Object.fromEntries(
    VISIT_KINDS.map((kind) => [kind, 0]),
  ) as VisitKindCounts;
  for (const row of rows) out[row.kind] = Number(row.n);
  return out;
};

const distinctCount = async (
  column: typeof visit.ipHash,
  since: Date,
): Promise<number> => {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${column})` })
    .from(visit)
    .where(and(gte(visit.ts, since), isNotNull(column)));
  return Number(row?.n ?? 0);
};

/**
 * The internal dashboard's read model: per-kind counts (today/week), the
 * 14-day manifest trend, distinct-visitor/installs for today and the
 * latest rows for the recent feed.
 */
export async function getVisitSummary(): Promise<VisitSummary> {
  const midnight = localMidnight();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fortnightAgo = new Date(Date.now() - DAILY_CHART_DAYS * 24 * 60 * 60 * 1000);

  const [today, week, uniqueToday, installsToday, dailyRows, recent] =
    await Promise.all([
      kindCounts(midnight),
      kindCounts(weekAgo),
      distinctCount(visit.ipHash, midnight),
      distinctCount(visit.configHash, midnight),
      db
        .select({
          day: sql<string>`strftime('%Y-%m-%d', ${visit.ts} / 1000, 'unixepoch', 'localtime')`,
          n: count(visit.id),
        })
        .from(visit)
        .where(and(eq(visit.kind, "manifest"), gte(visit.ts, fortnightAgo)))
        .groupBy(sql`strftime('%Y-%m-%d', ${visit.ts} / 1000, 'unixepoch', 'localtime')`),
      db
        .select({
          ts: visit.ts,
          kind: visit.kind,
          provider: visit.provider,
          client: visit.client,
          status: visit.status,
          durationMs: visit.durationMs,
        })
        .from(visit)
        .orderBy(desc(visit.ts))
        .limit(50),
    ]);

  const byDay = new Map(dailyRows.map((row) => [row.day, Number(row.n)]));
  const daily: { day: string; count: number }[] = [];
  for (let i = DAILY_CHART_DAYS - 1; i >= 0; i--) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const key = localDayKey(day);
    daily.push({ day: key, count: byDay.get(key) ?? 0 });
  }

  return {
    today,
    week,
    uniqueToday,
    installsToday,
    daily,
    recent: recent.map((row) => ({ ...row, ts: row.ts.getTime() })),
  };
}
