import {
  AddonCatalogHandlerArgs,
  Cache,
  CatalogHandlerArgs,
  MetaDetail,
  MetaHandlerArgs,
  MetaPreview,
  ShortManifestResource,
  Stream,
  StreamHandlerArgs,
  Subtitle,
  SubtitlesHandlerArgs,
} from "@stremio-addon/sdk";
import ProviderService, {
  ProviderContentSource,
} from "../service/provider/provider-service.js";
import { KisskhScraper } from "../source/kisskh.js";
import { OleScraper } from "../source/ole.js";
import { IyfScraper } from "../source/iyf.js";
import { ContentDetail, ContentId } from "../source/meta.js";
import { BaseProvider } from "../source/provider.js";
import { tmdb, isTmdbEnabled, tmdbLanguage } from "../source/tmdb.js";
import { cache, TTL_MS, TTL_SECS } from "../utils/cache.js";
import { createSubtitleProxyUrl } from "../utils/domain.js";
import { extractTitle, safeYear } from "../utils/format.js";
import { Logger } from "../utils/logger.js";
import { defaultConfig } from "./manifest.js";
import { Prefix, Provider, UserConfig } from "../utils/config.js";

const kisskh = new KisskhScraper(Provider.KISSKH);
const ole = new OleScraper(Provider.OLE);
const iyf = new IyfScraper(Provider.IYF);
export const providers: BaseProvider[] = [kisskh, ole, iyf];
const logger = new Logger("ADDON");

// Empty/error results are cached briefly so a dead upstream or unresolvable
// id doesn't re-run the whole upstream chain on every client retry
const NEGATIVE_TTL_MS = 60 * 1000;

// Shared cache → db → remote skeleton for the meta-id branches (imdb/tmdb):
// memory cache first, then the db join, then the remote lookup, cached for
// the content TTL on success
async function resolveMetaContent(
  contentKey: string,
  contentType: "movie" | "series",
  probe: ContentId,
  season: string | undefined,
  episode: string | undefined,
  remote: () => Promise<ContentDetail | null>,
  onMiss: () => void,
): Promise<ContentDetail | null> {
  let content: ContentDetail | null = cache.get(contentKey);
  if (!content) {
    content = await ProviderService.getDbContent(
      contentType,
      probe,
      parseInt(season ?? "1"),
    );
    if (!content) {
      content = await remote();
      if (content) cache.set(contentKey, content, TTL_MS.content);
      else onMiss();
    }
  }
  if (!content) return null;
  if (season) content = { ...content, season: parseInt(season) };
  if (episode) content = { ...content, episode: parseInt(episode) };
  return content;
}

// The providers' id-based detail lookups, normalized to (title, year) for
// the service's content resolver
const kisskhContentSource: ProviderContentSource = {
  provider: Provider.KISSKH,
  idField: "kisskhId",
  async fetchDetail(externalId, config) {
    const { title, releaseDate } = await kisskh.getDetail(externalId, config);
    const extracted = extractTitle(title);
    return {
      title: extracted.title,
      year:
        extracted.year || safeYear(new Date(releaseDate).getFullYear()),
    };
  },
};

const oleContentSource: ProviderContentSource = {
  provider: Provider.OLE,
  idField: "oleId",
  async fetchDetail(externalId, config) {
    const { name, year: detailYear } = await ole.getDetail(
      externalId,
      config,
    );
    const extracted = extractTitle(name);
    return {
      title: extracted.title,
      year: extracted.year || safeYear(detailYear),
    };
  },
};

const iyfContentSource: ProviderContentSource = {
  provider: Provider.IYF,
  idField: "iyfId",
  async fetchDetail(externalId, config) {
    const { title, post_Year } = await iyf.getDetail(externalId, config);
    const extracted = extractTitle(title);
    return {
      title: extracted.title,
      year: extracted.year || safeYear(post_Year),
    };
  },
};

