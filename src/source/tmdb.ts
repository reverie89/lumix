import { ContentType } from "@stremio-addon/sdk";
import { AxiosRequestConfig } from "axios";
import { URLSearchParams } from "url";
import { uuidv7 } from "uuidv7";
import { getSearchMiss, upsertSearchMiss } from "../db/queries.js";
import { axiosGet } from "../utils/axios.js";
import { TTL_MS } from "../utils/cache.js";
import { USER_AGENT } from "../utils/constant.js";
import { ENV } from "../utils/env.js";
import { handleError, FuseError, MatchingError, TmdbError } from "../utils/error.js";
import { extractTitle, safeYear } from "../utils/format.js";
import { bestMatch, matchTitle } from "../utils/fuse.js";
import { Logger } from "../utils/logger.js";
import { getProxyUrl } from "../utils/proxy/proxy.js";
import { ContentDetail } from "./meta.js";

export interface TmdbFindResponse {
  movie_results: TmdbMovieResult[];
  person_results: any[];
  tv_results: TmdbTvResult[];
  tv_episode_results: any[];
  tv_season_results: any[];
}

export interface TmdbMovieImagesExternalId extends TmdbMovieResult {
  images?: TmdbTvImages;
  external_ids?: TmdbExternalID;
}
export interface TmdbTvImagesExternalId extends TmdbTvResult {
  images?: TmdbTvImages;
  external_ids?: TmdbExternalID;
}

export interface TmdbTvResult {
  id: number;
  imdb_id?: string;
  name: string;
  original_name: string;
  overview: string;
  // Empty string for unreleased titles, null when the field is absent
  first_air_date: string | null;
  poster_path: string | null;
  backdrop_path?: string | null;
}
export interface TmdbTvImages {
  backdrops: TmdbTvImage[];
  logos: TmdbTvImage[];
  posters: TmdbTvImage[];
}
interface TmdbTvImage {
  aspect_ratio: number;
  height: number;
  iso_3166_1: string;
  iso_639_1: string;
  file_path: string;
  vote_average: number;
  vote_count: number;
  width: number;
}

interface TmdbExternalID {
  id: number;
  imdb_id: string | null;
  freebase_mid: string | null;
  freebase_id: string | null;
  tvrage_id: number | null;
  wikidata_id: string | null;
  facebook_id: string | null;
  instagram_id: string | null;
  twitter_id: string | null;
}

export interface TmdbMovieResult {
  id: number;
  imdb_id?: string;
  title: string;
  original_title: string;
  overview: string;
  release_date: string | null;
  poster_path: string | null;
  backdrop_path?: string | null;
}

interface TmdbMovieSearch {
  results: TmdbMovieResult[];
}
interface TmdbTvSearch {
  results: TmdbTvResult[];
}
const TMDB_HOST = "api.tmdb.org";

/**
 * True when the server has a TMDB key. Call sites check this before doing
 * any TMDB work so an unset key skips the feature entirely.
 */
export const isTmdbEnabled = () => !!ENV.TMDB_API_KEY;

// Display language for localized detail fetches. Exact BCP-47 casing —
// TMDB silently serves English for a lowercase "zh-cn".
export type TmdbLanguage = "zh-CN" | undefined;

/**
 * Config language → TMDB request language. Undefined means English: the
 * request then omits the `language` param entirely, so English and
 * localized requests land in separate axiosGet cache entries.
 */
export function tmdbLanguage(config?: { language?: string }): TmdbLanguage {
  return config?.language === "zh" ? "zh-CN" : undefined;
}

// Localized detail requests must still see English art: TMDB filters the
// appended images to the request language unless include_image_language
// says otherwise (raw commas — URLSearchParams would percent-encode them).
const imageLanguageParams = (language?: TmdbLanguage) =>
  language ? "&include_image_language=zh,en,null" : "";

class TMDBService {
  private logger = new Logger("tmdb");
  private baseUrl: string = `https://${TMDB_HOST}/3`;
  private imageUrl: string = "https://image.tmdb.org";

  // TMDB serves images only at real file paths — a missing poster/backdrop
  // must degrade to undefined, never concatenate into a broken URL
  private image(
    path: string | null | undefined,
    size = "w500",
  ): string | undefined {
    return path ? `${this.imageUrl}/t/p/${size}${path}` : undefined;
  }

  // Search
  // The /search calls stay parameterless (English): result titles feed
  // matchTitle, and resolved titles later drive the providers' own search
  // (streams resolve by title) — a localized title would break both. Only
  // the final id-based detail fetch localizes.

