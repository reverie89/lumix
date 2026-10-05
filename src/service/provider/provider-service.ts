import type { ContentType } from "@stremio-addon/sdk";
import { uuidv7 } from "uuidv7";
import {
  getContentByProviderId,
  getContentByTmdb,
  getContentJoinProviderById,
  getCountProviderContent,
  getProviderContentsById as getMatchContentProvider,
  getProviderContentById,
  upsertContent,
  upsertProviderContent,
} from "../../db/queries.js";
import { cache, TTL_MS } from "../../utils/cache.js";
import { Provider, UserConfig } from "../../utils/config.js";
import { ContentDetail, ContentId } from "../../source/meta.js";
import { tmdb } from "../../source/tmdb.js";
import { extractTitle } from "../../utils/format.js";
import { Logger } from "../../utils/logger.js";

const logger = new Logger("PROVIDER");

/**
 * A provider's id-based detail lookup, normalized to (title, year): the
 * service resolves provider content without importing the scrapers.
 */
export interface ProviderContentSource {
  provider: Provider;
  idField: "kisskhId" | "oleId";
  fetchDetail(
    externalId: string,
    config?: UserConfig,
  ): Promise<{ title: string; year: number }>;
}

class ProviderService {
  static async getTotalProviderContent() {
    const count = await getCountProviderContent();
    return Number(count?.[0]?.count ?? 0);
  }

  /**
   * Poster for a catalog item, DB-first: a provider id already linked to a
   * content row resolves its stored TMDB art with no TMDB call, so cold
   * catalogs after a restart never re-search known titles. A fresh match is
   * persisted here (see persistContentMapping) so every caller — catalog,
   * search, preview — pays one TMDB search per title per deployment; a miss
   * or a disabled TMDB key falls back to the provider's own image.
   */
  static async resolveProviderPoster(
    provider: Provider,
    externalId: number | string,
    title: string,
    fallback: string,
    type: ContentType,
    lookupTmdbId?: string | number,
  ): Promise<{ poster: string; detail: ContentDetail | null }> {
    const linked = await getContentByProviderId(
      `${provider}:${externalId}`,
    );
    if (linked) {
      return { poster: linked.poster || fallback, detail: null };
    }
    const detail = await tmdb.searchDetail(title, type);
    if (detail) {
      await ProviderService.persistContentMapping(
        detail,
        provider,
        externalId,
        title,
        { lookupTmdbId },
      );
    }
    return { poster: detail?.thumbnail || fallback, detail };
  }

  /**
   * Write the provider_content row for a provider title. With a resolved
   * TMDB `detail` the row links to the content row — an existing one is the
   * link target (two providers naming one title converge on a single row),
   * a missing one is upserted fresh. With `detail` null the row persists
   * unlinked so the title is still known; the next pass that resolves a
   * TMDB match links it. An existing provider row keeps its link when no
   * match was found — a missed search must not un-map the title.
   * `lookupTmdbId` redirects the content-row probe (kisskh's known-id map)
   * without touching the stored tmdb id; `year` is the provider-side year
   * used when no detail supplies one.
   */
  static async persistContentMapping(
    detail: ContentDetail | null,
    provider: Provider,
    externalId: number | string,
    title: string,
    opts: {
      lookupTmdbId?: string | number | undefined;
      year?: number | undefined;
    } = {},
  ) {
    let contentId: string | null = null;
    if (detail) {
      const oldContent = await getContentByTmdb(
        (opts.lookupTmdbId ?? detail.id).toString(),
        detail.type === "movie" ? "movie" : "series",
      );
      if (oldContent) {
        contentId = oldContent.id;
        // Refresh the row with the fresh detail — artwork/overviews change
        // upstream, and a mapping (re)write is the one pass that re-resolves
        // the match
        await upsertContent(oldContent.id, detail);
      } else {
        // The upsert may resolve to an existing row inserted concurrently —
        // link the provider content to the id that is actually in the table
        contentId = (await upsertContent(uuidv7(), detail)) ?? uuidv7();
      }
    }
    const providerContentId = `${provider}:${externalId}`;
    const providerContent = await getProviderContentById(providerContentId);
    if (providerContent) {
      await upsertProviderContent({
        ...providerContent,
        contentId: contentId ?? providerContent.contentId,
        title: title,
        year: opts.year ?? providerContent.year,
      });
    } else {
      await upsertProviderContent({
        id: providerContentId,
        contentId: contentId,
        title: title,
        provider: provider,
        externalId: externalId.toString(),
        year: opts.year ?? detail?.year ?? new Date().getFullYear(),
      });
    }
  }

  static async getSameProviderContent(id: string) {
    const dbContentAndProvider = await getMatchContentProvider(id);
    const providerContents = dbContentAndProvider?.providerContent;
    if (
      dbContentAndProvider &&
      providerContents &&
      providerContents.length > 0
    ) {
      return dbContentAndProvider;
    }
    return null;
  }

