import { ContentType } from "@stremio-addon/sdk";
import { AxiosRequestConfig } from "axios";
import { URLSearchParams } from "url";
import { axiosGet } from "../utils/axios.js";
import { USER_AGENT } from "../utils/constant.js";
import { ENV } from "../utils/env.js";
import { handleError, TmdbError } from "../utils/error.js";
import { extractTitle } from "../utils/format.js";
import { matchTitle } from "../utils/fuse.js";
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
  first_air_date: string;
  poster_path: string;
  backdrop_path?: string;
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
  release_date: string;
  poster_path: string;
  backdrop_path?: string;
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
 * request then omits the `language` param entirely, so English URLs (and
 * their axiosGet cache entries) stay byte-identical to before localization.
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

  // Search
  // The /search calls stay parameterless (English): result titles feed
  // matchTitle, and resolved titles later drive the providers' own search
  // (streams resolve by title) — a localized title would break both. Only
  // the final id-based detail fetch localizes.
  async searchDetail(
    search: string,
    type: ContentType,
    year?: number,
    language?: TmdbLanguage,
  ): Promise<ContentDetail | null> {
    const extracted = extractTitle(search);
    const season = extracted.season || 1;
    search = extracted.title;
    if (season == 1) {
      year = extracted.year || year;
    } else {
      year = undefined;
    }
    if (type === "series") {
      return await this.searchSeriesDetail(search, year, language);
    } else {
      return await this.searchMovieDetail(search, year, language);
    }
  }

  async searchSeriesDetail(
    title: string,
    year?: number,
    language?: TmdbLanguage,
  ): Promise<ContentDetail | null> {
    try {
      const response = await this.getSearchSeries(title, year);
      const titles = response.results.map((result) => {
        const year = new Date(result.first_air_date).getFullYear();
        const thumbnail = result.poster_path
          ? `${this.imageUrl}/t/p/w500${result.poster_path}`
          : "";
        const search: ContentDetail = {
          id: result.id.toString(),
          title: result.name,
          overview: result.overview,
          thumbnail: thumbnail,
          year: year,
          type: "series",
          tmdbId: result.id,
        };
        return search;
      });
      const detail = matchTitle<ContentDetail>(titles, title, year);
      const tv = detail[0];
      if (tv) {
        this.logger.log(`Found | ${tv.title} ${tv.year} ${tv.imdbId || ""}`);
        const detail = await this.getSeriesDetail(tv.id, language);
        return detail;
      }
      return null;
    } catch (error: any) {
      handleError(error, this.logger, `Search series`);
      return null;
    }
  }

  async getSearchSeries(title: string, year?: number): Promise<TmdbTvSearch> {
    if (year) {
      const param = { query: title, year: year };
      return await this._getRequest(`/search/tv`, param);
    }
    return await this._getRequest(`/search/tv`, { query: title });
  }

  async searchMovieDetail(
    title: string,
    year?: number,
    language?: TmdbLanguage,
  ): Promise<ContentDetail | null> {
    try {
      const movieResponse = await this.getSearchMovie(title, year);
      const results = this.getMovies(movieResponse.results);
      const movie = matchTitle(results, title, year)[0];
      if (movie) {
        this.logger.log(
          `Found | ${movie.title} ${movie.year} ${movie.imdbId || ""}`,
        );
        const detail = await this.getMovieDetail(movie.id, language);
        return detail;
      }
      return null;
    } catch (error: any) {
      handleError(error, this.logger, `Search movie`);
      return null;
    }
  }

  async getSearchMovie(title: string, year?: number): Promise<TmdbMovieSearch> {
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

  async findSeriesDetail(imdbId: string): Promise<ContentDetail | null> {
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
        const year = new Date(series.first_air_date).getFullYear();
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

  async findMovieDetail(imdbId: string): Promise<ContentDetail | null> {
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
  async getDetailTmdb(
    tmdbId: string,
    type: ContentType,
  ): Promise<ContentDetail | null> {
    if (type === "series") {
      return await this.getSeriesDetail(tmdbId);
    } else {
      return await this.getMovieDetail(tmdbId);
    }
  }

  getMovies(movies: TmdbMovieResult[]) {
    return movies.map((movie) => {
      return this.toDetail(movie);
    });
  }

  toDetail(movie: TmdbMovieResult): ContentDetail {
    const year = new Date(movie.release_date).getFullYear();
    const thumbnail = `${this.imageUrl}/t/p/w500${movie.poster_path}`;
    const background = movie.backdrop_path
      ? `${this.imageUrl}/t/p/w500${movie.backdrop_path}`
      : undefined;
    const content: ContentDetail = {
      id: movie.id.toString(),
      title: movie.title,
      overview: movie.overview,
      thumbnail: thumbnail,
      year: year,
      type: "movie",
      tmdbId: movie.id,
    };
    if (background) content.background = background;
    if (movie.imdb_id) content.imdbId = movie.imdb_id;
    return content;
  }

  async getMovieDetail(
    tmdbId: string,
    language?: TmdbLanguage,
  ): Promise<ContentDetail | null> {
    this.logger.debug(`ID ${tmdbId}`);
    try {
      const movie = await this.getMovieDetailImageExternalId(tmdbId, language);
      if (!movie) return null;
      const images = movie.images;
      const externalId = movie.external_ids;
      const year = new Date(movie.release_date).getFullYear();
      const thumbnail = `${this.imageUrl}/t/p/w500${movie.poster_path}`;
      const content: ContentDetail = {
        id: movie.id.toString(),
        title: movie.title,
        overview: movie.overview,
        thumbnail: thumbnail,
        year: year,
        type: "movie",
        tmdbId: movie.id,
      };
      if (movie.imdb_id) content.imdbId = movie.imdb_id;
      if (externalId?.imdb_id) content.imdbId = externalId.imdb_id;
      const { logo, background } = this.extractLogoAndBackground(
        images,
        language,
      );
      if (logo) content.logo = logo;
      if (background) content.background = background;
      return content;
    } catch (error: any) {
      handleError(error, this.logger, `Get movie details error`);
      return null;
    }
  }

  async getSeriesDetail(
    tmdbId: string,
    language?: TmdbLanguage,
  ): Promise<ContentDetail | null> {
    this.logger.debug(`ID ${tmdbId}`);
    try {
      const series = await this.getTvDetailImageExternalId(tmdbId, language);
      if (!series) return null;
      const images = series.images;
      const externalId = series.external_ids;
      const year = new Date(series.first_air_date).getFullYear();
      const thumbnail = `${this.imageUrl}/t/p/w500${series.poster_path}`;
      const content: ContentDetail = {
        id: series.id.toString(),
        title: series.name,
        overview: series.overview,
        year: year,
        type: "series",
        tmdbId: series.id,
        thumbnail: thumbnail,
      };
      if (externalId?.imdb_id) content.imdbId = externalId.imdb_id;
      const { logo, background } = this.extractLogoAndBackground(
        images,
        language,
      );
      if (logo) content.logo = logo;
      if (background) content.background = background;
      return content;
    } catch (error: any) {
      handleError(error, this.logger, `Get series details error`);
      return null;
    }
  }

  // Combined request
  async getTvDetailImageExternalId(
    id: string,
    language?: TmdbLanguage,
  ): Promise<TmdbTvImagesExternalId> {
    return await this._getRequest<TmdbTvImagesExternalId>(
      `/tv/${id}?append_to_response=images,external_ids${imageLanguageParams(language)}`,
      {},
      language,
    );
  }

  async getMovieDetailImageExternalId(
    id: string,
    language?: TmdbLanguage,
  ): Promise<TmdbMovieImagesExternalId> {
    return await this._getRequest<TmdbMovieImagesExternalId>(
      `/movie/${id}?append_to_response=images,external_ids${imageLanguageParams(language)}`,
      {},
      language,
    );
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

    const logo = logoPath ? `${this.imageUrl}/t/p/w500${logoPath}` : "";
    const background = backdropPath
      ? `${this.imageUrl}/t/p/original${backdropPath}`
      : "";
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
