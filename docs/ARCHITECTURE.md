# Architecture

Server-side mechanics: the config path, the provider catalogs sources of
truth, host classification, mirrors, and the provider contract. The
config-page counterpart is [CONFIG_PAGE.md](CONFIG_PAGE.md); the agent rules
live in the root [AGENTS.md](../AGENTS.md).

## Tech stack (locked — do not change without asking)

| Layer    | Choice                          | Notes                                                                        |
| -------- | ------------------------------- | ---------------------------------------------------------------------------- |
| Server   | **Hono + @hono/node-server**    | TypeScript ESM, `tsc` build to `dist/`, Node `--env-file` for config          |
| Database | **SQLite via better-sqlite3**   | Drizzle ORM (`drizzle-orm/better-sqlite3`), WAL mode, always on (`./data/lumix.db`) |
| Migrations | **drizzle-kit**                | `drizzle/lumix/`, applied on startup                                       |
| Scraper  | **axios + cheerio**             | One shared client factory in `src/utils/axios.ts` with retry on 429/451/403   |
| Matching | **fuse.js / fuzzball**          | Fuzzy title matching, threshold from `MIN_MATCHING_SCORE`                     |
| Config UI | **Vanilla JS ordered lists + chip grids** | No framework, no dropdowns; native checkboxes/buttons for D-pad use          |
| Tests    | **vitest**                      | Pure-domain tests only; no network in unit tests                              |

## The config path

1. `public/js/landing.js` collects the form into
   `{ language, order, providers: { kisskh: { mirrors, order, type, region, status, update }, ole: { mirrors, order, type, region, update } } }`,
   base64url-encodes it and shows `/{configBase64}/manifest.json`. The
   top-level `order` is the provider order, each provider's `order` its tier
   order, and every pick array carries the user's pick order — together they
   are the catalog order Stremio displays. `language` is `"en"` or `"zh"`
   (English default). Only Enabled providers are included; a provider
   toggled on starts from its full default selection.
2. `decodeConfig` (`src/api/router/stremio.ts`) decodes and **normalizes**:
   mirrors, tier picks (`__all__` expands), both `order` fields (unknowns
   dropped, missing appended in canonical order), `language` (`"zh"` only
   when exactly that; absent/invalid/legacy → `"en"`) and the server-side
   catalog-id expansion in that order. Every provider block present
   contributes — a config may enable kisskh and 欧乐 together. Never trust a
   decoded config's shape — `stremio.test.ts` pins each rule.
3. `buildManifest(config)` turns the expanded `catalogs` into Stremio catalog
   declarations (names/description localized through `TIER_LABELS_ZH` /
   `PROVIDER_LABELS` in `utils/constant.ts` when `language` is zh — a test
   pins label completeness against both catalogs files' options); the
   handlers in `src/lib/addon.ts` gate every request through
   `filterProvider` (config's `catalog`/`stream` lists).

## Provider catalogs are the single sources of truth

`src/source/kisskh-catalogs.ts` and `src/source/ole-catalogs.ts` are the
single sources of truth for their provider's categories: tier option lists,
the canonical tier order (`KISSKH_TIER_ORDER`/`OLE_TIER_ORDER` —
expansion follows the config's tier order and falls back to it),
`expandKisskhCatalogs`/`expandOleCatalogs` (tier picks → catalog ids,
used by both the page's server-side expansion and the manifest builder) and
`getKisskhQuery`/`getOleQuery` (catalog name → upstream API query).
Option names are shared where the concept is shared (Korean, TVSeries,
Update…) — each catalogs file maps them to its own upstream API values. A
category change touches the catalogs file, the `TIER_OPTIONS` table in
`public/js/landing.js`, and both zh label tables (`TIER_LABELS_ZH` in
`src/utils/constant.ts`, `OPTION_LABELS_ZH` in `landing.js`) — nothing
else; the manifest's label-completeness test enforces the server side.
Their unit tests pin the row-expansion rules (each type pick is its own
row; region/update picks add a series + movies pair; kisskh status rows are
series-only; kisskh US queries the Hollywood type; ole Movies is the
only movie-side type).

Tier picks default to the explicit sets in `src/lib/manifest.ts`
`defaultKisskhSettings` / `defaultOleSettings` (the unconfigured
manifest, a fresh page and a re-added provider all start from them);
`__all__` remains a valid pick that `normalizeKisskhTiers`/
`normalizeOleTiers` expand server-side to every option of the tier.

## Hosts and subtitles

`isKisskhHost` (`src/utils/format.ts`, second-level label rule) classifies
hosts for the axios client selection (`src/utils/axios.ts`: mirrors on
kisskh domains get the no-redirect client; ole's API host uses the
default client) — it does not validate user mirrors (`isMirrorUrl`, same
file: a mirror is any http(s) URL). Subtitles are separate:
`isSubtitleSourceHost` (`kisskh-catalogs.ts`) owns the static `/subtitle`
allowlist, its tests pin the tricky cases (`cdnvideo11.shop.evil.com` must
not pass), and other-host origins are admitted at runtime via the
seen-subtitle-origin registry in `kisskh.ts`. ole serves no subtitle
files (subs are hardcoded upstream) — its `getSubtitles` returns `[]`.

## Mirrors

kisskh has no single canonical domain; ole's picks are its API hosts
(not web mirrors); a mirror is any http(s) URL the user inputs. The
defaults live in `utils/constant.ts KISSKH_DEFAULT_MIRRORS` /
`OLE_DEFAULT_MIRRORS`. Requests walk the picked mirrors in the user's
chosen order, skipping mirrors with a failure in the last
`MIRROR_FAIL_TTL_MS` and otherwise falling back to the best success/fail
ratio (`MirrorFailover` in `src/service/mirror-failover.ts`, one instance
per provider). The page-side mirror UX is in
[CONFIG_PAGE.md](CONFIG_PAGE.md).

## Provider contract and vocabulary

The abstract `BaseProvider` (`src/source/provider.ts`) defines the provider
contract: the base owns the shared `getStreams`/`buildStream` template,
`toPreview` and the TMDB year override — a scraper implements the
catalog/meta/subtitle methods plus the stream hooks (`providerIdField`,
`resolveStreamTarget`, `generateStreams`). `getMeta`/`getSubtitles` take an
optional `config` so providers can read per-user settings (mirrors).
`Provider`/`Prefix`/`UserConfig` live in `src/utils/config.ts` (leaf
vocabulary — no upward imports).

### Adding a provider

A new scraper class + a `Provider` enum entry + a config-page tab. Removing
a provider is a **purge** — see "Purge, don't deprecate" in
[AGENTS.md](../AGENTS.md).

## Development notes

- The sqlite database lives at `./data/lumix.db` (gitignored, hardcoded —
  tests run on an in-memory database).
- Bare-metal development needs Node 26.
- The repo's `docker-compose.yaml` is a dev deployment (`lumix-dev`, host
  55912 → container 55913, `env_file: .env`, `./data` bind mount); README
  carries the production compose, CI pushes images to ghcr.io, and
  `script/local-*-build.sh` builds them locally.
