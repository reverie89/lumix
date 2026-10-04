// Single source of truth for kisskh Explore categories: tier option lists,
// catalog-id expansion and the upstream API query parameters all derive from
// these tables. Kept free of imports from kisskh.ts/provider.ts to avoid cycles.
import { KISSKH_CDN_DOMAIN } from "../utils/constant.js";
import { isKisskhHost } from "../utils/format.js";

const KISSKH_TYPE_OPTIONS = [
  "TVSeries",
  "Movies",
  "Anime",
  "Hollywood",
] as const;
const KISSKH_STATUS_OPTIONS = ["Ongoing", "Completed"] as const;
const KISSKH_UPDATE_OPTIONS = ["Popular", "Last Update", "Release Date"] as const;
const KISSKH_REGION_OPTIONS = [
  "Korean",
  "Chinese",
  "Japanese",
  "Hongkong",
  "Thai",
  "Taiwanese",
  "Philippine",
  "Indonesian",
  "Singaporean",
  "Vietnamese",
  "Turkish",
  "Indian",
  "Malaysian",
  "US",
] as const;

// kisskh API `type` param: 1 = TV Series, 2 = Movies, 3 = Anime, 4 = Hollywood
const API_TYPE = { series: "1", movie: "2", anime: "3", hollywood: "4" };
// kisskh API `country` param. The US is expressed as the Hollywood type (4),
// matching the site: there is no country filter for it.
const API_COUNTRY: Record<string, string> = {
  Chinese: "1",
  Korean: "2",
  Japanese: "3",
  Hongkong: "4",
  Thai: "5",
  Taiwanese: "7",
  Philippine: "8",
  Indonesian: "9",
  Singaporean: "10",
  Vietnamese: "11",
  Turkish: "12",
  Indian: "13",
  Malaysian: "14",
};
// kisskh API `order` param — the labels are kisskh's own Explore filter
// (Popular / Last Update / Release Date).
const API_UPDATE: Record<string, string> = {
  Popular: "1",
  "Last Update": "2",
  "Release Date": "3",
};

export interface KisskhQuery {
  type: string;
  country: string;
  status: string;
  order: string;
}

/**
 * Resolve the explore query for a catalog name (`kisskh.{movie|series}.{name}`).
 * The API type defaults from the Stremio content type unless the category
 * implies its own (TV Series/Anime/Hollywood are series-side, Movies is the
 * movie side, US is Hollywood).
 */
export function getKisskhQuery(
  name: string,
  type: "movie" | "series",
): KisskhQuery | null {
  const base: KisskhQuery = {
    type: type === "movie" ? API_TYPE.movie : API_TYPE.series,
    country: "0",
    status: "0",
    order: "2", // kisskh's own Explore default: Last Update
  };
  switch (name) {
    case "TVSeries":
      return { ...base, type: API_TYPE.series };
    case "Movies":
      return { ...base, type: API_TYPE.movie };
    case "Anime":
      return { ...base, type: API_TYPE.anime };
    case "Hollywood":
    case "US":
      return { ...base, type: API_TYPE.hollywood };
    default:
      break;
  }
  if ((KISSKH_STATUS_OPTIONS as readonly string[]).includes(name)) {
    return {
      ...base,
      type: API_TYPE.series,
      status: name === "Ongoing" ? "1" : "2",
    };
  }
  const order = API_UPDATE[name];
  if (order) return { ...base, order };
  const country = API_COUNTRY[name];
  if (country) return { ...base, country };
  return null;
}

export type KisskhTiers = {
  type: string[];
  region: string[];
  status: string[];
  update: string[];
};

/**
 * Expand tier picks into manifest catalog ids (flat model: every pick is its
 * own row; region/status-pair types each add a series and a movies row).
 * Picks go through normalizeKisskhTiers first so "__all__" expands.
 */
export function expandKisskhCatalogs(settings: KisskhTiers): string[] {
  const { type, region, status, update } = normalizeKisskhTiers(settings);
  const ids = new Set<string>();
  for (const typePick of type) {
    switch (typePick) {
      case "TVSeries":
        ids.add("kisskh.series.TVSeries");
        break;
      case "Movies":
        ids.add("kisskh.movie.Movies");
        break;
      case "Anime":
        ids.add("kisskh.series.Anime");
        break;
      case "Hollywood":
        ids.add("kisskh.series.Hollywood");
        ids.add("kisskh.movie.Hollywood");
        break;
      default:
        break;
    }
  }
  for (const regionPick of region) {
    ids.add(`kisskh.series.${regionPick}`);
    ids.add(`kisskh.movie.${regionPick}`);
  }
  for (const statusPick of status) {
    ids.add(`kisskh.series.${statusPick}`);
  }
  for (const updatePick of update) {
    ids.add(`kisskh.series.${updatePick}`);
    ids.add(`kisskh.movie.${updatePick}`);
  }
  return [...ids];
}

/** Hidden rows always appended to a kisskh config (search catalogs). */
export const KISSKH_HIDDEN_CATALOGS = [
  "kisskh.series.Search",
  "kisskh.movie.Search",
];

/**
 * Normalize tier picks: "__all__" expands to every known option, unknown
 * options are dropped, duplicates removed.
 */
export function normalizeKisskhTiers(settings: KisskhTiers): KisskhTiers {
  const expand = (values: string[], known: readonly string[]) =>
    values.includes("__all__")
      ? [...known]
      : [...new Set(values.filter((value) => known.includes(value)))];
  return {
    type: expand(settings.type, KISSKH_TYPE_OPTIONS),
    region: expand(settings.region, KISSKH_REGION_OPTIONS),
    status: expand(settings.status, KISSKH_STATUS_OPTIONS),
    update: expand(settings.update, KISSKH_UPDATE_OPTIONS),
  };
}

/**
 * Hosts the /subtitle proxy may fetch statically: kisskh mirrors plus
 * kisskh's own CDN (subtitle/stream files live there, not on the mirrors).
 * Mirrors on other hosts are allowed per config — those are admitted at
 * runtime via the seen-subtitle-origin registry in kisskh.ts. Anything else
 * is rejected so the route cannot be used as a proxy for arbitrary hosts.
 */
export function isSubtitleSourceHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    isKisskhHost(host) ||
    host === KISSKH_CDN_DOMAIN ||
    host.endsWith(`.${KISSKH_CDN_DOMAIN}`)
  );
}
