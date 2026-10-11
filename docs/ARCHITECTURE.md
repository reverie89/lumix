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
   `{ language, order, providers: { kisskh: { mirrors, order, type, region, status, update }, ole: { mirrors, order, type, region, update }, iyf: { mirrors, order, type, region, year, quality, sort } } }`,
   base64url-encodes it and shows `/{configBase64}/manifest.json`.
2. `decodeConfig` (`src/api/router/stremio.ts`) decodes and **normalizes**:
   mirrors, tier picks (`__all__` expands), both `order` fields (unknowns
   dropped, missing appended in canonical order), `language` (`"zh"` only
   when exactly that) and the server-side catalog-id expansion. Every
   provider block present contributes. Never trust a decoded config's
   shape — `stremio.test.ts` pins each rule.
3. `buildManifest(config)` turns the expanded `catalogs` into Stremio catalog
   declarations, localized through `TIER_LABELS_ZH` / `PROVIDER_LABELS` in
   `utils/constant.ts` when `language` is zh (`manifest.test.ts` pins label
   completeness for all three providers); the handlers in `src/lib/addon.ts`
   gate every request through `filterProvider` (config's `catalog`/`stream`
   lists).

## Provider catalogs are the single sources of truth

`src/source/kisskh-catalogs.ts`, `src/source/ole-catalogs.ts` and
`src/source/iyf-catalogs.ts` are the single sources of truth for their
provider's categories: tier option lists, the canonical tier order
(`*_TIER_ORDER`), `expand*Catalogs` (tier picks → catalog ids) and
`get*Query` (catalog name → upstream API query). Option names are shared
where the concept is shared (Korean, TVSeries, Update…; iyf's Popular/Score
reuse ole's update names, while its Latest is add-time ordering — a
different concept from ole's Last Update, so it keeps its own name); each
catalogs file maps the names to its own upstream API values. A category
change touches the catalogs file, the `TIER_OPTIONS` table in
`public/js/landing.js`, and the zh label tables (`TIER_LABELS_ZH` in
`src/utils/constant.ts`, `OPTION_LABELS_ZH` in `landing.js`) — nothing else.
The `*-catalogs.test.ts` files pin the row-expansion rules.

Tier picks default to the explicit sets in `src/lib/manifest.ts`
`defaultKisskhSettings` / `defaultOleSettings` / `defaultIyfSettings` (the
unconfigured manifest, a fresh page and a re-added provider all start from
them); `__all__` remains a valid pick that the normalizers expand
server-side to every option of the tier.

## kisskh mislabels types

kisskh's Hollywood/US rows serve one mixed upstream list (`type=4`) to both
the series and the movie row, and search guesses from episode count — so
`KisskhScraper` is the only provider with `verifyTypes` on:
`tmdb.verifyType` searches both TMDB surfaces and keeps the confident match,
catalog/search rows drop items whose verdict contradicts the row
(unverifiable titles — TMDB off, no confident match — keep the
episode-count guess, so TMDB-off behavior is unchanged), and the verdict
also steers which surface enrichment searches. `BaseProvider.verifyTypes`
defaults off; ole/iyf rows are already type-filtered upstream.

## Hosts and subtitles

`isKisskhHost` (`src/utils/format.ts`, second-level label rule) classifies
hosts for the axios client selection (`src/utils/axios.ts`: kisskh-domain
mirrors get the no-redirect client; ole and iyf hosts use the default
client) — it does not validate user mirrors (`isMirrorUrl`, same file: a
mirror is any http(s) URL). Subtitles are separate:
`isSubtitleSourceHost` (`kisskh-catalogs.ts`) owns the static `/subtitle`
allowlist, its tests pin the tricky cases (`cdnvideo11.shop.evil.com` must
not pass), and other-host origins are admitted at runtime via the
seen-subtitle-origin registry in `kisskh.ts`. ole and iyf serve no subtitle
files (subs are hardcoded into the stream upstream) — their `getSubtitles`
return `[]`.

## Mirrors

kisskh has no single canonical domain; ole's picks are its API hosts (not
web mirrors); an iyf pick names a host family root or one of its subdomains
— `iyfFamily` in `src/source/iyf.ts` derives the
m10./rankv21./static./www. spellings. Mirror defaults are a deployment
setting: `KISSKH_MIRRORS` / `OLE_HOSTS` / `IYF_HOSTS` in env, filtered
through `isMirrorUrl` into the `*_DEFAULT_MIRRORS` of
`src/utils/constant.ts` and injected into the config page by `public.ts`;
an empty env means no default mirrors. The page and `normalizeConfig`
deduplicate picks (case- and trailing-slash-insensitive, first occurrence
wins). Requests walk the picked mirrors in the user's chosen order —
`MirrorFailover` (`src/service/mirror-failover.ts`) owns that algorithm and
its tests pin it. The page-side mirror UX is in
[CONFIG_PAGE.md](CONFIG_PAGE.md).

## Provider contract and vocabulary

The abstract `BaseProvider` (`src/source/provider.ts`) owns the shared
stream template; a scraper implements the catalog/meta/subtitle methods
plus the stream hooks, with `getMeta`/`getSubtitles` taking the optional
`config` for per-user mirrors. `Provider`/`Prefix`/`UserConfig` live in
`src/utils/config.ts` (leaf vocabulary — no upward imports).

### Adding a provider

A new scraper class + a `*-catalogs.ts` + `Provider`/`Prefix` enum entries +
a settings type in `config.ts` + defaults in `manifest.ts` + a color-coded
config-page section (`landing.html`, `landing.js`, a `style.css` accent) +
its mirror env var with the `public.ts` injection. Removing a provider is a
**purge** — see "Purge, don't deprecate" in
[AGENTS.md](../AGENTS.md).

## Visit log and internal dashboard

Setting `INTERNAL_PORT` opens a second listener (`INTERNAL_HOST`, default
`127.0.0.1`) serving `public/stats.html` through its own router
(`src/api/router/internal.ts`) — summary cards, a 14-day bar chart and a
live feed. That env var is also the visit log's switch: the `visitLog`
middleware on the main app (`src/api/middleware/visit-log.ts`) classifies
every request (landing / manifest / catalog / meta / stream / subtitle,
provider from the `providerIdPrefix` id rule), writes one `visit` row and
emits it to an in-process bus; `GET /events` on the internal router streams
the bus as SSE (heartbeat keep-alive, `EventSource` auto-reconnect). Only
salted hashes are stored — `ip_hash` rotates daily (same-day dedup only)
and `config_hash` per config; the salt lives in the `meta` table. Static
assets, the warm-cache's own boot requests (`x-lumix-warm` header) and
unrecognized paths are never logged, and rows older than 30 days are
pruned at startup next to `pruneExpiredRows`. With `INTERNAL_PORT` unset
there is no second listener and nothing is logged. The chart library is
the Chart.js UMD build vendored at `public/vendor/chart.umd.js` (its
`LICENSE.md` sits next to it) — the internal page loads nothing from the
internet. The public config-page stack is untouched.

## Development notes

- The sqlite database lives at `./data/lumix.db` (gitignored, hardcoded —
  tests run on an in-memory database).
- Bare-metal development needs Node 26.
- The repo's `docker-compose.yaml` is a dev deployment (`lumix-dev`, host
  55912 → container 55913, `env_file: .env`, `./data` bind mount); README
  carries the production compose, CI pushes images to ghcr.io, and
  `script/local-*-build.sh` builds them locally.
