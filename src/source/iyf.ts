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
import { Prefix, UserConfig } from "../utils/config.js";
import { MirrorFailover } from "../service/mirror-failover.js";
import ProviderService from "../service/provider/provider-service.js";
import {
  IYF_DEFAULT_MIRRORS,
  MIRROR_FAIL_TTL_MS,
} from "../utils/constant.js";
import { IyfDetailError } from "../utils/error.js";
import { safeYear } from "../utils/format.js";
import { Logger } from "../utils/logger.js";
import { getIyfQuery } from "./iyf-catalogs.js";
import { ContentDetail } from "./meta.js";
import { BaseProvider } from "./provider.js";
import { tmdb, tmdbLanguage } from "./tmdb.js";

/**
 * The API host family behind one mirror pick (plus any user-added family)
 * runs byte-identical APIs on the m10./rankv21./static. subdomains of its
 * domain. A pick may name the family root or any of its subdomains — the
 * prefix is stripped so every spelling derives one family.
 */
export interface IyfFamily {
  api: string;
  rank: string;
  image: string;
  site: string;
}

export function iyfFamily(mirror: string): IyfFamily | null {
  try {
    const url = new URL(mirror);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname
      .toLowerCase()
      .replace(/^(m10|rankv21|static|www)\./, "");
    return {
      api: `https://m10.${host}`,
      rank: `https://rankv21.${host}`,
      image: `https://static.${host}`,
      site: `https://www.${host}/`,
    };
  } catch {
    return null;
  }
}

/**
 * The private-key alphabet the site bundle ships for its fallback signing
 * mode (no cert): vv = md5(pub + "&" + lowercaseDecodedQuery + "&" +
 * privateKey[pub % length]), pub = the client timestamp sent alongside.
 * Recovered from the site bundle; verified against the live API.
 */
export const IYF_PRIVATE_KEYS = [
  "version001",
  "vers1on001",
  "vers1on00i",
  "bersion001",
  "vcrsion001",
  "versi0n001",
  "versio_001",
  "version0o1",
] as const;

const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

/**
 * The site signs the query with every value percent-DECODED (its get_query
 * decodeURIComponent's each value, folding "+" to space) and lowercased.
 * Signing the encoded form — or the raw form with uppercase passes — fails
 * with 用户签名错误 on any non-ASCII value (region/year names are Chinese).
 */
export function decodeQueryValues(query: string): string {
  return query
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1).replace(/\+/g, " ");
      let decoded = value;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        // Keep the raw value; the upstream sees exactly what we signed
      }
      return `${key}=${decoded}`;
    })
    .join("&");
}

/** The `vv`/`pub` pair for a query under a fixed pub — pinned by a
 * live-accepted signature in iyf.test.ts. */
export function iyfSignature(query: string, pub: string): string {
  const key = IYF_PRIVATE_KEYS[Number(pub) % IYF_PRIVATE_KEYS.length];
  const vv = md5(`${pub}&${decodeQueryValues(query).toLowerCase()}&${key}`);
  return `vv=${vv}&pub=${pub}`;
}

// Bucket the signature timestamp so identical logical requests share one
// axiosGet cache entry for the bucket's lifetime instead of busting the url
// cache on every call (the upstream accepts any self-consistent pub)
const VV_BUCKET_MS = 10 * 60 * 1000;

function currentSignature(query: string): string {
  const pub = (Math.floor(Date.now() / VV_BUCKET_MS) * VV_BUCKET_MS).toString();
  return iyfSignature(query, pub);
}

