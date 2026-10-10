// Docs: https://github.com/Stremio/@stremio-addon/sdk/blob/master/docs/api/responses/manifest.md
import {
  ContentType,
  FullManifestResource,
  Manifest,
  ManifestCatalog,
  ManifestExtra,
} from "@stremio-addon/sdk";
import type {
  ConfigLanguage,
  IyfSettings,
  KisskhSettings,
  OleSettings,
  UserConfig,
} from "../utils/config.js";
import { Prefix, Provider } from "../utils/config.js";
import {
  expandKisskhCatalogs,
  KISSKH_HIDDEN_CATALOGS,
} from "../source/kisskh-catalogs.js";
import {
  expandOleCatalogs,
  OLE_HIDDEN_CATALOGS,
} from "../source/ole-catalogs.js";
import {
  expandIyfCatalogs,
  IYF_HIDDEN_CATALOGS,
} from "../source/iyf-catalogs.js";
import {
  MANIFEST_DESCRIPTION_ZH,
  PROVIDER_LABELS,
  SHORT_NAME,
  TIER_LABELS_ZH,
} from "../utils/constant.js";
import {
  APP_DESCRIPTION,
  APP_NAME,
  APP_VERSION,
} from "../utils/version.js";

// The default selections: what the unconfigured manifest, a fresh config
// page and a re-added provider start from. Tiers are optional on the config
// page — an empty tier (kisskh status, ole update) adds no catalogs;
// "__all__" (every option of a tier, see normalizeKisskhTiers) stays valid
// in decoded configs but is not the default. Mirrors stay empty here: the
// providers fall back to the KISSKH_/OLE_DEFAULT_MIRRORS lists in
// utils/constant.ts, which also pre-fill the config page's mirror rows.
const defaultKisskhSettings: KisskhSettings = {
  mirrors: [],
  // Update rows first — freshest content on top in Stremio
  order: ["update", "type", "region", "status"],
  type: ["TVSeries", "Movies"],
  region: ["Korean", "Chinese", "US"],
  status: [],
  update: ["Last Update"],
};

const defaultOleSettings: OleSettings = {
  mirrors: [],
  order: ["type", "region", "update"],
  type: ["TVSeries", "Movies", "Variety", "ShortDrama"],
  region: ["Chinese", "Hongkong", "US"],
  update: [],
};

const defaultIyfSettings: IyfSettings = {
  mirrors: [],
  order: ["type", "region", "year", "quality", "sort"],
  type: ["TVSeries", "Movies"],
  region: ["Chinese", "Hongkong"],
  year: [],
  quality: [],
  sort: [],
};

// kisskh, then 欧乐, then 爱壹帆 — the same shape normalizeConfig produces
// for a decoded config carrying all three providers (hidden search rows
// close each provider's block).
export const defaultConfig: UserConfig = {
  language: "en",
  providers: {
    kisskh: defaultKisskhSettings,
    ole: defaultOleSettings,
    iyf: defaultIyfSettings,
  },
  catalogs: [
    ...expandKisskhCatalogs(defaultKisskhSettings),
    ...KISSKH_HIDDEN_CATALOGS,
    ...expandOleCatalogs(defaultOleSettings),
    ...OLE_HIDDEN_CATALOGS,
    ...expandIyfCatalogs(defaultIyfSettings),
    ...IYF_HIDDEN_CATALOGS,
  ],
  catalog: [Provider.KISSKH, Provider.OLE, Provider.IYF],
  stream: [Provider.KISSKH, Provider.OLE, Provider.IYF],
};

// Catalog display name per language: `[L/kisskh] Korean` / `[L/欧乐] 大陆`.
// The tier option keys are the shared English vocabulary; zh maps them
// through TIER_LABELS_ZH and falls back to the raw token for anything
// unmapped.
function catalogDisplayName(
  prefix: string,
  name: string,
  language: ConfigLanguage,
): string {
  const providerLabel = PROVIDER_LABELS[prefix] ?? prefix;
  const tierLabel =
    language === "zh" ? (TIER_LABELS_ZH[name] ?? name) : name;
  return `[${SHORT_NAME}/${providerLabel}] ${tierLabel}`;
}

