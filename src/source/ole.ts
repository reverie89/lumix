import {
  CatalogHandlerArgs,
  ContentType,
  MetaDetail,
  MetaPreview,
  MetaVideo,
  Stream,
  Subtitle,
} from "@stremio-addon/sdk";
import crypto from "node:crypto";
import { uuidv7 } from "uuidv7";
import {
  getContentByTmdb,
  getProviderContentById,
  upsertContent,
  upsertProviderContent,
  upsertStream,
} from "../db/queries.js";
import { Prefix, UserConfig } from "../lib/manifest.js";
import { MirrorFailover } from "../service/mirror-failover.js";
import ProviderService from "../service/provider/provider-service.js";
import StreamService from "../service/resource/stream-service.js";
import { axiosGet } from "../utils/axios.js";
import { cache, TTL_MS } from "../utils/cache.js";
import {
  MIRROR_FAIL_TTL_MS,
  OLE_DEFAULT_MIRRORS,
  RATE_LIMIT_DESCRIPTION,
} from "../utils/constant.js";
import { handleError, OleDetailError, RateLimitError } from "../utils/error.js";
import { cleanUrl, formatStreamFilename, formatStreamTitle } from "../utils/format.js";
import { matchTitle } from "../utils/fuse.js";
import { Logger } from "../utils/logger.js";
import { getOleQuery } from "./ole-catalogs.js";
import { ContentDetail } from "./meta.js";
import { BaseProvider } from "./provider.js";
import { tmdb, isTmdbEnabled, tmdbLanguage } from "./tmdb.js";

// pic/picThumb come back site-relative ("upload/vod/...jpg"); the static
// host serves the same paths cross-origin. The site URL is the Referer the
// API requires — a functional upstream constant, not a mirror pick.
const OLE_IMAGE_BASE = "https://static.olelive.com";
const OLE_SITE_URL = "https://www.olevod.com/";

// ole list rows (also the shape of search hits)
interface VodItem {
  id: number;
  typeId1: number;
  name: string;
  pic: string;
  picThumb?: string;
  remarks?: string;
  score?: number;
  vip: boolean;
}
interface VodListData {
  list: VodItem[] | null;
  total: number;
}
interface VodEpisodeUrl {
  index: number;
  title: string;
  url: string;
  vip: boolean;
}
interface VodDetailData extends VodItem {
  actor?: string;
  director?: string;
  blurb?: string;
  content?: string;
  area?: string;
  lang?: string;
  year?: string;
  urls: VodEpisodeUrl[] | null;
}
interface SearchData {
  total: number;
  // One group per content type; empty groups arrive as list: null
  data: { type: string; list: VodItem[] | null; total: number }[] | null;
}
interface ApiResponse<T> {
  code: number;
  data: T;
  msg?: string;
}

// Shared mirror memory: every ole request feeds the same origin metrics.
// The last-resort fallback degrades to "" when no host is deployed
// (OLE_HOSTS unset) — request building fails and the warning says why.
if (OLE_DEFAULT_MIRRORS.length === 0) {
  new Logger("OLE").warn("No hosts configured | set OLE_HOSTS in .env");
}
const oleFailover = new MirrorFailover(
  MIRROR_FAIL_TTL_MS,
  OLE_DEFAULT_MIRRORS[0] ?? "",
);

/**
 * The `_vv` request signature every ole API call carries: the timestamp
 * string is split bit-wise into four hex chunks interleave-embedded into its
 * md5 digest. Recovered from the site bundle; the API accepts a timestamp
 * within ~30 minutes of now.
 */
export function vvParam(timestampSeconds: string): string {
  const digest = (s: string) =>
    crypto.createHash("md5").update(s).digest("hex");
  const bits = ["", "", "", ""];
  for (const char of timestampSeconds) {
    const binary = char.charCodeAt(0).toString(2);
    bits[0] += binary.slice(2, 3);
    bits[1] += binary.slice(3, 4);
    bits[2] += binary.slice(4, 5);
    bits[3] += binary.slice(5);
  }
  const mixed = bits.map(
    (chunk) => (parseInt(chunk, 2).toString(16) || "000").padStart(3, "0"),
  );
  const md5 = digest(timestampSeconds);
  return (
    md5.slice(0, 3) +
    mixed[0] +
    md5.slice(6, 11) +
    mixed[1] +
    md5.slice(14, 19) +
    mixed[2] +
    md5.slice(22, 27) +
    mixed[3] +
    md5.slice(30)
  );
}

