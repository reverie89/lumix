// The user-config vocabulary shared by every layer: providers, id prefixes,
// and the decoded config shape. Leaf module — nothing here may import from
// source/lib/api/db/service, so lower layers (source, service, db) can speak
// the config language without reaching upward into addon wiring.

export enum Provider {
  KISSKH = "kisskh",
  OLE = "ole",
  IYF = "iyf",
}

export enum Prefix {
  IMDB = "tt",
  TMDB = "tmdb",
  KISSKH = "kisskh",
  OLE = "ole",
  IYF = "iyf",
}

// Catalog ids (and the meta/stream ids built from them) carry their provider
// as a "<provider>." prefix, so a path can be attributed to a provider. The
// config segment is base64url (no dots), so on a request path the prefix only
// matches resource ids — shared by the per-provider catalog rate limit and
// the visit log.
export const providerIdPrefix = new RegExp(
  `(${Object.values(Provider).join("|")})\\.`,
);

export interface KisskhSettings {
  mirrors: string[];
  // Tier order (the page's tier-group order); canonical when absent
  order?: readonly string[];
  type: string[];
  region: string[];
  status: string[];
  update: string[];
}

export interface OleSettings {
  mirrors: string[];
  // Tier order (the page's tier-group order); canonical when absent
  order?: readonly string[];
  type: string[];
  region: string[];
  update: string[];
}

export interface IyfSettings {
  mirrors: string[];
  // Tier order (the page's tier-group order); canonical when absent
  order?: readonly string[];
  type: string[];
  region: string[];
  year: string[];
  quality: string[];
  sort: string[];
}

// One entry per provider tab on the config page
export type ProviderSettings = KisskhSettings | OleSettings | IyfSettings;

// Page + Stremio display language, picked on the config page before the
// provider tabs. Legacy configs predate the field and read as "en".
export type ConfigLanguage = "en" | "zh";

export interface UserConfig {
  language: ConfigLanguage;
  // Per-provider settings (one entry per provider tab on the config page)
  providers: Record<string, ProviderSettings>;
  // Derived server-side from `providers` (kept for the manifest + legacy links)
  catalogs: string[];
  catalog: Provider[];
  stream: Provider[];
}