  /**
   * The normalized search query every surface must share: base title,
   * season, and the year TMDB filters by (dropped for season > 1, where the
   * year belongs to the parent show). One normalization keeps all surfaces'
   * request URLs identical so the axios url-cache dedupes them.
   */
  private extractSearch(
    search: string,
    year?: number,
  ): { title: string; season: number; year: number | undefined } {
    const extracted = extractTitle(search);
    const season = extracted.season || 1;
    return {
      title: extracted.title,
      season,
      year: season == 1 ? extracted.year || year : undefined,
    };
  }

  async searchDetail(
    search: string,
    type: ContentType,
    year?: number,
    language?: TmdbLanguage,
  ): Promise<ContentDetail | null> {
    if (!isTmdbEnabled()) return null;
    const { title, season, year: searchYear } = this.extractSearch(search, year);
    year = searchYear;
    // Negative cache: the searchMiss table remembers titles TMDB failed to
    // match, so catalog re-renders (restarts included) skip them until the
    // miss expires instead of re-searching every one. matchTitle signals a
    // completed search that matched nothing by throwing FuseError or
    // MatchingError — only those failures count as a miss. Any other error
    // is a transient upstream failure and must stay retryable.
    const dbType = type === "movie" ? "movie" : "series";
    if (await getSearchMiss(title, dbType)) return null;
    try {
      const detail =
        type === "series"
          ? await this.searchSeriesDetail(title, year, language)
          : await this.searchMovieDetail(title, year, language);
      if (!detail) {
        await this.recordSearchMiss(title, dbType);
      }
      return detail;
    } catch (error: any) {
      if (!(error instanceof FuseError) && !(error instanceof MatchingError)) {
        handleError(error, this.logger, `Search ${dbType}`);
        return null;
      }
      await this.recordSearchMiss(title, dbType);
      return null;
    }
  }

  private async recordSearchMiss(title: string, dbType: "movie" | "series") {
    await upsertSearchMiss({
      id: uuidv7(),
      title: title,
      type: dbType,
      ttl: TTL_MS.miss,
    });
  }

  /**
   * Verify a title's content type: search both surfaces and trust the side
   * with the confident match — kisskh serves one mixed upstream list to its
   * Hollywood series and movie rows and otherwise guesses from episode
   * count. Null means TMDB is disabled or neither surface matched
   * confidently; callers keep their claimed type. Per-surface negative-cache
   * rows skip surfaces already known to have no match (see searchDetail).
   */
  async verifyType(search: string): Promise<"series" | "movie" | null> {
    if (!isTmdbEnabled()) return null;
    const { title, year } = this.extractSearch(search);
    const [seriesMissed, movieMissed] = await Promise.all([
      getSearchMiss(title, "series"),
      getSearchMiss(title, "movie"),
    ]);
    if (seriesMissed && movieMissed) return null;
    const surfaces: ("series" | "movie")[] = [];
    if (!seriesMissed) surfaces.push("series");
    if (!movieMissed) surfaces.push("movie");
    const matches = (
      await Promise.all(surfaces.map((type) => this.bestSurfaceMatch(title, year, type)))
    ).filter((match): match is NonNullable<typeof match> => match !== null);
    if (matches.length === 0) return null;
    // Fuse score is a distance (lower is better); the token ratio breaks
    // ties. A single match reduces to itself.
    const best = matches.reduce((a, b) =>
      a.fuseScore !== b.fuseScore
        ? a.fuseScore < b.fuseScore
          ? a
          : b
        : a.tokenScore >= b.tokenScore
          ? a
          : b,
    );
    return best.type;
  }

  /**
   * One surface's confidence: the best match's scores, or null when the
   * search matched nothing (FuseError/MatchingError — recorded as a miss) or
   * failed transiently (logged, left retryable — see searchDetail).
   */
  private async bestSurfaceMatch(
    title: string,
    year: number | undefined,
    type: "series" | "movie",
  ): Promise<{ type: "series" | "movie"; fuseScore: number; tokenScore: number } | null> {
    try {
      const candidates =
        type === "series"
          ? (await this.getSearchSeries(title, year)).results.map((result) =>
              this.toTvCandidate(result),
            )
          : this.getMovies((await this.getSearchMovie(title, year)).results);
      const match = bestMatch(candidates, title, year);
      return { type, fuseScore: match.fuseScore, tokenScore: match.tokenScore };
    } catch (error: any) {
      if (!(error instanceof FuseError) && !(error instanceof MatchingError)) {
        handleError(error, this.logger, `Verify ${type}`);
        return null;
      }
      await this.recordSearchMiss(title, type);
      return null;
    }
  }