  static async getContentAndProvider(
    type: "movie" | "series",
    contentId: ContentId,
  ) {
    const { imdbId, tmdbId, kisskhId, oleId } = contentId;
    const hasMetaId = imdbId || tmdbId;
    if (hasMetaId) {
      const dbContentAndProvider = await getContentJoinProviderById(
        type,
        imdbId,
        tmdbId,
      );
      const providerContents = dbContentAndProvider?.providerContent;
      if (
        dbContentAndProvider &&
        providerContents &&
        providerContents.length > 0
      ) {
        return dbContentAndProvider;
      }
    }
    // Provider-scoped ids probe their own row (`{provider}:{externalId}`)
    const providerIds: [Provider, string | undefined][] = [
      [Provider.KISSKH, kisskhId],
      [Provider.OLE, oleId],
    ];
    for (const [provider, externalId] of providerIds) {
      if (!externalId) continue;
      const dbContentAndProvider = await ProviderService.getSameProviderContent(
        `${provider}:${externalId}`,
      );
      const providerContents = dbContentAndProvider?.providerContent;
      if (
        dbContentAndProvider &&
        providerContents &&
        providerContents.length > 0
      ) {
        return dbContentAndProvider;
      }
    }
    return null;
  }

  static async getDbContent(
    type: "movie" | "series",
    contentId: ContentId,
    season: number,
  ) {
    let dbContent: ContentDetail | null = null;
    const { imdbId, tmdbId, kisskhId, oleId } = contentId;
    const id: string | undefined =
      imdbId ?? tmdbId?.toString() ?? kisskhId ?? oleId;
    if (!id) return null;
    const dbContentAndProvider = await ProviderService.getContentAndProvider(
      type,
      contentId,
    );
    if (!dbContentAndProvider) return null;
    const dbProviderContent = dbContentAndProvider.providerContent;
    dbContent = {
      id: id,
      title: dbContentAndProvider.title,
      year: dbContentAndProvider.year,
      type: type,
    };
    if (imdbId) dbContent.imdbId = imdbId;
    if (tmdbId) dbContent.tmdbId = tmdbId;
    if (dbContentAndProvider.imdbId)
      dbContent.imdbId = dbContentAndProvider.imdbId;
    if (dbContentAndProvider.tmdbId)
      dbContent.tmdbId = parseInt(dbContentAndProvider.tmdbId);

    // Set season from the correct provider
    if (kisskhId) {
      dbContent.kisskhId = kisskhId;
      const provider = dbProviderContent.find((providerContent) => {
        return providerContent.externalId === kisskhId;
      });
      if (provider) {
        const extractedTitle = extractTitle(provider.title);
        season = extractedTitle.season ?? 1;
      }
    }
    if (oleId) dbContent.oleId = oleId;
    dbProviderContent.forEach((providerContent) => {
      const extractedTitle = extractTitle(providerContent.title);
      const extractedSeason = extractedTitle.season ?? 1;
      if (
        providerContent.provider === Provider.KISSKH &&
        !kisskhId &&
        extractedSeason === season
      ) {
        dbContent.kisskhId = providerContent.externalId;
        dbContent.title = providerContent.title;
      }
      if (
        providerContent.provider === Provider.OLE &&
        !oleId &&
        extractedSeason === season
      ) {
        dbContent.oleId = providerContent.externalId;
      }
    });
    return dbContent;
  }

  /**
   * Resolve a provider-scoped content id (`{provider}:{externalId}`) to
   * detail: memory cache → db → providerContent row → the provider's own
   * detail api. A fresh detail persists its provider row (unlinked —
   * buildStream's sync does the TMDB search that links it) and caches the
   * result for the content TTL, so cold ids cost one upstream call.
   */
  static async resolveProviderDetail(
    source: ProviderContentSource,
    externalId: string,
    type: "movie" | "series",
    season: string | undefined,
    episode: string | undefined,
    config?: UserConfig,
  ): Promise<ContentDetail | null> {
    const contentKey = `content:${source.provider}:${externalId}`;
    const cached = cache.get(contentKey);
    if (cached) return cached;
    const probe: ContentId = {};
    probe[source.idField] = externalId;
    let content = await ProviderService.getDbContent(
      type,
      probe,
      parseInt(season ?? "1"),
    );
    if (content) {
      logger.log(`Found DB content ${contentKey}`);
    } else {
      const linked = await getProviderContentById(
        `${source.provider}:${externalId}`,
      );
      if (linked) {
        content = {
          id: externalId,
          type,
          title: linked.title,
          year: linked.year,
        };
        content[source.idField] = externalId;
      } else {
        const detail = await source.fetchDetail(externalId, config);
        content = {
          id: externalId,
          type,
          title: detail.title,
          year: detail.year,
        };
        content[source.idField] = externalId;
        await ProviderService.persistContentMapping(
          null,
          source.provider,
          externalId,
          detail.title,
          { year: detail.year },
        );
      }
      cache.set(contentKey, content, TTL_MS.content);
    }
    // Copy before setting season/episode: the cached entry is shared
    // between concurrent requests for different episodes of the same show
    return {
      ...content,
      season: season ? parseInt(season) : 1,
      episode: episode ? parseInt(episode) : 1,
    };
  }

  static async syncContentAndProvider(
    content: ContentDetail,
    id: string,
    provider: Provider,
    config?: UserConfig,
  ) {
    const providerContentId = `${provider}:${id}`;
    // The job of this sync is the content ↔ provider_content linkage; when
    // it already exists, skip the whole TMDB search chain (the meta handler
    // resolved the same title moments earlier)
    const linked = await getProviderContentById(providerContentId);
    if (linked?.contentId) return;
    const tmdbDetail = await tmdb.searchDetail(content.title, content.type);
    if (!tmdbDetail) return;
    await ProviderService.persistContentMapping(
      tmdbDetail,
      provider,
      id,
      content.title,
    );
  }
}

export default ProviderService;
