import {
  CatalogHandlerArgs,
  ContentType,
  MetaDetail,
  MetaPreview,
  MetaVideo,
  Stream,
  Subtitle,
} from "@stremio-addon/sdk";
import { AxiosRequestConfig } from "axios";
import * as cheerio from "cheerio";
import vm from "node:vm";
import { uuidv7 } from "uuidv7";
import {
  getContentByProviderId,
  getContentByTmdb,
  getProviderContentById,
  upsertContent,
  upsertProviderContent,
  upsertStream,
  upsertSubtitles,
} from "../db/queries.js";
import { ESubtitleInsert } from "../db/schema/subtitle.js";
import { Prefix, UserConfig } from "../lib/manifest.js";
import ProviderService from "../service/provider/provider-service.js";
import StreamService from "../service/resource/stream-service.js";
import SubtitleService from "../service/resource/subtitle-service.js";
import { axiosGet } from "../utils/axios.js";
import { cache, TTL_MS } from "../utils/cache.js";
import {
  KISSKH_DEFAULT_MIRRORS,
  KISSKH_FAIL_TTL_MS,
  RATE_LIMIT_DESCRIPTION,
} from "../utils/constant.js";
import { handleError, KisskhDetailError, KisskhEpisodeError, KisskhTokenError, RateLimitError } from "../utils/error.js";
import { cleanUrl, formatStreamFilename, formatStreamTitle, parseOrigin } from "../utils/format.js";
import { matchTitle } from "../utils/fuse.js";
import { CountryCode, iso639FromCountryCode } from "../utils/language.js";
import { getKisskhQuery } from "./kisskh-catalogs.js";
import { getSubtitleVtt } from "./kisskh-subtitle.js";
import { ContentDetail } from "./meta.js";
import { BaseProvider } from "./provider.js";
import { tmdb, isTmdbEnabled } from "./tmdb.js";

interface SearchResult {
  id: number;
  title: string;
  episodesCount: number;
  thumbnail: string;
}

// Compiled token bundles kept in memory, one per mirror origin
const MAX_TOKEN_SCRIPTS = 16;

interface KisskhCatalogData {
  data: KisskhCatalogItem[];
}
interface KisskhCatalogItem {
  episodesCount: number;
  thumbnail: string;
  id: number;
  title: string;
}
interface KisskhDetail {
  id: string;
  thumbnail: string;
  title: string;
  country: string;
  description: string;
  episodesCount: number;
  releaseDate: string;
  episodes: Episode[];
}
interface Episode {
  id: number;
  number: number;
  sub: number;
}
interface StreamResponse {
  Video: string;
  [key: string]: any;
}
interface SubResponse {
  src: string;
  label: string;
  land: string;
  default: boolean;
}

/**
 * Poster for a catalog item, DB-first: a kisskh id already linked to a
 * content row resolves its stored TMDB art with no TMDB call, so cold
 * catalogs after a restart never re-search known titles. Unmapped titles
 * search TMDB once (callers persist the new mapping); a miss or a disabled
 * TMDB key falls back to kisskh's own thumbnail.
 */