  private toTvCandidate(result: TmdbTvResult): ContentDetail {
    const search: ContentDetail = {
      id: result.id.toString(),
      title: result.name,
      overview: result.overview,
      year: safeYear(result.first_air_date),
      type: "series",
      tmdbId: result.id,
    };
    const thumbnail = this.image(result.poster_path);
    if (thumbnail) search.thumbnail = thumbnail;
    return search;
  }

  private async searchSeriesDetail(
    title: string,
    year?: number,
    language?: TmdbLanguage,
  ): Promise<ContentDetail | null> {
    const response = await this.getSearchSeries(title, year);
    const titles = response.results.map((result) => this.toTvCandidate(result));
    const detail = matchTitle<ContentDetail>(titles, title, year);
    const tv = detail[0];
    if (tv) {
      this.logger.log(`Found | ${tv.title} ${tv.year} ${tv.imdbId || ""}`);
      return await this.getDetailById(tv.id, "series", language);
    }
    return null;
  }

  private async getSearchSeries(title: string, year?: number): Promise<TmdbTvSearch> {
    if (year) {
      const param = { query: title, year: year };
      return await this._getRequest(`/search/tv`, param);
    }
    return await this._getRequest(`/search/tv`, { query: title });
  }

  private async searchMovieDetail(
    title: string,
    year?: number,
    language?: TmdbLanguage,
  ): Promise<ContentDetail | null> {
    const movieResponse = await this.getSearchMovie(title, year);
    const results = this.getMovies(movieResponse.results);
    const movie = matchTitle(results, title, year)[0];
    if (movie) {
      this.logger.log(
        `Found | ${movie.title} ${movie.year} ${movie.imdbId || ""}`,
      );
      return await this.getDetailById(movie.id, "movie", language);
    }
    return null;
  }

  private async getSearchMovie(title: string, year?: number): Promise<TmdbMovieSearch> {
    if (year) {
      const param = { query: title, year: year };
      return await this._getRequest(`/search/movie`, param);
    }
    return await this._getRequest(`/search/movie`, { query: title });
  }

  // Find IMDB
  async findDetailImdb(
    imdbId: string,
    type: ContentType,
  ): Promise<ContentDetail | null> {
    if (type === "series") {
      return await this.findSeriesDetail(imdbId);
    } else {
      return await this.findMovieDetail(imdbId);
    }
  }

  private async findSeriesDetail(imdbId: string): Promise<ContentDetail | null> {
    try {
      const seriesResponse: TmdbFindResponse = await this._getRequest(
        "/find/" + imdbId,
        {
          external_source: "imdb_id",
        },
      );
      this.logger.debug(JSON.stringify(seriesResponse));
      const series = seriesResponse.tv_results[0];
      if (series) {
        const year = safeYear(series.first_air_date);
        return {
          id: imdbId,
          title: series.name,
          overview: series.overview,
          year: year,
          type: "series",
          tmdbId: series.id,
          imdbId: imdbId,
        };
      }

      return null;
    } catch (error: any) {
      handleError(error, this.logger, `Find series`);
      return null;
    }
  }

  private async findMovieDetail(imdbId: string): Promise<ContentDetail | null> {
    try {
      const movieResponse: TmdbFindResponse = await this._getRequest(
        "/find/" + imdbId,
        {
          external_source: "imdb_id",
        },
      );
      const movie = movieResponse.movie_results?.[0];

      if (movie) {
        return this.toDetail(movie);
      }

      return null;
    } catch (error: any) {
      handleError(error, this.logger, `Find movie`);
      return null;
    }
  }

  // Get TMDB
  // Id-based fetches degrade to null on error so callers fall back to
  // provider data; only searchDetail turns failures into negative cache
  async getDetailTmdb(
    tmdbId: string,
    type: ContentType,
    language?: TmdbLanguage,
  ): Promise<ContentDetail | null> {
    try {
      return await this.getDetailById(
        tmdbId,
        type === "series" ? "series" : "movie",
        language,
      );
    } catch (error: any) {
      handleError(error, this.logger, `Get ${type} details error`);
      return null;
    }
  }

  private getMovies(movies: TmdbMovieResult[]) {
    return movies.map((movie) => {
      return this.toDetail(movie);
    });
  }