async function getContent(
  args: SubtitlesHandlerArgs | CatalogHandlerArgs,
  config: UserConfig = defaultConfig,
): Promise<ContentDetail | null> {
  const contentType = args.type === "series" ? "series" : "movie";
  switch (true) {
    case args.id.startsWith(Prefix.IMDB): {
      // imdb | tt0000:season:episode
      const [imdbId, season, episode] = args.id.split(":");
      if (!imdbId) return null;
      return resolveMetaContent(
        `content:imdb:${imdbId}`,
        contentType,
        { imdbId },
        season,
        episode,
        () =>
          isTmdbEnabled()
            ? tmdb.findDetailImdb(imdbId, contentType)
            : Promise.resolve(null),
        () => logger.warn(`No TMDB found with IMDB ${imdbId}`),
      );
    }
    case args.id.startsWith(Prefix.TMDB): {
      // tmdb | tmdb:movieId
      // tmdb | tmdb:seriesId:season:episode
      const [, tmdbId, season, episode] = args.id.split(":");
      if (!tmdbId) return null;
      return resolveMetaContent(
        `content:tmdb:${tmdbId}`,
        contentType,
        { tmdbId: parseInt(tmdbId) },
        season,
        episode,
        () =>
          isTmdbEnabled()
            ? tmdb.getDetailTmdb(tmdbId, contentType, tmdbLanguage(config))
            : Promise.resolve(null),
        () => logger.error(`Not found TMDB ${tmdbId}`),
      );
    }
    case args.id.startsWith(Prefix.KISSKH): {
      // id | kisskh:episodeId:season:episode
      const [, externalId, season, episode] = args.id.split(":");
      if (!externalId) return null;
      return ProviderService.resolveProviderDetail(
        kisskhContentSource,
        externalId,
        contentType,
        season,
        episode,
        config,
      );
    }
    case args.id.startsWith(Prefix.OLE): {
      // id | ole:vodId:season:episode
      const [, externalId, season, episode] = args.id.split(":");
      if (!externalId) return null;
      return ProviderService.resolveProviderDetail(
        oleContentSource,
        externalId,
        contentType,
        season,
        episode,
        config,
      );
    }
    case args.id.startsWith(Prefix.IYF): {
      // id | iyf:videoKey:season:episode
      const [, externalId, season, episode] = args.id.split(":");
      if (!externalId) return null;
      return ProviderService.resolveProviderDetail(
        iyfContentSource,
        externalId,
        contentType,
        season,
        episode,
        config,
      );
    }
  }
  return null;
}

export async function buildCatalogHandler(
  args: AddonCatalogHandlerArgs,
  config: UserConfig = defaultConfig,
): Promise<{ metas: MetaPreview[] } & Cache> {
  // id | kisskh.series.Korean
  logger.log(`Catalog | ${args.id}`);
  try {
    const { id, type } = args;
    const { skip, search } = args.extra;
    const catalogKey = `catalog:${type}:${id}:${skip}:${search}`;
    const cacheCatalog = cache.get(catalogKey);
    if (cacheCatalog) return cacheCatalog;
    const filteredProviders = filterProvider(providers, id, config, "catalog");
    const [provider] = filteredProviders;
    if (!provider) {
      logger.error(`No provider found for catalog ${id}`);
      return { metas: [] };
    }
    const metas = search
      ? await provider.searchCatalog(args, config)
      : await provider.getCatalog(args, config);
    const metaPreviews: { metas: MetaPreview[] } & Cache = { metas: metas };
    if (metas.length > 0) {
      metaPreviews.cacheMaxAge = 2 * 60 * 60;
      cache.set(catalogKey, metaPreviews, 4 * 60 * 60 * 1000);
    } else {
      cache.set(catalogKey, metaPreviews, NEGATIVE_TTL_MS);
    }
    return metaPreviews;
  } catch (error) {
    logger.error(`Catalog handler error: ${error}`);
    return { metas: [] };
  }
}

export async function buildMetaHandler(
  args: MetaHandlerArgs,
  config: UserConfig = defaultConfig,
): Promise<{ meta: MetaDetail } & Cache> {
  logger.log(`Meta | ${args.id}`);
  const { id, type } = args;
  // The meta detail carries TMDB text localized to the config language
  const metaKey = `meta:${type}:${id}:${config.language}`;
  const cacheMeta = cache.get(metaKey);
  if (cacheMeta) return cacheMeta;

  const defaultMeta: { meta: MetaDetail } & Cache = {
    meta: {
      id: args.id,
      type: args.type,
      name: "Error getting meta. Please try again later.",
    },
  };
  try {
    const content = await getContent(args, config);
    if (!content) {
      cache.set(metaKey, defaultMeta, NEGATIVE_TTL_MS);
      return defaultMeta;
    }

    // Dispatch through the config+prefix filter (not an id-prefix map lookup)
    // so every advertised prefix — kisskh:, tt:, tmdb: — resolves to the
    // provider that supports it
    const [provider] = filterProvider(providers, args.id, config, "meta");
    if (!provider) {
      logger.error(`No meta provider found for ${args.id}`);
      return defaultMeta;
    }
    const meta = defaultMeta;
    const detail = await provider.getMeta(content, args.type, config);
    if (detail) {
      meta.meta = detail;
      meta.cacheMaxAge = 1 * 60 * 60;
      cache.set(metaKey, meta, 4 * 60 * 60 * 1000);
    } else {
      cache.set(metaKey, meta, NEGATIVE_TTL_MS);
    }
    return meta;
  } catch (error) {
    logger.error(`Meta handler error: ${error}`);
    return defaultMeta;
  }
}

