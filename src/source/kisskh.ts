import {
  CatalogHandlerArgs,
  ContentType,
  MetaDetail,
  MetaPreview,
  MetaVideo,
  Stream,
  Subtitle,
} from "@stremio-addon/sdk";
import * as cheerio from "cheerio";
import vm from "node:vm";
import { uuidv7 } from "uuidv7";
import {
  upsertSubtitles,
} from "../db/queries.js";
import { ESubtitleInsert } from "../db/schema/subtitle.js";
import { Prefix, UserConfig } from "../utils/config.js";
import { MirrorFailover } from "../service/mirror-failover.js";
import ProviderService from "../service/provider/provider-service.js";
import SubtitleService from "../service/resource/subtitle-service.js";
import { axiosGet } from "../utils/axios.js";
import { cache, TTL_MS } from "../utils/cache.js";
import {
  KISSKH_DEFAULT_MIRRORS,
  MIRROR_FAIL_TTL_MS,
  RATE_LIMIT_DESCRIPTION,
} from "../utils/constant.js";
import { handleError, KisskhDetailError, KisskhEpisodeError, KisskhTokenError, RateLimitError } from "../utils/error.js";
import { cleanUrl, parseOrigin, safeYear } from "../utils/format.js";
import { matchTitle } from "../utils/fuse.js";
import { CountryCode, iso639FromCountryCode } from "../utils/language.js";
import { Logger } from "../utils/logger.js";
import { getKisskhQuery } from "./kisskh-catalogs.js";
import { getSubtitleVtt } from "./kisskh-subtitle.js";
import { ContentDetail } from "./meta.js";
import { BaseProvider } from "./provider.js";
import { tmdb, tmdbLanguage } from "./tmdb.js";

interface SearchResult {
  id: number;
  title: string;
  episodesCount: number;
  thumbnail: string;
}

// Shared mirror memory: every kisskh request feeds the same origin metrics.
// The last-resort fallback degrades to "" when no mirror is deployed
// (KISSKH_MIRRORS unset) — request building fails and the warning says why.
if (KISSKH_DEFAULT_MIRRORS.length === 0) {
  new Logger("KISSKH").warn("No mirrors configured | set KISSKH_MIRRORS in .env");
}
const kisskhFailover = new MirrorFailover(
  MIRROR_FAIL_TTL_MS,
  KISSKH_DEFAULT_MIRRORS[0] ?? "",
);

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

export class KisskhScraper extends BaseProvider {
  readonly defaultMirrors = KISSKH_DEFAULT_MIRRORS;
  readonly failover = kisskhFailover;
  getBaseUrl(config?: UserConfig) {
    return kisskhFailover.select(this.mirrors(config));
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
      filterResults.map((kissItem) =>
        this.toPreview(kissItem, kissItem.title, type, kissItem.thumbnail, {
          // kisskh keeps its own upstream thumbnail as the background (same
          // rule as getCatalog)
          background: kissItem.thumbnail,
        }),
      ),
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
    const [, , name] = id.split(".");
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
    const catalogData = await kisskhFailover.get<KisskhCatalogData>(url);
    const flatDatas = Array.isArray(catalogData?.data) ? catalogData.data : [];

    const metas = await Promise.all(
      flatDatas.map((kissItem) =>
        this.toPreview(kissItem, kissItem.title, type, kissItem.thumbnail, {
          // kisskh keeps its own upstream thumbnail as the background; the
          // resolved poster (TMDB when mapped) fills the poster slot
          background: kissItem.thumbnail,
          lookupTmdbId: this.kisskhTmdb.get(kissItem.id),
        }),
      ),
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
    // Upstream releaseDate may be missing or invalid: an invalid Date
    // throws RangeError on toISOString
    const releaseDate = new Date(detail.releaseDate);
    const validRelease = !Number.isNaN(releaseDate.getTime());
    let year = safeYear(validRelease ? releaseDate.getFullYear() : undefined);
    let date = (validRelease ? releaseDate : new Date()).toISOString();
    // TMDB text localizes to the config language (matching stays English,
    // see searchDetail)
    const tmdbDetail = await tmdb.searchDetail(
      detail.title,
      type,
      undefined,
      tmdbLanguage(config),
    );
    const background = tmdbDetail?.background || detail.thumbnail;
    const metaId = `${Prefix.KISSKH}:${detail.id}`;
    if (tmdbDetail) {
      detail.description = tmdbDetail.overview || detail.description;
    }
    ({ year, date } = this.tmdbReleaseDate(year, date, tmdbDetail));
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

    // Persist the mapping (linked when TMDB matched, unlinked otherwise) so
    // the next catalog/meta pass resolves from the DB
    await ProviderService.persistContentMapping(
      tmdbDetail,
      this.name,
      detail.id,
      detail.title,
      { year: year },
    );
    return meta;
  }

  protected providerIdField = "kisskhId" as const;

  /**
   * The stream target: the content's kisskh id when present, else a title
   * search across the picked mirrors.
   */
  protected async resolveStreamTarget(
    content: ContentDetail,
    config: UserConfig,
  ): Promise<number | null> {
    const { title, type, year, season, kisskhId } = content;
    if (kisskhId) return parseInt(kisskhId);
    const searchResult = await this.searchContent(
      title,
      type,
      year,
      season,
      true,
      config,
    );
    const search = searchResult[0];
    return search ? search.id : null;
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

  protected async generateStreams(
    kisskhId: number,
    content: ContentDetail,
    config: UserConfig,
  ): Promise<Stream[]> {
    const { episode } = content;
    const { episodeId } = await this._getEpisode(kisskhId, episode, config);
    const token = await this._getToken(episodeId, this.viGuid, config);
    const stream = await this._getStream(episodeId, token, config);
    if (!stream) return [];
    if (!stream.Video) return [];
    const url = this._fixUrl(stream.Video);
    // Handle rate limit
    if (stream.Video.includes(RATE_LIMIT_DESCRIPTION))
      throw new RateLimitError(content.title);
    return this.buildStream(kisskhId, url, content, config);
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

  private async _getShows(
    title: string,
    year?: number,
    season?: number,
    isFilter: boolean = true,
    config?: UserConfig,
  ): Promise<SearchResult[]> {
    const url = `${this.getSearchUrl(config)}${encodeURIComponent(title)}&type=0`;
    this.logger.log(`GET search | ${url}`);
    const searchData = await kisskhFailover.get<SearchResult[]>(url);
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
    const episodesData = await kisskhFailover.get<KisskhDetail>(url, {
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
      kisskhFailover.markSuccess(url);
      return stream;
    } catch (error) {
      if (error instanceof RateLimitError) {
        kisskhFailover.markFail(url);
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
    const subtitleDatas = await kisskhFailover.get<SubResponse[]>(subtitleUrl);
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