  private toDetail(movie: TmdbMovieResult): ContentDetail {
    const year = safeYear(movie.release_date);
    const thumbnail = this.image(movie.poster_path);
    const background = this.image(movie.backdrop_path);
    const content: ContentDetail = {
      id: movie.id.toString(),
      title: movie.title,
      overview: movie.overview,
      year: year,
      type: "movie",
      tmdbId: movie.id,
    };
    if (thumbnail) content.thumbnail = thumbnail;
    if (background) content.background = background;
    if (movie.imdb_id) content.imdbId = movie.imdb_id;
    return content;
  }

  /**
   * Id-based detail with images + external ids appended. The movie/tv
   * surfaces differ only in field names (name/first_air_date vs title/
   * release_date) — one builder serves both; movies additionally carry a
   * top-level imdb_id.
   */
  private async getDetailById(
    tmdbId: string,
    type: "movie" | "series",
    language?: TmdbLanguage,
  ): Promise<ContentDetail | null> {
    this.logger.debug(`ID ${tmdbId}`);
    const segment = type === "series" ? "tv" : "movie";
    const raw = await this._getRequest<
      TmdbMovieImagesExternalId | TmdbTvImagesExternalId
    >(
      `/${segment}/${tmdbId}?append_to_response=images,external_ids${imageLanguageParams(language)}`,
      {},
      language,
    );
    if (!raw) return null;
    const title = "name" in raw ? raw.name : raw.title;
    const date = "first_air_date" in raw ? raw.first_air_date : raw.release_date;
    const imdb = raw.external_ids?.imdb_id ?? raw.imdb_id;
    const year = safeYear(date);
    const thumbnail = this.image(raw.poster_path);
    const content: ContentDetail = {
      id: raw.id.toString(),
      title,
      overview: raw.overview,
      year,
      type,
      tmdbId: raw.id,
    };
    if (thumbnail) content.thumbnail = thumbnail;
    if (imdb) content.imdbId = imdb;
    const { logo, background } = this.extractLogoAndBackground(
      raw.images,
      language,
    );
    if (logo) content.logo = logo;
    if (background) content.background = background;
    return content;
  }

  extractLogoAndBackground(
    images?: TmdbTvImages,
    language?: TmdbLanguage,
  ) {
    if (!images) return { logo: "", background: "" };
    // Image iso_639_1 values are bare 639-1 codes ("zh"), not BCP-47
    const preferred = language === "zh-CN" ? "zh" : "en";
    const byLang = (imgs: TmdbTvImage[], lang: string) =>
      imgs.find((img: any) => img.iso_639_1 === lang)?.file_path;
    const logoPath =
      byLang(images.logos, preferred) ||
      byLang(images.logos, "en") ||
      images.logos[0]?.file_path ||
      "";
    const backdropPath =
      byLang(images.backdrops, preferred) ||
      byLang(images.backdrops, "en") ||
      images.backdrops[0]?.file_path ||
      "";

    const logo = this.image(logoPath) ?? "";
    const background = this.image(backdropPath, "original") ?? "";
    return { logo, background };
  }

  // Request with auth
  private async _getRequest<T>(
    endpoint: string,
    params: Record<string, any> = {},
    language?: TmdbLanguage,
  ): Promise<T> {
    if (!ENV.TMDB_API_KEY) {
      // No key configured: fail fast so call sites fall back to kisskh data
      // without any network round-trip
      throw new TmdbError(`TMDB_API_KEY not set`);
    }
    const queryParams = new URLSearchParams({
      ...params,
      ...(language ? { language } : {}),
    });
    let url = `${this.baseUrl}${endpoint}`;
    if (queryParams.size > 0) {
      // Detail endpoints already carry ?append_to_response in their path
      url += `${endpoint.includes("?") ? "&" : "?"}${queryParams}`;
    }
    url = getProxyUrl(url);
    const config: AxiosRequestConfig = {
      headers: {
        "User-Agent": USER_AGENT,
        Authorization: "Bearer " + ENV.TMDB_API_KEY,
        "Content-Type": "application/json",
      },
    };
    this.logger.log(`GET | ${url}`);
    // Search/detail payloads are near-static: a 12h URL cache keeps the
    // cold-catalog enrichment fan-out (~2 calls per title) from recurring
    const data = await axiosGet<T>(`${url}`, config, 12 * 60 * 60 * 1000);
    if (!data) {
      throw new TmdbError(`[TMDB  ] Not found data ${url}`);
    }
    return data;
  }
}

export const tmdb = new TMDBService();