// Bucket the signature timestamp so identical logical requests share one
// axiosGet cache entry for the bucket's lifetime instead of busting the url
// cache on every call (a fresh bucket url simply re-fetches)
const VV_BUCKET_SECS = 10 * 60;

function currentVv(): string {
  const bucket = Math.floor(Date.now() / 1000 / VV_BUCKET_SECS) * VV_BUCKET_SECS;
  return vvParam(bucket.toString());
}

/**
 * Rows that must never surface as playable content: VIP蓝光影院 items
 * (typeId1 6, or the vip flag) carry no free stream url — playback needs a
 * paid account — and 午夜影院 (typeId1 5) is the adult shelf. Filtered
 * wherever these rows appear.
 */
function isPlayable(item: VodItem): boolean {
  return !item.vip && item.typeId1 !== 5 && item.typeId1 !== 6;
}

export class OleScraper extends BaseProvider {
  readonly defaultMirrors = OLE_DEFAULT_MIRRORS;
  readonly failover = oleFailover;
  readonly supportedPrefix: Prefix[] = [
    Prefix.IMDB,
    Prefix.TMDB,
    Prefix.OLE,
  ];
  private readonly pageSize = 16;

  getBaseUrl(config?: UserConfig) {
    return oleFailover.select(this.mirrors(config));
  }

  imageUrl(path?: string): string {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    return `${OLE_IMAGE_BASE}/${path.replace(/^\//, "")}`;
  }

  /**
   * GET an API path on the selected mirror with the `_vv` signature.
   * Non-zero envelopes (and the 401 用户签名错误 body, which axios turns
   * into a null result) resolve to null so mirror failover sees the failure.
   */
  private async getApi<T>(
    path: string,
    config?: UserConfig,
  ): Promise<T | null> {
    const url = `${this.getBaseUrl(config)}${path}?_vv=${currentVv()}`;
    const payload = await oleFailover.get<ApiResponse<T>>(url, {
      headers: { ...this.headers, Referer: OLE_SITE_URL },
    });
    if (!payload || payload.code !== 0) {
      this.logger.warn(`API error | ${path} ${payload?.msg ?? "no data"}`);
      return null;
    }
    return payload.data;
  }

  async searchCatalog(
    args: CatalogHandlerArgs,
    config: UserConfig,
  ): Promise<MetaPreview[]> {
    const { type, extra } = args;
    const search = extra.search;
    this.logger.log(`Search | ${search}`);
    if (!search) return [];
    const results = await this.searchContent(search, type, config);
    return Promise.all(
      results.slice(0, this.pageSize).map((item) =>
        this.toPreview(item, type),
      ),
    );
  }

  /**
   * Fetch an Explore category (type, region or sort). The catalog name
   * resolves to a single upstream query, see ole-catalogs.
   */
  async getCatalog(
    args: CatalogHandlerArgs,
    config: UserConfig,
  ): Promise<MetaPreview[]> {
    const { id, type, extra } = args;
    const [, , name] = id.split(".");
    const query = getOleQuery(name ?? "", type === "movie" ? "movie" : "series");
    if (!query) {
      // Search catalogs resolve through searchCatalog, not here
      return [];
    }
    const page = this.getPage(this.pageSize, extra.skip);
    // /v1/pub/vod/list/{cache}/{vip}/{letter}/{area}/{typeId1}/{typeId}/{?}/{sort}/{page}/{pageSize}
    // vip=3 is "all" — playability is filtered client-side (isPlayable)
    const path =
      `/v1/pub/vod/list/true/3/0/${encodeURIComponent(query.area)}/` +
      `${query.typeId1}/0/0/${query.update}/${page}/${this.pageSize}`;
    this.logger.log(`GET catalog | ${path}`);
    const data = await this.getApi<VodListData>(path, config);
    const items = (data?.list ?? []).filter(isPlayable);
    return Promise.all(items.map((item) => this.toPreview(item, type)));
  }

