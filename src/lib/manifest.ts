// Docs: https://github.com/Stremio/@stremio-addon/sdk/blob/master/docs/api/responses/manifest.md
import {
  ContentType,
  FullManifestResource,
  Manifest,
  ManifestCatalog,
  ManifestExtra,
} from "@stremio-addon/sdk";
import pkg from "../../package.json" with { type: "json" };
import { Provider } from "../source/provider.js";
import {
  expandKisskhCatalogs,
  KISSKH_HIDDEN_CATALOGS,
} from "../source/kisskh-catalogs.js";
import { PROVIDER_LABELS, SHORT_NAME } from "../utils/constant.js";

export interface KisskhSettings {
  mirrors: string[];
  type: string[];
  region: string[];
  status: string[];
  update: string[];
}

export interface OleSettings {
  mirrors: string[];
  type: string[];
  region: string[];
  update: string[];
}

// One entry per provider tab on the config page
export type ProviderSettings = KisskhSettings | OleSettings;

export interface UserConfig {
  // Per-provider settings (one entry per provider tab on the config page)
  providers: Record<string, ProviderSettings>;
  // Derived server-side from `providers` (kept for the manifest + legacy links)
  catalogs: string[];
  catalog: Provider[];
  stream: Provider[];
}

export enum Prefix {
  IMDB = "tt",
  TMDB = "tmdb",
  KISSKH = "kisskh",
  OLE = "ole",
}

// "__all__" expands server-side to every option of the tier (see
// normalizeKisskhTiers) — the same semantics as the config page's All chip.
const defaultKisskhSettings: KisskhSettings = {
  mirrors: [],
  type: ["__all__"],
  region: ["__all__"],
  status: ["__all__"],
  update: ["__all__"],
};

// Deliberately kisskh-only: the default (unconfigured) manifest and the
// startup cache-warming stay kisskh-sized; 欧乐 is opt-in via the config page.
export const defaultConfig: UserConfig = {
  providers: { kisskh: defaultKisskhSettings },
  catalogs: [
    ...expandKisskhCatalogs(defaultKisskhSettings),
    ...KISSKH_HIDDEN_CATALOGS,
  ],
  catalog: [Provider.KISSKH],
  stream: [Provider.KISSKH],
};

function buildCatalogMap(catalogs: string[] = defaultConfig.catalogs) {
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
      name: `[${SHORT_NAME}/${PROVIDER_LABELS[prefix ?? ""] ?? prefix}] ${name}`,
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
  version: pkg.version,
  catalogs: [],
  resources: [],
  // Stamped per request in buildManifest — the addon is reachable at
  // whatever origin the client used (tunnel host, LAN IP, localhost), so
  // there is no single canonical origin to bake in
  logo: "",
  idPrefixes: [Prefix.IMDB, Prefix.TMDB, Prefix.KISSKH, Prefix.OLE],
  types: ["movie", "series"],
  name: pkg.name,
  description: pkg.description,
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
  const catalogMap = buildCatalogMap(config.catalogs);
  if (config.catalog && config.catalog.length > 0) {
    manifest.resources.push("catalog");
    const metaResource: FullManifestResource = {
      name: "meta",
      types: ["movie", "series"],
      idPrefixes: [Prefix.IMDB, Prefix.TMDB, Prefix.KISSKH, Prefix.OLE],
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