export async function resolveKisskhPoster(
  kisskhId: number | string,
  title: string,
  fallback: string,
  type: ContentType,
): Promise<{ poster: string; detail: ContentDetail | null }> {
  const linked = await getContentByProviderId(
    `${Prefix.KISSKH}:${kisskhId}`,
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

export class KisskhScraper extends BaseProvider {
  getBaseUrl(config?: UserConfig) {
    return getKisskhBaseUrl(getMirrors(config));
  }
  readonly supportedPrefix: Prefix[] = [
    Prefix.IMDB,
    Prefix.TMDB,
    Prefix.KISSKH,
  ];
  private readonly pageSize = 10;
  private readonly subGuid: string = "VgV52sWhwvBSf8BsM3BRY9weWiiCbtGp";
  private readonly viGuid: string = "62f176f3bb1b5b8e70e39932ad34a0c7";
  private getSearchUrl(config?: UserConfig) {
    return this.getBaseUrl(config) + "/api/DramaList/Search?q=";
  }
  private getExploreUrl(config?: UserConfig) {
    return this.getBaseUrl(config) + "/api/DramaList/List";
  }
  private getDetailUrl(config?: UserConfig) {
    return this.getBaseUrl(config) + "/api/DramaList/Drama";
  }
  private getEpisodeUrl(config?: UserConfig) {
    return this.getBaseUrl(config) + "/api/DramaList/Episode/{id}.png?kkey=";
  }
  private getSubUrl(config?: UserConfig) {
    return this.getBaseUrl(config) + "/api/Sub/{id}?kkey=";
  }
  // Token bundles compiled once per mirror origin — one compromised mirror
  // must not poison the script used for the others, and the ~100KB obfuscated
  // bundle must not recompile on every call
  private tokenScriptsByOrigin = new Map<
    string,
    { script: vm.Script; urls: string[] }
  >();
  private kisskhTmdb = new Map([
    [12422, "307602"],
    [7102, "219882"],
    [12479, "241860"],
  ]);

  async searchCatalog(
    args: CatalogHandlerArgs,
    config: UserConfig,
  ): Promise<MetaPreview[]> {
    const { id, type, extra } = args;
    const search = extra.search;
    this.logger.log(`Search | ${search}`);
    if (!search) {
      this.logger.error("Search term is required for search");
      return [];
    }
    const searchResults = await this.searchContent(
      search,
      type,
      undefined,
      undefined,
      false,
      config,
    );
    if (!searchResults[0]) return [];
    const filterResults = searchResults
      .filter((result) => {
        if (type == "series") return result.episodesCount > 1;
        else return result.episodesCount == 1;
      })
      .slice(0, this.pageSize);
    const metas = await Promise.all(
      filterResults.map(async (kissItem) => {
        const { poster } = await resolveKisskhPoster(
          kissItem.id,
          kissItem.title,
          kissItem.thumbnail,
          type,
        );

        const meta: MetaPreview = {
          id: `${Prefix.KISSKH}:${kissItem.id}`,
          name: kissItem.title,
          type: type,
          background: kissItem.thumbnail,
          poster: poster,
        };
        return meta;
      }),
    );
    return metas;
  }

  /**
   * Fetch an Explore category (type, region, status or update sort).
   * The catalog name resolves to a single upstream query, see kisskh-catalogs.
   */
  async getCatalog(
    args: CatalogHandlerArgs,
    config: UserConfig,
  ): Promise<MetaPreview[]> {
    const { id, type, extra } = args;
    const skip = extra.skip;
    const [prefix, typeStr, name] = id.split(".");
    const dbContentType = type === "movie" ? "movie" : "series";
    const query = getKisskhQuery(name ?? "", dbContentType);
    if (!query) {
      // Search catalogs resolve through searchCatalog, not here
      return [];
    }
    const page = this.getPage(this.pageSize, skip);
    const url =
      this.getExploreUrl(config) +
      `?page=${page}&type=${query.type}&sub=0&country=${query.country}&status=${query.status}&order=${query.order}`;

    this.logger.log(`GET catalog | ${url}`);
    const catalogData = await this.getWithMetrics<KisskhCatalogData>(url);
    const flatDatas = Array.isArray(catalogData?.data) ? catalogData.data : [];

    // Map to final Meta format. Posters resolve DB-first (see resolvePoster):
    // only unmapped titles cost a TMDB search, and each hit persists its
    // mapping so the next render skips TMDB entirely.
    const metas = await Promise.all(
      flatDatas.map(async (kissItem) => {
        const id = `${Prefix.KISSKH}:${kissItem.id}`;
        const { poster, detail: tmdbDetail } = await resolveKisskhPoster(
          kissItem.id,
          kissItem.title,
          kissItem.thumbnail,
          type,
        );

        // Persist a fresh TMDB match (skipped for DB-resolved items, which
        // already have their rows)
        if (tmdbDetail) {
          const contentTmdbId = this.kisskhTmdb.get(kissItem.id) ?? tmdbDetail.id;
          const existingContent = await getContentByTmdb(
            contentTmdbId,
            dbContentType,
          );
          let contentId: string = uuidv7();
          if (existingContent) {
            contentId = existingContent.id;
          } else {
            contentId =
              (await upsertContent(
                contentId,
                { ...tmdbDetail, id: contentTmdbId },
              )) ?? contentId;
            upsertProviderContent({
              title: kissItem.title,
              contentId: contentId,
              provider: this.name,
              externalId: kissItem.id.toString(),
              year: tmdbDetail.year,
              id: id,
            });
          }
        }
        const metaDetail: MetaDetail = {
          id: id,
          name: kissItem.title,
          type: type,
          background: kissItem.thumbnail,
          poster: poster,
        };

        if (type === "movie") {
          metaDetail.behaviorHints = {
            defaultVideoId: `${id}:1:1`,
          };
          return metaDetail;
        }
        return metaDetail;
      }),
    );
    return metas;
  }

  async getMeta(
    content: ContentDetail,
    type: ContentType,
    config?: UserConfig,
  ): Promise<MetaDetail | null> {
    const detail = await this.getDetail(content.id, config);
    const episodes = Array.isArray(detail.episodes) ? detail.episodes : [];
    // releaseDate has been missing/invalid upstream before; never feed an
    // invalid Date to toISOString (it throws RangeError)
    const releaseDate = new Date(detail.releaseDate);
    const fallbackDate = new Date();
    const validRelease = !Number.isNaN(releaseDate.getTime());
    let year = validRelease ? releaseDate.getFullYear() : fallbackDate.getFullYear();
    let date = (validRelease ? releaseDate : fallbackDate).toISOString();
    const tmdbDetail = isTmdbEnabled()
      ? await tmdb.searchDetail(detail.title, type)
      : null;
    const background = tmdbDetail?.background || detail.thumbnail;
    const metaId = `${Prefix.KISSKH}:${detail.id}`;
    // The two reads are independent — run them together
    const [oldContent, existingContent] = await Promise.all([
      tmdbDetail
        ? getContentByTmdb(
            tmdbDetail.id,
            type === "movie" ? "movie" : "series",
          )
        : Promise.resolve(undefined),
      getProviderContentById(metaId),
    ]);
    if (tmdbDetail) {
      detail.description = tmdbDetail.overview || detail.description;
      if (Number.isFinite(tmdbDetail.year) && tmdbDetail.year > 0) {
        year = tmdbDetail.year;
        const tmdbDate = new Date();
        tmdbDate.setFullYear(tmdbDetail.year);
        date = tmdbDate.toISOString();
      }
      if (oldContent) {
        upsertContent(oldContent.id, tmdbDetail);
      }
    }
    const season = 1;
    const videos: MetaVideo[] = episodes.map((ep) => {
      const episodeNum = ep.number;
      let id = `kisskh:${detail.id}:${season}:${episodeNum}`;
      // In Kisskh sometimes movie also has multiple episodes
      return {
        id: id,
        released: date,
        title: detail.title,
        type: type,
        description: detail.description,
        thumbnail: detail.thumbnail,
        background: background,
        season: season,
        episode: episodeNum,
      };
    });
    const meta: MetaDetail = {
      id: metaId,
      name: detail.title,
      logo: tmdbDetail?.logo ?? "",
      poster: detail.thumbnail,
      background: background,
      type: type,
      description: detail.description,
      country: detail.country,
      released: date,
      videos: videos,
    };

    const contentId = oldContent ? oldContent.id : null;
    if (existingContent && oldContent) {
      await upsertProviderContent({
        ...existingContent,
        contentId: contentId,
        year: year,
      });
    } else {
      await upsertProviderContent({
        id: metaId,
        contentId: contentId,
        title: detail.title,
        provider: this.name,
        externalId: detail.id,
        year: year,
      });
    }
    return meta;
  }

  async getStreams(
    content: ContentDetail,
    config: UserConfig,
  ): Promise<Stream[]> {
    this.logger.log(`Stream | ${content.title} ${content.id}`);
    const { title, type, year, season, episode, id, kisskhId } =
      content;
    try {
      const streamKey = `streams:${type}:${this.name}:${id}:${season}:${episode}`;
      const cacheStreams = cache.get(streamKey);
      if (cacheStreams) return cacheStreams;
      const dbStreams = await StreamService.getDbStreams(
        `${this.name}:${kisskhId}`,
        1,
        episode ?? 1,
        this.displayName,
      );
      if (dbStreams.length > 0) {
        cache.set(streamKey, dbStreams, TTL_MS.stream);
        return dbStreams;
      }
      let streamId = parseInt(kisskhId ?? "0");
      let streamTitle = title;
      if (!kisskhId) {
        const searchResult = await this.searchContent(
          title,
          type,
          year,
          season,
          true,
          config,
        );
        if (!searchResult[0]) {
          this.logger.log("No results");
          return [];
        }
        const search = searchResult[0];
        streamId = search.id;
        streamTitle = search.title;
      }
      const streams = await this.generateStreamsAndSubtitles(
        streamId,
        streamTitle,
        content,
        config,
      );
      if (streams.length > 0) cache.set(streamKey, streams, TTL_MS.stream);
      return streams;
    } catch (error: any) {
      handleError(error, this.logger);
      if (error instanceof RateLimitError)
        return [
          {
            name: this.displayName,
            description: RATE_LIMIT_DESCRIPTION,
            behaviorHints: {
              notWebReady: true,
              bingeGroup: `${this.displayName}`,
              filename: `${RATE_LIMIT_DESCRIPTION}-${this.name}`,
            },
          },
        ];
      return [];
    }
  }

  async getSubtitles(
    content: ContentDetail,
    config?: UserConfig,
  ): Promise<Subtitle[]> {
    const subtitleKey = `subtitles:${content.type}:${this.name}:${content.id}:${content.season}:${content.episode}`;
    let kisskhId = content.kisskhId ? parseInt(content.kisskhId) : undefined;
    let cacheSubtitles = cache.get(subtitleKey);
    if (cacheSubtitles) return cacheSubtitles;
    const savedSubtitles = await SubtitleService.getSubtitlesFromDb(
      `${this.name}:${content.kisskhId}`,
      1,
      content.episode ?? 1,
    );
    if (savedSubtitles.length > 0) {
      // Rows can outlive a restart while the in-memory origin registry
      // cannot; re-register so the /subtitle proxy still admits them
      savedSubtitles.forEach((subtitle) =>
        rememberSubtitleOrigin(parseOrigin(subtitle.url)),
      );
      cache.set(subtitleKey, savedSubtitles, TTL_MS.stream);
      return savedSubtitles;
    }
    if (!kisskhId) {
      const search = await this.searchContent(
        content.title,
        content.type,
        content.year,
        content.season,
        true,
        config,
      );
      if (!search[0]) return [];
      kisskhId = search[0]?.id;
    }
    const episodeData = await this._getEpisode(kisskhId, content.episode, config);
    const episodeId = episodeData.episodeId;
    return await this._getSubtitles(episodeId, kisskhId, content.episode, config);
  }

  async searchContent(
    title: string,
    type: ContentType,
    year?: number,
    season?: number,
    filter: boolean = true,
    config?: UserConfig,
  ): Promise<SearchResult[]> {
    switch (type) {
      case "series":
      case "movie":
        const shows = await this._getShows(
          title,
          year,
          season,
          filter,
          config,
        );
        return shows;
      default:
        return [];
    }
  }

  async generateStreamsAndSubtitles(
    kisskhId: number,
    title: string,
    content: ContentDetail,
    config: UserConfig,
  ): Promise<Stream[]> {
    const { episode, id, season, year, type } = content;
    const { episodeId, kisskhDetail } = await this._getEpisode(
      kisskhId,
      episode,
      config,
    );
    const token = await this._getToken(episodeId, this.viGuid, config);
    const stream = await this._getStream(episodeId, token, config);
    if (!stream) return [];
    if (!stream.Video) return [];
    const url = this._fixUrl(stream.Video);
    // Persistence only — the streams below don't need it, so don't block
    // the response on two TMDB round-trips
    ProviderService.syncContentAndProvider(
      content,
      kisskhId.toString(),
      this.name,
      config,
    ).catch((error) => handleError(error, this.logger, `Sync content failed`));
    // Handle rate limit
    if (stream.Video.includes(RATE_LIMIT_DESCRIPTION))
      throw new RateLimitError(content.title);
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
        providerContentId: `${this.name}:${kisskhId}`,
        provider: this.name,
        externalId: kisskhId.toString(),
        season: "1",
        episode: episode?.toString() ?? "1",
        url: cleanUrl(url),
        ttl: TTL_MS.stream,
      },
    ]);
    return streamDatas;
  }

  private async _getToken(
    episodeId: string,
    uid: string,
    config?: UserConfig,
  ): Promise<string> {
    // episodeId lands inside evaluated JS source: only plain numbers may pass
    if (!/^\d+$/.test(episodeId)) {
      throw new KisskhTokenError(`Invalid episode id for token generation`);
    }
    const baseUrl = this.getBaseUrl(config);
    const origin = parseOrigin(baseUrl);
    let entry = this.tokenScriptsByOrigin.get(origin);
    if (!entry) {
      const indexUrl = baseUrl + "/index.html";
      const html = await axiosGet<string>(indexUrl);
      if (!html)
        throw new KisskhTokenError(
          `Failed to fetch index.html for token generation`,
        );
      const $ = cheerio.load(html);
      const scriptSrc = $('script[src*="common"]').attr("src");
      if (!scriptSrc) {
        throw new KisskhTokenError(`Token script not found on ${origin}`);
      }
      const scriptUrl = baseUrl + "/" + scriptSrc;
      const jsCode = await axiosGet<string>(scriptUrl);
      if (!jsCode) {
        throw new KisskhTokenError(
          `Failed to fetch token script from ${origin}`,
        );
      }
      entry = { script: new vm.Script(jsCode), urls: [indexUrl, scriptUrl] };
      // Bounded: many distinct mirror origins must not grow this map
      while (this.tokenScriptsByOrigin.size >= MAX_TOKEN_SCRIPTS) {
        const oldest = this.tokenScriptsByOrigin.keys().next().value;
        if (oldest === undefined) break;
        this.tokenScriptsByOrigin.delete(oldest);
      }
      this.tokenScriptsByOrigin.set(origin, entry);
    }

    // Fresh empty context per call: the bundle defines the token function in
    // its own scope only, and a hostile bundle gets no process/require access
    try {
      const context = vm.createContext({});
      entry.script.runInContext(context, { timeout: 1000 });
      const token = vm.runInContext(
        `_0x54b991(${episodeId}, null, "2.8.10", "${uid}", 4830201, "kisskh", "kisskh", "kisskh", "kisskh", "kisskh", "kisskh")`,
        context,
        { timeout: 1000 },
      );
      if (!token) {
        throw new KisskhTokenError(`Token generation failed`);
      }
      return token;
    } catch (e) {
      // The mirror may have rotated its bundle: drop the compiled script and
      // its url-cached sources so the next call re-fetches fresh
      this.tokenScriptsByOrigin.delete(origin);
      for (const url of entry.urls) {
        cache.delete(`url:${url}`);
      }
      throw new KisskhTokenError(`Token generation failed | ${e}`);
    }
  }

  /**
   * axiosGet wrapped with per-mirror success/fail accounting so mirror
   * failover learns from every request, not only stream fetches.
   */
  private async getWithMetrics<T>(
    url: string,
    axiosConfig?: AxiosRequestConfig,
  ): Promise<T | null> {
    try {
      const data = await axiosGet<T>(url, axiosConfig);
      if (data === null || data === undefined) {
        markKisskhUrlFail(url);
      } else {
        markKisskhUrlSuccess(url);
      }
      return data;
    } catch (error) {
      markKisskhUrlFail(url);
      throw error;
    }
  }

  private async _getShows(
    title: string,
    year?: number,
    season?: number,
    isFilter: boolean = true,
    config?: UserConfig,
  ): Promise<SearchResult[]> {
    const url = `${this.getSearchUrl(config)}${encodeURIComponent(title)}&type=0`;
    this.logger.log(`GET search | ${url}`);
    const searchData = await this.getWithMetrics<SearchResult[]>(url);
    if (!searchData || !Array.isArray(searchData)) {
      return [];
    }
    const showList = searchData;
    const show = isFilter
      ? matchTitle(showList, title, year, season)
      : showList;
    this.logger.debug(`SeriesId/MovieId | ${JSON.stringify(show[0]?.id)}`);
    return show;
  }

  public async getDetail(
    kisskhId: string,
    config?: UserConfig,
  ): Promise<KisskhDetail> {
    if (!/^\d+$/.test(kisskhId)) {
      throw new KisskhDetailError(`Invalid kisskh id | ${kisskhId}`);
    }
    const url = `${this.getDetailUrl(config)}/${kisskhId}`;
    this.logger.log(`GET detail | ${url}`);
    const episodesData = await this.getWithMetrics<KisskhDetail>(url, {
      headers: this.headers,
    });
    if (episodesData) {
      return episodesData;
    } else
      throw new KisskhDetailError(`Not found detail from id | ${kisskhId}`);
  }

  private async _getEpisode(
    seriesId: number,
    episode: number = 1,
    config?: UserConfig,
  ): Promise<{ episodeId: string; kisskhDetail: KisskhDetail }> {
    const detail = await this.getDetail(seriesId.toString(), config);
    const episodes = Array.isArray(detail?.episodes) ? detail.episodes : [];
    const episodeCount = detail?.episodesCount;
    if (!detail || episodeCount === undefined || episodes.length === 0) {
      throw new KisskhEpisodeError("No episode data found");
    }
    const fallbackEpisodeData = episodes[episodeCount - episode];
    const episodeData =
      episodes.find((episodeData) => {
        return episodeData.number == episode;
      }) || fallbackEpisodeData;

    const episodeId = episodeData?.id;
    if (!episodeId) {
      throw new KisskhEpisodeError(
        `Episode ID not found ${this.name}:${seriesId}:${episode}`,
      );
    }
    this.logger.debug(`EpisodeId | ${episodeId}`);
    return { episodeId: episodeId.toString(), kisskhDetail: detail };
  }

  private async _getStream(episodeId: string, token: string, config?: UserConfig) {
    const url = this.getEpisodeUrl(config).replace("{id}", episodeId) + token;
    this.logger.log(`GET stream | ${url}`);
    try {
      // Short url-cache: stream tokens must not outlive the 30min addon
      // stream cache, or a re-run reuses a dead HLS link
      const stream = await axiosGet<StreamResponse>(
        url,
        { timeout: 15000 },
        25 * 60 * 1000,
      );
      if (!stream) {
        return null;
      }
      this.logger.log(`Stream Url | ${stream.Video}`);
      markKisskhUrlSuccess(url);
      return stream;
    } catch (error) {
      if (error instanceof RateLimitError) {
        markKisskhUrlFail(url);
        return { Video: RATE_LIMIT_DESCRIPTION };
      }
      handleError(error, this.logger, `Fail to get stream`);
      return null;
    }
  }

  private async _getSubtitles(
    episodeId: string,
    kisskhId: number,
    episode?: number,
    config?: UserConfig,
  ): Promise<Subtitle[]> {
    const token = await this._getToken(episodeId, this.subGuid, config);
    const subtitleUrl = this.getSubUrl(config).replace("{id}", episodeId) + token;
    this.logger.log(`GET subtitles | ${subtitleUrl}`);
    const subtitleDatas = await this.getWithMetrics<SubResponse[]>(subtitleUrl);
    if (!subtitleDatas || !Array.isArray(subtitleDatas)) return [];
    const listOrigin = parseOrigin(subtitleUrl);
    const subtitles: Subtitle[] = [];
    const subtitleRows: Omit<ESubtitleInsert, "createdAt">[] = [];
    subtitleDatas.forEach((subtitleData, index) => {
      const lang = iso639FromCountryCode(subtitleData.land as CountryCode);
      // src may be mirror-relative; resolve it against the mirror that
      // served the list so every later fetch hits a known-good host
        const src = new URL(subtitleData.src, listOrigin).toString();
        rememberSubtitleOrigin(parseOrigin(src));
      // The CDN serves .srt as application/octet-stream, which strict
      // players (Stremio on TV) refuse to render — the handler layer routes
      // every track through the addon's /subtitle/ proxy as text/vtt. The
      // raw url is kept here so caches stay origin-independent.
      subtitles.push({
        id: `${this.name}-${index.toString()}`,
        lang: lang,
        url: src,
        label: subtitleData.label?.trim() || lang || this.name,
      });
      subtitleRows.push({
        id: uuidv7(),
        providerContentId: `${this.name}:${kisskhId}`,
        season: "1",
        episode: episode?.toString() ?? "1",
        url: src,
        lang: lang,
        ttl: TTL_MS.stream,
      });
      // Warm the conversion cache without blocking the response; the proxy
      // route converts on demand if this hasn't landed yet
      void getSubtitleVtt(src).catch(() => {});
    });
    if (subtitleRows.length > 0) {
      upsertSubtitles(subtitleRows);
    }
    this.logger.log(`Subtitles found | ${subtitles.length}`);
    return subtitles;
  }

  private _fixUrl(url: string): string {
    if (!url.startsWith("http")) {
      return `https:${url}`;
    }
    return url;
  }
}