// iyf API rows: catalog list, briefsearch hits and the detail info share the
// shape; the alphanumeric `key` is the stable external id (rows carry no
// numeric id, and detail/episodes/play all accept the key).
interface IyfItem {
  key?: string;
  title: string;
  image?: string;
  imgPath?: string;
  contxt?: string;
  year?: number;
  score?: string;
  lastName?: string;
  regional?: string;
  language?: string;
  atypeName?: string;
  cid?: string;
  post_Year?: string;
  directors?: string[];
  stars?: string[];
}
interface ListData {
  recordcount?: number;
  result: IyfItem[] | null;
}
interface IyfEpisode {
  id: number;
  key: string;
  name: string;
  isVip: boolean;
}
interface PlaylistGroup {
  playList: IyfEpisode[] | null;
}
interface FlvPath {
  isHls: boolean;
  result?: string | null;
}
interface PlayInfo {
  uniqueKey?: string;
  needLogin?: number;
  flvPathList: FlvPath[] | null;
}
interface ApiResponse<T> {
  data: { code: number; msg?: string; info: T } | null;
}

// Rows that must never surface: the adult trees live outside the section
// cids, but briefsearch spans them — its shelf names gate what passes.
const MOVIE_SHELVES = new Set(["电影"]);
const SERIES_SHELVES = new Set(["电视剧", "综艺", "动漫", "短剧", "纪录片"]);

function isPlayable(item: IyfItem, type: ContentType): boolean {
  const shelf = item.atypeName ?? "";
  return type === "movie" ? MOVIE_SHELVES.has(shelf) : SERIES_SHELVES.has(shelf);
}

// Shared mirror memory: every iyf request feeds the same origin metrics.
// The last-resort fallback degrades to "" when no family is deployed
// (IYF_HOSTS unset) — request building fails and the warning says why.
if (IYF_DEFAULT_MIRRORS.length === 0) {
  new Logger("IYF").warn("No host families configured | set IYF_HOSTS in .env");
}
const iyfFailover = new MirrorFailover(
  MIRROR_FAIL_TTL_MS,
  IYF_DEFAULT_MIRRORS[0] ?? "",
);

export class IyfScraper extends BaseProvider {
  readonly defaultMirrors = IYF_DEFAULT_MIRRORS;
  readonly failover = iyfFailover;
  readonly supportedPrefix: Prefix[] = [
    Prefix.IMDB,
    Prefix.TMDB,
    Prefix.IYF,
  ];
  private readonly pageSize = 16;

  protected providerIdField = "iyfId" as const;

  /**
   * iyf's signed m3u8 carries its playback credential in the query
   * (vendtime/vhash) — the db replay row must keep the full url.
   */
  protected override dbStreamUrl(url: string): string {
    return url;
  }

  getFamily(config?: UserConfig): IyfFamily | null {
    return iyfFamily(iyfFailover.select(this.mirrors(config)));
  }

  imageUrl(path: string | undefined, config?: UserConfig): string {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    const image = this.getFamily(config)?.image;
    return image ? `${image}/${path.replace(/^\//, "")}` : path;
  }