  async getMeta(
    content: ContentDetail,
    type: ContentType,
    config?: UserConfig,
  ): Promise<MetaDetail | null> {
    const detail = await this.getDetail(content.id, config);
    const poster = this.imageUrl(detail.picThumb || detail.pic);
    // Upstream year is a string ("2026") and may be missing
    const parsedYear = parseInt(detail.year ?? "");
    const fallbackDate = new Date();
    let year = Number.isFinite(parsedYear) ? parsedYear : fallbackDate.getFullYear();
    let date = fallbackDate.toISOString();
    // TMDB text localizes to the config language (matching stays English,
    // see searchDetail)
    const tmdbDetail = isTmdbEnabled()
      ? await tmdb.searchDetail(
          detail.name,
          type,
          undefined,
          tmdbLanguage(config),
        )
      : null;
    const background = tmdbDetail?.background || poster;
    const metaId = `${Prefix.OLE}:${detail.id}`;
    const description = tmdbDetail?.overview || detail.content || detail.blurb || "";
    if (tmdbDetail) {
      if (Number.isFinite(tmdbDetail.year) && tmdbDetail.year > 0) {
        year = tmdbDetail.year;
        const tmdbDate = new Date();
        tmdbDate.setFullYear(tmdbDetail.year);
        date = tmdbDate.toISOString();
      }
      const oldContent = await getContentByTmdb(
        tmdbDetail.id,
        type === "movie" ? "movie" : "series",
      );
      if (oldContent) {
        upsertContent(oldContent.id, tmdbDetail);
        // Persist the TMDB linkage so the next catalog render resolves its
        // art from the DB (resolveProviderPoster)
        upsertProviderContent({
          id: metaId,
          contentId: oldContent.id,
          title: detail.name,
          provider: this.name,
          externalId: detail.id.toString(),
          year: year,
        });
      }
    }
    const season = 1;
    const videos: MetaVideo[] = this.freeEpisodes(detail).map((episodeUrl) => ({
      id: `ole:${detail.id}:${season}:${episodeUrl.index}`,
      released: date,
      title: detail.name,
      type: type,
      description: description,
      thumbnail: poster,
      background: background,
      season: season,
      episode: episodeUrl.index,
    }));
    const existingContent = await getProviderContentById(metaId);
    if (!existingContent?.contentId) {
      upsertProviderContent({
        id: metaId,
        contentId: null,
        title: detail.name,
        provider: this.name,
        externalId: detail.id.toString(),
        year: year,
      });
    }
    const meta: MetaDetail = {
      id: metaId,
      name: detail.name,
      logo: tmdbDetail?.logo ?? "",
      poster: poster,
      background: background,
      type: type,
      description: description,
      released: date,
      videos: videos,
    };
    if (detail.area) meta.country = detail.area;
    return meta;
  }