function buildCatalogMap(
  catalogs: string[] = defaultConfig.catalogs,
  language: ConfigLanguage = "en",
) {
  const manifestCatalogs = catalogs.map((catalogId) => {
    const [prefix, type, name] = catalogId.split(".");
    const extra: ManifestExtra[] =
      name === "Search"
        ? [
            { name: "skip", isRequired: false },
            { name: "search", isRequired: true },
          ]
        : [{ name: "skip", isRequired: false }];
    const manifestCatalog: ManifestCatalog = {
      id: catalogId,
      type: type as ContentType,
      name: catalogDisplayName(prefix ?? "", name ?? "", language),
      extra: extra,
    };
    return manifestCatalog;
  });
  const catalogMap = Object.groupBy(
    manifestCatalogs,
    (item) => (item.id.split(".")[0] || item.id) as Provider,
  );
  return catalogMap;
}

const baseManifest: Manifest = {
  id: "community.lumix",
  version: APP_VERSION,
  catalogs: [],
  resources: [],
  // Stamped per request in buildManifest — the addon is reachable at
  // whatever origin the client used (tunnel host, LAN IP, localhost), so
  // there is no single canonical origin to bake in
  logo: "",
  idPrefixes: [
    Prefix.IMDB,
    Prefix.TMDB,
    Prefix.KISSKH,
    Prefix.OLE,
    Prefix.IYF,
  ],
  types: ["movie", "series"],
  name: APP_NAME,
  description: APP_DESCRIPTION,
  behaviorHints: {
    adult: false,
    p2p: false,
    configurable: true,
    configurationRequired: false,
  },
};

let defaultManifest: Manifest | null = null;
export function buildManifest(config?: UserConfig, origin = "") {
  // The logo points back at the requesting client's own origin; stamped on
  // the way out so the default-manifest memo below stays origin-independent
  const withOrigin = (manifest: Manifest): Manifest =>
    origin ? { ...manifest, logo: `${origin}/img/lumix.ico` } : manifest;
  if (!config && defaultManifest) return withOrigin(defaultManifest);
  config = config || defaultConfig;
  // Buffer-based encoding: btoa throws on non-Latin-1 chars (e.g. a Unicode
  // key in the config) and would turn the manifest request into a 500.
  // base64url: a standard base64 config containing "/" (common once Chinese
  // tier names are in the config) would split the URL path into extra
  // segments; decodeConfig's base64 decoder accepts the url-safe alphabet
  const config64 = Buffer.from(JSON.stringify(config), "utf-8").toString(
    "base64url",
  );
  const manifest = { ...baseManifest };
  manifest.resources = [...baseManifest.resources];
  manifest.catalogs = [...baseManifest.catalogs];
  manifest.description =
    config.language === "zh" ? MANIFEST_DESCRIPTION_ZH : APP_DESCRIPTION;
  const catalogMap = buildCatalogMap(config.catalogs, config.language);
  if (config.catalog && config.catalog.length > 0) {
    manifest.resources.push("catalog");
    const metaResource: FullManifestResource = {
      name: "meta",
      types: ["movie", "series"],
      idPrefixes: [
        Prefix.IMDB,
        Prefix.TMDB,
        Prefix.KISSKH,
        Prefix.OLE,
        Prefix.IYF,
      ],
    };
    manifest.resources.push(metaResource);
    config.catalog.forEach((provider) => {
      const catalog = catalogMap[provider.toLowerCase() as Provider];
      if (catalog) {
        manifest.catalogs.push(...catalog);
      }
    });
  }

  if (config.stream && config.stream.length > 0) {
    manifest.resources.push("stream");
    manifest.resources.push("subtitles");
  }

  if (config === defaultConfig) {
    defaultManifest = structuredClone(manifest);
    return withOrigin(defaultManifest);
  }
  manifest.config = [{ key: "config", type: "text", default: config64 }];
  return withOrigin(manifest);
}