interface UrlMetrics {
  success: number;
  fail: number;
  lastFail: number;
}

const kisskhMetrics = new Map<string, UrlMetrics>();

/**
 * Mirror candidates for a request: the user's picked mirrors when set,
 * otherwise the built-in defaults.
 */
function getMirrors(config?: UserConfig): string[] {
  const mirrors = config?.providers?.kisskh?.mirrors;
  return mirrors && mirrors.length > 0 ? mirrors : KISSKH_DEFAULT_MIRRORS;
}

/**
 * Mirror picks follow the user's config order: the first mirror without a
 * recent failure serves. When every mirror failed within the TTL window,
 * the best success/fail ratio serves so traffic lands somewhere healthy.
 */
function selectKisskhUrl(urls: string[]): string {
  const now = Date.now();
  const isFailed = (url: string) => {
    const metrics = kisskhMetrics.get(url);
    return (
      !!metrics &&
      metrics.fail > 0 &&
      now - metrics.lastFail < KISSKH_FAIL_TTL_MS
    );
  };
  const healthy = urls.find((url) => !isFailed(url));
  if (healthy) {
    return healthy;
  }
  const sorted = urls.map((url) => ({
    url,
    metrics: kisskhMetrics.get(url),
  })).sort((a, b) => {
    const aScore =
      ((a.metrics?.success ?? 0) + 1) / ((a.metrics?.fail ?? 0) + 1);
    const bScore =
      ((b.metrics?.success ?? 0) + 1) / ((b.metrics?.fail ?? 0) + 1);
    return bScore - aScore;
  });
  return sorted[0]?.url || KISSKH_DEFAULT_MIRRORS[0]!;
}

