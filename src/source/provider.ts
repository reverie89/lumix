import {
  CatalogHandlerArgs,
  ContentType,
  MetaDetail,
  MetaPreview,
  Stream,
  Subtitle,
} from "@stremio-addon/sdk";
import { uuidv7 } from "uuidv7";
import ProviderService from "../service/provider/provider-service.js";
import { MirrorFailover } from "../service/mirror-failover.js";
import StreamService from "../service/resource/stream-service.js";
import { cache, TTL_MS } from "../utils/cache.js";
import {
  BROWSER_HEADERS,
  PROVIDER_LABELS,
  SHORT_NAME,
} from "../utils/constant.js";
import { Prefix, Provider, UserConfig } from "../utils/config.js";
import { handleError, RateLimitError } from "../utils/error.js";
import {
  cleanUrl,
  formatStreamFilename,
  formatStreamTitle,
} from "../utils/format.js";
import { Logger } from "../utils/logger.js";
import { upsertStream } from "../db/queries.js";
import { ContentDetail } from "./meta.js";

export abstract class BaseProvider {
  protected headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    ...BROWSER_HEADERS,
  };
  protected logger: Logger;
  readonly displayName: string;
  name: Provider;
  abstract supportedPrefix: Prefix[];
  // Every provider fronts a configurable mirror list; its failover instance
  // owns the origin-keyed success/fail memory
  abstract readonly defaultMirrors: string[];
  abstract readonly failover: MirrorFailover;
  // The ContentDetail field carrying this provider's external id — db
  // stream lookups key on `${name}:${externalId}`
  protected abstract providerIdField: "kisskhId" | "oleId" | "iyfId";

  constructor(name: Provider) {
    this.name = name;
    this.logger = new Logger(name);
    this.displayName = `${SHORT_NAME}/${PROVIDER_LABELS[this.name] ?? this.name}`;
  }

  /**
   * Mirror candidates for a request: the user's picked mirrors when set,
   * otherwise the built-in defaults.
   */
  mirrors(config?: UserConfig): string[] {
    const mirrors = config?.providers?.[this.name]?.mirrors;
    return mirrors && mirrors.length > 0 ? mirrors : this.defaultMirrors;
  }

  /**
   * Stream resolution shared by every provider: memory cache → db streams →
   * search fallback (resolveStreamTarget) → live generation. Non-empty
   * results are cached for the stream TTL; a rate-limited upstream yields
   * a placeholder stream so clients show a retryable row instead of an
   * empty player.
   */
  async getStreams(
    content: ContentDetail,
    config: UserConfig,
  ): Promise<Stream[]> {
    this.logger.log(`Stream | ${content.title} ${content.id}`);
    const { type, season, episode, id } = content;
    const streamKey = `streams:${type}:${this.name}:${id}:${season}:${episode}`;
    try {
      const cached = cache.get(streamKey);
      if (cached) return cached;
      const dbStreams = await StreamService.getDbStreams(
        `${this.name}:${content[this.providerIdField]}`,
        1,
        episode ?? 1,
        this.displayName,
      );
      if (dbStreams.length > 0) {
        cache.set(streamKey, dbStreams, TTL_MS.stream);
        return dbStreams;
      }
      const target = await this.resolveStreamTarget(content, config);
      if (target === null) {
        this.logger.log("No results");
        return [];
      }
      const streams = await this.generateStreams(target, content, config);
      if (streams.length > 0) cache.set(streamKey, streams, TTL_MS.stream);
      return streams;
    } catch (error: any) {
      handleError(error, this.logger);
      if (error instanceof RateLimitError) {
        return [
          StreamService.rateLimitPlaceholder(this.displayName, this.name),
        ];
      }
      return [];
    }
  }

  /**
   * The external stream id for a content: its own id when the content
   * carries one, else the provider's title search. Null = the search found
   * nothing. Numeric for kisskh/ole; iyf's alphanumeric key rides the
   * string side.
   */
  protected abstract resolveStreamTarget(
    content: ContentDetail,
    config: UserConfig,
  ): Promise<number | string | null>;

  protected abstract generateStreams(
    extId: number | string,
    content: ContentDetail,
    config: UserConfig,
  ): Promise<Stream[]>;

  /**
   * Build the playable stream row for a resolved url and persist it — one
   * shape for every provider so the live response and the db cache can't
   * drift. The content-linkage sync rides along fire-and-forget: the
   * stream itself doesn't need it, so the response never blocks on the
   * TMDB round-trip.
   */
  /**
   * The url persisted for db replays. The default strips the query so one
   * row accumulates per upstream asset; providers whose urls carry their
   * playback credential in the query (signed m3u8s) override to keep it —
   * a stripped signature is an unplayable replay.
   */
  protected dbStreamUrl(url: string): string {
    return cleanUrl(url);
  }

  protected buildStream(
    extId: number | string,
    url: string,
    content: ContentDetail,
    config: UserConfig,
  ): Stream[] {
    const { title, year, season, episode } = content;
    ProviderService.syncContentAndProvider(
      content,
      extId.toString(),
      this.name,
      config,
    ).catch((error) => handleError(error, this.logger, `Sync content failed`));
    const formatTitle = formatStreamTitle(title, year, season, episode);
    const streamDatas: Stream[] = [
      {
        url: url,
        name: this.displayName,
        description: formatTitle,
        behaviorHints: {
          notWebReady: true,
          bingeGroup: `${this.displayName}`,
          filename: `${formatStreamFilename(title, year, season, episode)}-${this.name}`,
        },
      },
    ];
    upsertStream([
      {
        id: uuidv7(),
        providerContentId: `${this.name}:${extId}`,
        provider: this.name,
        externalId: extId.toString(),
        season: "1",
        episode: episode?.toString() ?? "1",
        url: this.dbStreamUrl(url),
        ttl: TTL_MS.stream,
      },
    ]);
    return streamDatas;
  }

  /**
   * Catalog item → Stremio preview; the poster resolves DB-first (see
   * ProviderService.resolveProviderPoster). `background` pins the background
   * image; unset means the resolved poster. Movies point their default
   * video at season 1, episode 1.
   */
  protected async toPreview(
    item: { id: number | string },
    name: string,
    type: ContentType,
    fallbackPoster: string,
    opts: {
      background?: string | undefined;
      lookupTmdbId?: string | number | undefined;
    } = {},
  ): Promise<MetaDetail> {
    const id = `${this.name}:${item.id}`;
    const { poster } = await ProviderService.resolveProviderPoster(
      this.name,
      item.id,
      name,
      fallbackPoster,
      type,
      opts.lookupTmdbId,
    );
    const meta: MetaDetail = {
      id,
      name,
      type,
      background: opts.background ?? poster,
      poster,
    };
    if (type === "movie") {
      meta.behaviorHints = { defaultVideoId: `${id}:1:1` };
    }
    return meta;
  }

  /**
   * Meta release date overridden by the TMDB match's year — TMDB years are
   * reliable where provider year fields drift.
   */
  protected tmdbReleaseDate(
    year: number,
    date: string,
    tmdbDetail: ContentDetail | null,
  ): { year: number; date: string } {
    if (tmdbDetail && Number.isFinite(tmdbDetail.year) && tmdbDetail.year > 0) {
      const tmdbDate = new Date();
      tmdbDate.setFullYear(tmdbDetail.year);
      return { year: tmdbDetail.year, date: tmdbDate.toISOString() };
    }
    return { year, date };
  }

  abstract searchCatalog(
    args: CatalogHandlerArgs,
    config: UserConfig,
  ): Promise<MetaPreview[]>;

  abstract getCatalog(
    args: CatalogHandlerArgs,
    config: UserConfig,
  ): Promise<MetaPreview[]>;

  abstract getMeta(
    content: ContentDetail,
    type: ContentType,
    config?: UserConfig,
  ): Promise<MetaDetail | null>;

  abstract getSubtitles(
    content: ContentDetail,
    config?: UserConfig,
  ): Promise<Subtitle[]>;

  /**
   * @param pageSize total items per page
   * @param skip how much to skip
   * @returns page from 1
   */
  getPage(pageSize: number, skip?: number) {
    return skip ? Math.ceil(skip / pageSize) + 1 : 1;
  }
}