export async function buildStreamHandler(
  args: StreamHandlerArgs,
  config: UserConfig = defaultConfig,
): Promise<{ streams: Stream[] } & Cache> {
  logger.log(`Stream | ${args.id}`);
  try {
    const streamKey = `streams:${args.type}:${args.id}:${JSON.stringify(config.stream)}`;
    const cacheStreams = cache.get(streamKey);
    if (cacheStreams) return cacheStreams;
    const content = await getContent(args, config);
    if (!content) {
      return { streams: [] };
    }
    const filteredProviders = filterProvider(
      providers,
      args.id,
      config,
      "stream",
    );
    const streams = (
      await Promise.all(
        filteredProviders.map(async (provider) => {
          return await provider.getStreams(content, config);
        }),
      )
    ).flat();
    const notDone = streams.some((stream) => stream.url == undefined);
    const streamResults: { streams: Stream[] } & Cache = {
      streams: streams,
    };
    if (streams.length > 0 && !notDone) {
      streamResults.cacheMaxAge = 1 * 60 * 60;
      cache.set(streamKey, streamResults, TTL_MS.stream);
    } else {
      // Nothing usable (empty, or a rate-limit placeholder without a url):
      // cache briefly so a throttled upstream isn't re-scraped by every
      // client retry
      cache.set(streamKey, streamResults, NEGATIVE_TTL_MS);
    }
    return streamResults;
  } catch (error) {
    logger.error(`Streams handler error: ${error}`);
    return { streams: [] };
  }
}

// Cached lists keep raw upstream urls so one entry can serve every origin
// the addon is reached through; the /subtitle/ proxy url is rendered
// against the requesting client's origin at response time.
export function withProxyUrls(
  origin: string,
  result: { subtitles: Subtitle[] } & Cache,
): { subtitles: Subtitle[] } & Cache {
  return {
    ...result,
    subtitles: result.subtitles.map((subtitle) => ({
      ...subtitle,
      url: createSubtitleProxyUrl(origin, subtitle.url),
    })),
  };
}

export async function buildSubtitleHandler(
  args: SubtitlesHandlerArgs,
  config: UserConfig,
  origin: string,
): Promise<{ subtitles: Subtitle[] } & Cache> {
  logger.log(`Subtitles | ${args.id}`);
  try {
    const { id, type } = args;
    const subtitleKey = `subtitles:${type}:${id}:${JSON.stringify(config.stream)}`;
    const cacheAllSubtitles = cache.get(subtitleKey);
    if (cacheAllSubtitles) return withProxyUrls(origin, cacheAllSubtitles);
    const content = await getContent(args, config);
    if (content == null) {
      return { subtitles: [] };
    }
    const { season, episode } = content;
    const filteredProviders = filterProvider(
      providers,
      id,
      config,
      "subtitles",
    );
    const results = await Promise.allSettled(
      filteredProviders.map(async (provider) => {
        const providerSubtitleKey = `subtitles:${type}:${provider.name}:${content.id}:${season}:${episode}`;
        const cacheSubtitles: Subtitle[] = cache.get(providerSubtitleKey);
        if (cacheSubtitles) return cacheSubtitles;
        const providerSubtitles = await provider.getSubtitles(content, config);
        if (providerSubtitles) return providerSubtitles;
        return [];
      }),
    );
    const subsResults = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value)
      .flat();
    const subtitleResults: { subtitles: Subtitle[] } & Cache = {
      subtitles: subsResults.flat(),
    };
    if (subsResults.length > 0) {
      subtitleResults.cacheMaxAge = TTL_SECS.stream;
      cache.set(subtitleKey, subtitleResults, TTL_MS.stream);
    } else {
      cache.set(subtitleKey, subtitleResults, NEGATIVE_TTL_MS);
    }
    return withProxyUrls(origin, subtitleResults);
  } catch (error) {
    logger.error(`Subtitles handler error: ${error}`);
    return { subtitles: [] };
  }
}

function filterProvider(
  providers: BaseProvider[],
  id: string,
  config: UserConfig,
  resource: ShortManifestResource,
) {
  let configResource: Provider[] = [];
  if (resource === "catalog" || resource === "meta") {
    configResource = config.catalog;
  } else if (resource === "stream" || resource === "subtitles") {
    configResource = config.stream;
  }
  return providers.filter((provider) => {
    return (
      configResource.includes(provider.name) &&
      provider.supportedPrefix.some((prefix) => {
        return id.startsWith(prefix);
      })
    );
  });
}
