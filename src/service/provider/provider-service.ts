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
import { UserConfig } from "../../lib/manifest.js";
import { ContentDetail, ContentId } from "../../source/meta.js";
import { Provider } from "../../source/provider.js";
import { tmdb, isTmdbEnabled } from "../../source/tmdb.js";
import { extractTitle } from "../../utils/format.js";

class ProviderService {
  static async getTotalProviderContent() {
    const count = await getCountProviderContent();
    return Number(count?.[0]?.count ?? 0);
  }

  /**
   * Poster for a catalog item, DB-first: a provider id already linked to a
   * content row resolves its stored TMDB art with no TMDB call, so cold
   * catalogs after a restart never re-search known titles. Unmapped titles
   * search TMDB once (callers persist the new mapping); a miss or a disabled
   * TMDB key falls back to the provider's own image.
   */
  static async resolveProviderPoster(
    provider: Provider,
    externalId: number | string,
    title: string,
    fallback: string,
    type: ContentType,
  ): Promise<{ poster: string; detail: ContentDetail | null }> {
    const linked = await getContentByProviderId(
      `${provider}:${externalId}`,
    );
    if (linked) {
      return { poster: linked.poster || fallback, detail: null };
    }
    if (!isTmdbEnabled()) {
      return { poster: fallback, detail: null };
    }
    const detail = await tmdb.searchDetail(title, type);
    return { poster: detail?.thumbnail || fallback, detail };
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

  static async syncContentAndProvider(
    content: ContentDetail,
    id: string,
    provider: Provider,
    config?: UserConfig,
  ) {
    const title = content.title;
    const providerContentId = `${provider}:${id}`;
    // The job of this sync is the content ↔ provider_content linkage; when
    // it already exists, skip the whole TMDB search chain (the meta handler
    // resolved the same title moments earlier)
    const linked = await getProviderContentById(providerContentId);
    if (linked?.contentId) return;
    if (!isTmdbEnabled()) return;
    const tmdbDetail = await tmdb.searchDetail(content.title, content.type);
    if (!tmdbDetail) return;
    const oldContent = await getContentByTmdb(
      tmdbDetail.id,
      content.type === "movie" ? "movie" : "series",
    );
    let contentId = uuidv7();
    if (oldContent) {
      contentId = oldContent.id;
    } else {
      // The upsert may resolve to an existing row inserted concurrently —
      // link the provider content to the id that is actually in the table
      contentId = (await upsertContent(contentId, tmdbDetail)) ?? contentId;
    }
    const providerContent = await getProviderContentById(providerContentId);
    if (providerContent) {
      await upsertProviderContent({
        ...providerContent,
        contentId: contentId,
        title: title,
      });
    } else {
      await upsertProviderContent({
        id: providerContentId,
        contentId: contentId,
        title: title,
        provider: provider,
        externalId: id.toString(),
        year: content.year,
      });
    }
  }
}

export default ProviderService;