export function getKisskhMetrics(): Map<string, UrlMetrics> {
  return kisskhMetrics;
}

export function getKisskhBaseUrl(urls: string[] = KISSKH_DEFAULT_MIRRORS): string {
  return selectKisskhUrl(urls);
}

export function markKisskhUrlSuccess(url: string): void {
  const host = parseOrigin(url);
  const metrics = kisskhMetrics.get(host) ?? {
    success: 0,
    fail: 0,
    lastFail: 0,
  };
  metrics.success++;
  kisskhMetrics.set(host, metrics);
}

export function markKisskhUrlFail(url: string): void {
  const host = parseOrigin(url);
  const metrics = kisskhMetrics.get(host) ?? {
    success: 0,
    fail: 0,
    lastFail: 0,
  };
  metrics.fail++;
  metrics.lastFail = Date.now();
  kisskhMetrics.set(host, metrics);
}

// Mirrors may live on any user-supplied host, and subtitle files resolve
// against the mirror that served the list. The /subtitle proxy allowlist
// admits the origins actually seen serving subtitle lists; entries expire
// with the stream TTL so the registry cannot grow unbounded.
const seenSubtitleOrigins = new Map<string, number>();

export function rememberSubtitleOrigin(origin: string): void {
  const now = Date.now();
  for (const [seenOrigin, seenAt] of seenSubtitleOrigins) {
    if (now - seenAt > TTL_MS.stream) {
      seenSubtitleOrigins.delete(seenOrigin);
    }
  }
  seenSubtitleOrigins.set(origin, now);
}

export function isSeenSubtitleOrigin(origin: string): boolean {
  const seenAt = seenSubtitleOrigins.get(origin);
  if (!seenAt) return false;
  if (Date.now() - seenAt > TTL_MS.stream) {
    seenSubtitleOrigins.delete(origin);
    return false;
  }
  return true;
}
