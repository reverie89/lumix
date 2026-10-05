// Single source of truth for ole (欧乐) Explore categories: tier option
// lists, tier order, catalog-id expansion and the upstream API path parameters
// all derive from these tables. Kept free of imports from ole.ts/provider.ts to avoid cycles.
// Option names align with kisskh-catalogs' English vocabulary (same concept,
// same name: Korean, TVSeries, Update…) so both providers read identically in
// configs, manifest rows and the Stremio UI; the Chinese strings below are
// upstream API values only, never config values.
import { expandPicks, normalizeTierOrder } from "../utils/catalog.js";

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

type OleTier = "type" | "region" | "update";

// Tier order the config page shows and expandOleCatalogs follows when a
// config carries no order of its own.
export const OLE_TIER_ORDER: readonly OleTier[] = [
  "type",
  "region",
  "update",
];

/** Tier picks as they arrive from a decoded config (order optional). */
type OleTiers = {
  order?: readonly string[];
  type: string[];
  region: string[];
  update: string[];
};

/** normalizeOleTiers output: validated picks plus a full tier order. */
type NormalizedOleTiers = Omit<OleTiers, "order"> & {
  order: readonly OleTier[];
};

// Row-emission rule per tier (the flat model: every pick is its own row;
// region and update picks each add a series and a movies row).
const EMIT_TIER: Record<OleTier, (pick: string, ids: Set<string>) => void> =
  {
    type: (pick, ids) => {
      const stremioType = pick === "Movies" ? "movie" : "series";
      ids.add(`ole.${stremioType}.${pick}`);
    },
    region: (pick, ids) => {
      ids.add(`ole.series.${pick}`);
      ids.add(`ole.movie.${pick}`);
    },
    update: (pick, ids) => {
      ids.add(`ole.series.${pick}`);
      ids.add(`ole.movie.${pick}`);
    },
  };

/**
 * Expand tier picks into manifest catalog ids, tiers in `settings.order` (the
 * config page's tier order) and picks in their array order — the resulting
 * order is the catalog order Stremio displays. Picks go through
 * normalizeOleTiers first so "__all__" expands.
 */
export function expandOleCatalogs(settings: OleTiers): string[] {
  const { order, ...picks } = normalizeOleTiers(settings);
  const ids = new Set<string>();
  for (const tier of order) {
    for (const pick of picks[tier]) {
      EMIT_TIER[tier](pick, ids);
    }
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
 * options are dropped, duplicates removed. The order is normalized the same
 * way: unknown tiers dropped, missing tiers appended in canonical order.
 */
export function normalizeOleTiers(
  settings: OleTiers,
): NormalizedOleTiers {
  return {
    order: normalizeTierOrder(settings.order, OLE_TIER_ORDER),
    type: expandPicks(settings.type, OLE_TYPE_OPTIONS),
    region: expandPicks(settings.region, OLE_REGION_OPTIONS),
    update: expandPicks(settings.update, OLE_UPDATE_OPTIONS),
  };
}
