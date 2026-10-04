// Single source of truth for ole (欧乐) Explore categories: tier option
// lists, catalog-id expansion and the upstream API path parameters all derive
// from these tables. Kept free of imports from ole.ts/provider.ts to avoid cycles.
// Option names align with kisskh-catalogs' English vocabulary (same concept,
// same name: Korean, TVSeries, Update…) so both providers read identically in
// configs, manifest rows and the Stremio UI; the Chinese strings below are
// upstream API values only, never config values.

export const OLE_TYPE_OPTIONS = [
  "TVSeries",
  "Movies",
  "Variety",
  "Anime",
  "ShortDrama",
] as const;
// Region options verified live against the list API (areas with content);
// 其他 exists upstream but returns zero rows for both movies and series.
export const OLE_REGION_OPTIONS = [
  "Chinese",
  "Hongkong",
  "Taiwanese",
  "Japanese",
  "Korean",
  "US",
  "UK",
  "Thai",
  "French",
  "German",
  "Italian",
  "Spanish",
  "Canadian",
  "Russian",
  "Dutch",
  "Australian",
] as const;
export const OLE_UPDATE_OPTIONS = [
  "Popular",
  "Last Update",
  "Score",
  "Release Date",
] as const;

// ole API typeId1 (navs endpoint). 午夜影院 (5) is adult-only and
// VIP蓝光影院 (6) needs a paid account (vip rows carry no free stream url) —
// both are excluded from the taxonomy and vip rows are filtered at fetch time.
const API_TYPE_ID1: Record<string, string> = {
  Movies: "1",
  TVSeries: "2",
  Variety: "3",
  Anime: "4",
  ShortDrama: "14",
};
const API_AREA: Record<string, string> = {
  Chinese: "大陆",
  Hongkong: "香港",
  Taiwanese: "台湾",
  Japanese: "日本",
  Korean: "韩国",
  US: "美国",
  UK: "英国",
  Thai: "泰国",
  French: "法国",
  German: "德国",
  Italian: "意大利",
  Spanish: "西班牙",
  Canadian: "加拿大",
  Russian: "俄罗斯",
  Dutch: "荷兰",
  Australian: "澳大利亚",
};
const API_UPDATE: Record<string, string> = {
  Popular: "hot",
  "Last Update": "update",
  Score: "score",
  "Release Date": "desc",
};

export interface OleQuery {
  typeId1: string;
  area: string;
  update: string;
}

/**
 * Resolve the explore query for a catalog name (`ole.{movie|series}.{name}`).
 * Type categories fix their own typeId1 (Movies is the only movie-side
 * shelf); region and update rows take the typeId1 from the Stremio content
 * type.
 */
export function getOleQuery(
  name: string,
  type: "movie" | "series",
): OleQuery | null {
  const base: OleQuery = {
    typeId1: type === "movie" ? "1" : "2",
    area: "0",
    update: API_UPDATE["Last Update"]!,
  };
  const typeId1 = API_TYPE_ID1[name];
  if (typeId1) return { ...base, typeId1 };
  const update = API_UPDATE[name];
  if (update) return { ...base, update };
  const area = API_AREA[name];
  if (area) return { ...base, area };
  return null;
}

export type OleTiers = {
  type: string[];
  region: string[];
  update: string[];
};

/**
 * Expand tier picks into manifest catalog ids (flat model: every pick is its
 * own row; region and update picks each add a series and a movies row).
 * Picks go through normalizeOleTiers first so "__all__" expands.
 */
export function expandOleCatalogs(settings: OleTiers): string[] {
  const { type, region, update } = normalizeOleTiers(settings);
  const ids = new Set<string>();
  for (const typePick of type) {
    const stremioType = typePick === "Movies" ? "movie" : "series";
    ids.add(`ole.${stremioType}.${typePick}`);
  }
  for (const regionPick of region) {
    ids.add(`ole.series.${regionPick}`);
    ids.add(`ole.movie.${regionPick}`);
  }
  for (const updatePick of update) {
    ids.add(`ole.series.${updatePick}`);
    ids.add(`ole.movie.${updatePick}`);
  }
  return [...ids];
}

/** Hidden rows always appended to an ole config (search catalogs). */
export const OLE_HIDDEN_CATALOGS = [
  "ole.series.Search",
  "ole.movie.Search",
];

/**
 * Normalize tier picks: "__all__" expands to every known option, unknown
 * options are dropped, duplicates removed.
 */
export function normalizeOleTiers(settings: OleTiers): OleTiers {
  const expand = (values: string[], known: readonly string[]) =>
    values.includes("__all__")
      ? [...known]
      : [...new Set(values.filter((value) => known.includes(value)))];
  return {
    type: expand(settings.type, OLE_TYPE_OPTIONS),
    region: expand(settings.region, OLE_REGION_OPTIONS),
    update: expand(settings.update, OLE_UPDATE_OPTIONS),
  };
}
