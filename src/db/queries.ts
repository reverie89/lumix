import type { ContentType } from "@stremio-addon/sdk";
import { and, count, eq, sql } from "drizzle-orm";
import type { ContentDetail } from "../source/meta.js";
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
 * Delete rows whose ttl has passed — stream/subtitle rows are otherwise
 * only filtered at read time and accumulate forever. Run at startup.
 */
export async function pruneExpiredRows() {
  const now = Date.now();
  try {
    for (const [name, table] of [
      ["stream", stream],
      ["subtitle", subtitle],
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