  async getStreams(
    content: ContentDetail,
    config: UserConfig,
  ): Promise<Stream[]> {
    this.logger.log(`Stream | ${content.title} ${content.id}`);
    const { title, type, year, season, episode, id, oleId } = content;
    try {
      const streamKey = `streams:${type}:${this.name}:${id}:${season}:${episode}`;
      const cacheStreams = cache.get(streamKey);
      if (cacheStreams) return cacheStreams;
      const dbStreams = await StreamService.getDbStreams(
        `${this.name}:${oleId}`,
        1,
        episode ?? 1,
        this.displayName,
      );
      if (dbStreams.length > 0) {
        cache.set(streamKey, dbStreams, TTL_MS.stream);
        return dbStreams;
      }
      let vodId = parseInt(oleId ?? "0");
      let streamTitle = title;
      if (!vodId) {
        const searchResult = await this.searchContent(title, type, config);
        if (!searchResult[0]) {
          this.logger.log("No results");
          return [];
        }
        vodId = searchResult[0].id;
        streamTitle = searchResult[0].name;
      }
      const streams = await this.generateStreams(vodId, streamTitle, content, config);
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

  /**
   * ole hardcodes its subtitles into the video stream — there are no
   * external tracks to serve.
   */
  async getSubtitles(
    content: ContentDetail,
    config?: UserConfig,
  ): Promise<Subtitle[]> {
    return [];
  }

  async searchContent(
    title: string,
    type: ContentType,
    config?: UserConfig,
  ): Promise<VodItem[]> {
    // /v1/pub/index/search/{q}/vod/{typeId}/{page}/{pageSize}
    const path = `/v1/pub/index/search/${encodeURIComponent(title)}/vod/0/1/${this.pageSize}`;
    this.logger.log(`GET search | ${path}`);
    const data = await this.getApi<SearchData>(path, config);
    const items = (data?.data ?? []).flatMap((group) => group.list ?? []);
    // typeId1 1 (Movies) is the only movie-side shelf; series takes the rest
    return items.filter(
      (item) =>
        isPlayable(item) &&
        (type === "movie" ? item.typeId1 === 1 : item.typeId1 !== 1),
    );
  }

  public async getDetail(
    vodId: string,
    config?: UserConfig,
  ): Promise<VodDetailData> {
    // vodId lands inside the api path: only plain numbers may pass
    if (!/^\d+$/.test(vodId)) {
      throw new OleDetailError(`Invalid ole id | ${vodId}`);
    }
    // withUrls=true: the detail carries every episode's stream url
    const path = `/v1/pub/vod/detail/${vodId}/true`;
    this.logger.log(`GET detail | ${path}`);
    const detail = await this.getApi<VodDetailData>(path, config);
    if (detail) return detail;
    throw new OleDetailError(`Not found detail from id | ${vodId}`);
  }

  /**
   * Free-tier episode urls, in upstream order. vip_urls mirror the same
   * streams for paying users — ignored.
   */
  private freeEpisodes(detail: VodDetailData): VodEpisodeUrl[] {
    return (detail.urls ?? []).filter(
      (episodeUrl) => !episodeUrl.vip && !!episodeUrl.url,
    );
  }

  private async generateStreams(
    vodId: number,
    title: string,
    content: ContentDetail,
    config: UserConfig,
  ): Promise<Stream[]> {
    const { episode, season, year, type } = content;
    const detail = await this.getDetail(vodId.toString(), config);
    const episodes = this.freeEpisodes(detail);
    // Episodes are 1-based via urls[].index; when the number is out of
    // range (season packs, re-numbered shows) fall back to the last episode
    const episodeUrl =
      episodes.find((candidate) => candidate.index === (episode ?? 1)) ??
      episodes[episodes.length - 1];
    if (!episodeUrl) return [];
    const url = episodeUrl.url;
    // Persistence only — the stream below doesn't need it, so don't block
    // the response on the TMDB round-trip
    ProviderService.syncContentAndProvider(
      content,
      vodId.toString(),
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
        providerContentId: `${this.name}:${vodId}`,
        provider: this.name,
        externalId: vodId.toString(),
        season: "1",
        episode: episode?.toString() ?? "1",
        url: cleanUrl(url),
        ttl: TTL_MS.stream,
      },
    ]);
    return streamDatas;
  }

  private async toPreview(
    item: VodItem,
    type: ContentType,
  ): Promise<MetaPreview> {
    const id = `${Prefix.OLE}:${item.id}`;
    const poster = this.imageUrl(item.picThumb || item.pic);
    const { poster: resolved } = await ProviderService.resolveProviderPoster(
      this.name,
      item.id,
      item.name,
      poster,
      type,
    );
    const metaDetail: MetaDetail = {
      id: id,
      name: item.name,
      type: type,
      background: resolved,
      poster: resolved,
    };
    if (type === "movie") {
      metaDetail.behaviorHints = {
        defaultVideoId: `${id}:1:1`,
      };
      return metaDetail;
    }
    return metaDetail;
  }
}
