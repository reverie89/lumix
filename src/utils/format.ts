import { ENV } from "./env.js";

// Joins a title and its year qualifier in movie stream descriptions
const TITLE_SEPARATOR = " // ";

function episodeTag(season: number, episode?: number) {
  return `S${season.toString().padStart(2, "0")}E${episode?.toString().padStart(2, "0")}`;
}

// Stream description: series show only the episode tag, movies show
// `Title // Year` (plain title when the year is embedded or unknown)
export function formatStreamTitle(
  title: string,
  year?: number,
  season?: number,
  episode?: number,
) {
  if (season) return episodeTag(season, episode);
  if (year && !title.includes(year.toString())) {
    return `${title}${TITLE_SEPARATOR}${year}`;
  }
  return title;
}

// Download/cast filename: unlike the description, it keeps the title
export function formatStreamFilename(
  title: string,
  year?: number,
  season?: number,
  episode?: number,
) {
  if (season) return `${title} ${episodeTag(season, episode)}`;
  if (year && !title.includes(year.toString())) return `${title} ${year}`;
  return title;
}

const YEAR_SYNTAX_REGEX = /\s*\((\d{4})\)\s*/g;
export function extractTitle(rawTitle: string) {
  let year: number | undefined;
  const cleanTitle = rawTitle
    .replace(YEAR_SYNTAX_REGEX, (match, yearGroup) => {
      year = parseInt(yearGroup);
      return ""; // Remove the syntax from the title
    })
    .trim();
  const { title, season } = extractSeason(cleanTitle);
  return { title: title, year: year, season: season };
}

export function extractSeason(rawTitle: string) {
  // title: Heart Signal Season 5
  let season: number | undefined;
  const cleanTitle = rawTitle
    .replace(/Season\s+(\d+)/, (match, seasonGroup) => {
      season = parseInt(seasonGroup);
      return "";
    })
    .trim();
  return { title: cleanTitle, season: season };
}

export function normalize(str: string) {
  for (const matchIgnore of ENV.MATCH_IGNORES) {
    str = str.toLowerCase().replace(matchIgnore, "");
  }
  return str
    .toLowerCase()
    .replace(/(\d+)(st|nd|rd|th)/g, "$1") // fix 2nd season -> 2 season
    .replace(/[\u2018\u2019\u00b4\u201a]/g, "'") // fix quotes
    .replace(/[^a-z0-9\s']/g, " ") // only character, space and quote
    .replace(/\s+/g, " ") // no extra spaces
    .trim();
}

export function cleanUrl(url: string) {
  // remove query string
  url = url.replace(/[\x00-\x1F\x7F]/g, "").trim();
  url = url.replace(/\?.*$/, "");
  return url;
}

export function parseOrigin(url: string) {
  const hostname = new URL(url).origin;
  return hostname;
}

/**
 * Upstream year fields degrade to the current year: kisskh carries a
 * release date (pass `new Date(date).getFullYear()`), ole a bare year
 * string, TMDB an ISO `first_air_date`/`release_date` that is empty or
 * null for unreleased titles — all may be missing or unparseable.
 */
export function safeYear(
  value: string | number | null | undefined,
): number {
  const parsed = typeof value === "number" ? value : parseInt(value ?? "");
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : new Date().getFullYear();
}

/**
 * for the axios client selection (utils/axios.ts) and the subtitle proxy
 * allowlist (kisskh-catalogs.ts); never validates user mirrors (a mirror
 * is any http(s) URL, see isMirrorUrl).
 */
export function isKisskhHost(hostname: string): boolean {
  const labels = hostname.toLowerCase().split(".");
  return labels.length >= 2 && labels[labels.length - 2] === "kisskh";
}

/**
 * A mirror is any http(s) URL the user inputs — the upstream API is what
 * defines compatibility, not the hostname. Requests use the origin; paths
 * and query strings in the input are harmless.
 */
export function isMirrorUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