  /**
   * GET a signed API path on the selected family's m10 host. Non-zero
   * envelopes resolve to null so mirror failover sees the failure.
   */
  private async getApi<T>(
    path: string,
    query: string,
    config?: UserConfig,
  ): Promise<T | null> {
    const family = this.getFamily(config);
    if (!family) {
      this.logger.warn(`No host family for request | ${path}`);
      return null;
    }
    const url = `${family.api}${path}?${query}&${currentSignature(query)}`;
    const payload = await iyfFailover.get<ApiResponse<T>>(url, {
      headers: {
        ...this.headers,
        Referer: family.site,
        Origin: family.site,
      },
    });
    if (!payload?.data || payload.data.code !== 0) {
      this.logger.warn(
        `API error | ${path} ${payload?.data?.msg ?? "no data"}`,
      );
      return null;
    }
    return payload.data.info;
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
        this.toPreview(
          { id: item.key },
          item.title,
          type,
          this.imageUrl(item.image ?? item.imgPath, config),
        ),
      ),
    );
  }

  /**
   * Fetch an Explore category (type, region, year, quality or sort). The
   * catalog name resolves to a single upstream query, see iyf-catalogs.
   */
  async getCatalog(
    args: CatalogHandlerArgs,
    config: UserConfig,
  ): Promise<MetaPreview[]> {
    const { id, type, extra } = args;
    const [, , name] = id.split(".");
    const query = getIyfQuery(name ?? "", type === "movie" ? "movie" : "series");
    if (!query) {
      // Search catalogs resolve through searchCatalog, not here
      return [];
    }
    const page = this.getPage(this.pageSize, extra.skip);
    // api/list/Search — the same endpoint powers the site's browse shelves;
    // the trailing -1 flags leave every optional filter at "all"
    const qs =
      `cinema=1&page=${page}&size=${this.pageSize}&orderby=${query.orderby}&desc=1&cid=${query.cid}` +
      (query.region ? `&region=${encodeURIComponent(query.region)}` : "") +
      (query.year ? `&year=${encodeURIComponent(query.year)}` : "") +
      (query.quality ? `&vipResource=${encodeURIComponent(query.quality)}` : "") +
      `&isserial=-1&isIndex=-1&isfree=-1&isVertical=-1&v=1`;
    this.logger.log(`GET catalog | ${qs}`);
    const data = await this.getApi<ListData[]>("/api/list/Search", qs, config);
    const items = (data ?? []).flatMap((group) => group.result ?? []);
    return Promise.all(
      items
        .filter((item): item is IyfItem & { key: string } => !!item.key)
        .map((item) =>
          this.toPreview({ id: item.key }, item.title, type, this.imageUrl(item.image, config)),
        ),
    );
  }

  async getMeta(
    content: ContentDetail,
    type: ContentType,
    config?: UserConfig,
  ): Promise<MetaDetail | null> {
    const key = content.iyfId ?? content.id;
    const detail = await this.getDetail(key, config);
    const poster = this.imageUrl(detail.imgPath, config);
    let year = safeYear(detail.post_Year);
    let date = new Date().toISOString();
    // TMDB text localizes to the config language (matching stays English,
    // see searchContent)
    const tmdbDetail = await tmdb.searchDetail(
      detail.title,
      type,
      undefined,
      tmdbLanguage(config),
    );
    const background = tmdbDetail?.background || poster;
    const metaId = `${Prefix.IYF}:${detail.key}`;
    const description = tmdbDetail?.overview || detail.contxt || "";
    ({ year, date } = this.tmdbReleaseDate(year, date, tmdbDetail));
    const episodes = await this.episodesOf(detail, config);
    const season = 1;
    const videos: MetaVideo[] = episodes.map((episode, index) => ({
      id: `iyf:${detail.key}:${season}:${index + 1}`,
      released: date,
      title: detail.title,
      type: type,
      description: description,
      thumbnail: poster,
      background: background,
      season: season,
      episode: index + 1,
    }));
    // Persist the mapping (linked when TMDB matched, unlinked otherwise) so
    // the next catalog/meta pass resolves from the DB
    await ProviderService.persistContentMapping(
      tmdbDetail,
      this.name,
      detail.key,
      detail.title,
      { year: year },
    );
    const meta: MetaDetail = {
      id: metaId,
      name: detail.title,
      logo: tmdbDetail?.logo ?? "",
      poster: poster,
      background: background,
      type: type,
      description: description,
      released: date,
      videos: videos,
    };
    if (detail.regional) meta.country = detail.regional;
    return meta;
  }

  /**
   * The stream target: the content's iyf video key when present, else a
   * title search against the rank host.
   */
  protected async resolveStreamTarget(
    content: ContentDetail,
    config: UserConfig,
  ): Promise<string | null> {
    const { title, type, iyfId } = content;
    if (iyfId) return iyfId;
    const searchResult = await this.searchContent(title, type, config);
    const search = searchResult[0];
    return search ? search.key : null;
  }

  /**
   * Free-tier episodes, in upstream order (isVip entries need a paid
   * account — ignored, mirroring ole's vip-row policy).
   */
  private async episodesOf(detail: IyfItem, config?: UserConfig) {
    const qs = `cinema=1&vid=${detail.key}&lsk=1&taxis=0&cid=${encodeURIComponent(detail.cid ?? "")}&v=1`;
    const groups = await this.getApi<PlaylistGroup[]>(
      "/v3/video/languagesplaylist",
      qs,
      config,
    );
    return (groups ?? [])
      .flatMap((group) => group.playList ?? [])
      .filter((episode) => !episode.isVip && !!episode.key);
  }

  /**
   * The playable HLS url for one episode: v3/video/play takes the EPISODE
   * key and answers with signed CDN paths — one front-ad mp4 plus the real
   * chunklist, told apart by isHls.
   */
  private async playUrl(episodeKey: string, config?: UserConfig) {
    const qs = `cinema=1&id=${episodeKey}&a=0&lang=none&usersign=1&device=1&isMasterSupport=1&v=1`;
    const info = await this.getApi<PlayInfo[]>("/v3/video/play", qs, config);
    const hls = (info?.[0]?.flvPathList ?? []).find(
      (path) => path.isHls && /\.m3u8/i.test(path.result ?? ""),
    );
    return hls?.result ?? null;
  }

  protected async generateStreams(
    extId: string,
    content: ContentDetail,
    config: UserConfig,
  ): Promise<Stream[]> {
    const { episode } = content;
    const detail = await this.getDetail(extId, config);
    const episodes = await this.episodesOf(detail, config);
    // Episodes are the playlist order, 1-based; when the number is out of
    // range (season packs, re-numbered shows) fall back to the last episode
    const target =
      episodes.find((_, index) => index === (episode ?? 1) - 1) ??
      episodes[episodes.length - 1];
    if (!target) return [];
    const url = await this.playUrl(target.key, config);
    if (!url) return [];
    return this.buildStream(extId, url, content, config);
  }

  /**
   * iyf hardcodes its subtitles into the video stream — there are no
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
  ): Promise<(IyfItem & { key: string })[]> {
    const family = this.getFamily(config);
    if (!family) {
      this.logger.warn("No host family for search");
      return [];
    }
    // rankv21's briefsearch carries no signature
    const qs = `cinema=1&tags=${encodeURIComponent(title)}&orderby=4&page=1&size=${this.pageSize}&desc=1&isserial=-1&v=1`;
    this.logger.log(`GET search | ${qs}`);
    const payload = await iyfFailover.get<ApiResponse<ListData[]>>(
      `${family.rank}/v3/list/briefsearch?${qs}`,
      { headers: { ...this.headers, Referer: family.site, Origin: family.site } },
    );
    const items = (payload?.data?.info ?? []).flatMap(
      (group) => group.result ?? [],
    );
    // 电影 is the only movie-side shelf; series takes the drama/anime/…
    // shelves and everything else (site uploads, news) is dropped.
    // briefsearch rows carry no key field — the video key rides in `contxt`
    // (a description field elsewhere), so it is lifted before use.
    return items
      .filter((item) => isPlayable(item, type))
      .flatMap((item) => {
        const key = item.key ?? (/^[A-Za-z0-9]+$/.test(item.contxt ?? "") ? item.contxt : undefined);
        return key ? [{ ...item, key }] : [];
      });
  }

  public async getDetail(
    key: string,
    config?: UserConfig,
  ): Promise<IyfItem & { key: string }> {
    // key lands inside the query: only the site's alphanumeric id alphabet
    // may pass
    if (!/^[A-Za-z0-9]+$/.test(key)) {
      throw new IyfDetailError(`Invalid iyf key | ${key}`);
    }
    const qs = `cinema=1&device=1&player=CkPlayer&tech=HLS&country=US&lang=cns&v=1&id=${key}`;
    this.logger.log(`GET detail | ${qs}`);
    const info = await this.getApi<IyfItem[]>("/v3/video/detail", qs, config);
    const detail = info?.[0];
    if (detail?.key) return detail as IyfItem & { key: string };
    throw new IyfDetailError(`Not found detail from key | ${key}`);
  }
}
