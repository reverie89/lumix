// Single source of truth for iyf (爱壹帆) Explore categories: tier option
// lists, tier order, catalog-id expansion and the upstream API query values
// all derive from these tables. Kept free of imports from iyf.ts/provider.ts
// to avoid cycles. Option names align with kisskh/ole-catalogs' English
// vocabulary (same concept, same name: Korean, TVSeries, Popular…) so merged
// rows form where the providers share a concept; the Chinese strings below
// are upstream API values only, never config values.
// Values verified live against the derived API host (AllVideoType/
// MainMenuV3/GetSearchCondition and api/list/Search probes, 2026-10-10).
import { expandPicks, normalizeTierOrder } from "../utils/catalog.js";

export const IYF_TYPE_OPTIONS = [
  "TVSeries",
  "Movies",
  "Variety",
  "Anime",
  "ShortDrama",
] as const;
// Region options verified live (regions with content). 欧美/其它 have no
// ole counterpart, so they stay iyf-only rows under merge.
export const IYF_REGION_OPTIONS = [
  "Chinese",
  "Hongkong",
  "Taiwanese",
  "Japanese",
  "Korean",
  "Western",
  "UK",
  "Thai",
  "Others",
] as const;
export const IYF_YEAR_OPTIONS = [
  "ThisYear",
  "LastYear",
  "Earlier",
  "Nineties",
  "Eighties",
  "Nostalgia",
] as const;
export const IYF_QUALITY_OPTIONS = [
  "4K",
  "1080P",
  "900P",
  "720P",
] as const;
// Popular/Score deliberately reuse ole's update names (same concept, same
// upstream ordering family) so those shelves merge; iyf's recency sort orders
// by add-time — a different concept from ole's Last Update, so it keeps
// its own name and row.
export const IYF_SORT_OPTIONS = [
  "Popular",
  "Score",
  "Latest",
] as const;

// iyf API category paths (AllVideoType/MainMenuV3). The adult tree (0,2) is
// excluded from the taxonomy; section cids already exclude it.
const API_TYPE_CID: Record<string, string> = {
  Movies: "0,1,3",
  TVSeries: "0,1,4",
  Variety: "0,1,5",
  Anime: "0,1,6",
  ShortDrama: "0,1,8",
};
const API_REGION: Record<string, string> = {
  Chinese: "大陆",
  Hongkong: "香港",
  Taiwanese: "台湾",
  Japanese: "日本",
  Korean: "韩国",
  Western: "欧美",
  UK: "英国",
  Thai: "泰国",
  Others: "其它",
};
const API_YEAR: Record<string, string> = {
  ThisYear: "今年",
  LastYear: "去年",
  Earlier: "更早",
  Nineties: "90年代",
  Eighties: "80年代",
  Nostalgia: "怀旧",
};
const API_QUALITY: Record<string, string> = {
  "4K": "4K",
  "1080P": "1080P",
  "900P": "900P",
  "720P": "720P",
};
// api/list/Search orderby: 0 = add time, 1 = popularity, 2 = score
const API_SORT: Record<string, string> = {
  Latest: "0",
  Popular: "1",
  Score: "2",
};

export interface IyfQuery {
  cid: string;
  region: string;
  year: string;
  quality: string;
  orderby: string;
}

/**
 * Resolve the explore query for a catalog name (`iyf.{movie|series}.{name}`).
 * Type categories fix their own cid (Movies is the only movie-side shelf);
 * region/year/quality/sort rows take the cid from the Stremio content type.
 */
export function getIyfQuery(
  name: string,
  type: "movie" | "series",
): IyfQuery | null {
  const base: IyfQuery = {
    cid: type === "movie" ? API_TYPE_CID.Movies! : API_TYPE_CID.TVSeries!,
    region: "",
    year: "",
    quality: "",
    orderby: API_SORT.Latest!,
  };
  const cid = API_TYPE_CID[name];
  if (cid) return { ...base, cid };
  const sort = API_SORT[name];
  if (sort) return { ...base, orderby: sort };
  const region = API_REGION[name];
  if (region) return { ...base, region };
  const year = API_YEAR[name];
  if (year) return { ...base, year };
  const quality = API_QUALITY[name];
  if (quality) return { ...base, quality };
  return null;
}

type IyfTier = "type" | "region" | "year" | "quality" | "sort";

// Tier order the config page shows and expandIyfCatalogs follows when a
// config carries no order of its own.
export const IYF_TIER_ORDER: readonly IyfTier[] = [
  "type",
  "region",
  "year",
  "quality",
  "sort",
];

/** Tier picks as they arrive from a decoded config (order optional). */
type IyfTiers = {
  order?: readonly string[];
  type: string[];
  region: string[];
  year: string[];
  quality: string[];
  sort: string[];
};

/** normalizeIyfTiers output: validated picks plus a full tier order. */
type NormalizedIyfTiers = Omit<IyfTiers, "order"> & {
  order: readonly IyfTier[];
};

// Row-emission rule per tier (the flat model: every pick is its own row;
// region, year, quality and sort picks each add a series and a movies row).
const EMIT_TIER: Record<IyfTier, (pick: string, ids: Set<string>) => void> = {
  type: (pick, ids) => {
    const stremioType = pick === "Movies" ? "movie" : "series";
    ids.add(`iyf.${stremioType}.${pick}`);
  },
  region: (pick, ids) => {
    ids.add(`iyf.series.${pick}`);
    ids.add(`iyf.movie.${pick}`);
  },
  year: (pick, ids) => {
    ids.add(`iyf.series.${pick}`);
    ids.add(`iyf.movie.${pick}`);
  },
  quality: (pick, ids) => {
    ids.add(`iyf.series.${pick}`);
    ids.add(`iyf.movie.${pick}`);
  },
  sort: (pick, ids) => {
    ids.add(`iyf.series.${pick}`);
    ids.add(`iyf.movie.${pick}`);
  },
};

/**
 * Expand tier picks into manifest catalog ids, tiers in `settings.order` (the
 * config page's tier order) and picks in their array order — the resulting
 * order is the catalog order Stremio displays. Picks go through
 * normalizeIyfTiers first so "__all__" expands.
 */
export function expandIyfCatalogs(settings: IyfTiers): string[] {
  const { order, ...picks } = normalizeIyfTiers(settings);
  const ids = new Set<string>();
  for (const tier of order) {
    for (const pick of picks[tier]) {
      EMIT_TIER[tier](pick, ids);
    }
  }
  return [...ids];
}

/** Hidden rows always appended to an iyf config (search catalogs). */
export const IYF_HIDDEN_CATALOGS = [
  "iyf.series.Search",
  "iyf.movie.Search",
];

/**
 * Normalize tier picks: "__all__" expands to every known option, unknown
 * options are dropped, duplicates removed. The order is normalized the same
 * way: unknown tiers dropped, missing tiers appended in canonical order.
 */
export function normalizeIyfTiers(settings: IyfTiers): NormalizedIyfTiers {
  return {
    order: normalizeTierOrder(settings.order, IYF_TIER_ORDER),
    type: expandPicks(settings.type, IYF_TYPE_OPTIONS),
    region: expandPicks(settings.region, IYF_REGION_OPTIONS),
    year: expandPicks(settings.year, IYF_YEAR_OPTIONS),
    quality: expandPicks(settings.quality, IYF_QUALITY_OPTIONS),
    sort: expandPicks(settings.sort, IYF_SORT_OPTIONS),
  };
}
