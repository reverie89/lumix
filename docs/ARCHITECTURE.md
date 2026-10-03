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
| Config UI | **Vanilla JS chip grids**      | No framework, no dropdowns; native checkboxes/buttons for D-pad use          |
| Tests    | **vitest**                      | Pure-domain tests only; no network in unit tests                              |

## The config path

1. `public/js/landing.js` collects the form into
   `{ providers: { kisskh: { mirrors, type, region, status, update } } }`,
   base64-encodes it and shows `/{configBase64}/manifest.json`.
2. `decodeConfig` (`src/api/router/stremio.ts`) decodes and **normalizes**:
   a mirror is any http(s) URL (the page auto-prefixes `https://`), tier
   picks are filtered to known options (`__all__` expands), and catalog ids
   are expanded server-side. Never trust a decoded config's shape —
   `stremio.test.ts` pins each rule.
3. `buildManifest(config)` turns the expanded `catalogs` into Stremio catalog
   declarations; the handlers in `src/lib/addon.ts` gate every request
   through `filterProvider` (config's `catalog`/`stream` lists).

## Provider catalogs are the single sources of truth

`src/source/kisskh-catalogs.ts` is the single source of truth for kisskh
categories: tier option lists, `expandKisskhCatalogs` (tier picks → catalog
ids, used by both the page's server-side expansion and the manifest builder)
and `getKisskhQuery` (catalog name → upstream API query). A category change
touches this file and `landing.html` — nothing else. Its unit tests pin the
row-expansion rules (each pick is its own row; region/update add a series +
movies pair; status rows are series-only; US queries the Hollywood type).

## Hosts and subtitles

`isKisskhHost` (`src/utils/format.ts`, second-level label rule) classifies
hosts for the axios client selection (`src/utils/axios.ts`: mirrors on
kisskh domains get the no-redirect client) — it does not validate user
mirrors (`isMirrorUrl`, same file: a mirror is any http(s) URL). Subtitles
are separate: `isSubtitleSourceHost` (`kisskh-catalogs.ts`) owns the static
`/subtitle` allowlist, its tests pin the tricky cases
(`cdnvideo11.shop.evil.com` must not pass), and other-host origins are
admitted at runtime via the seen-subtitle-origin registry in `kisskh.ts`.

## Mirrors

kisskh has no single canonical domain; a mirror is any http(s) URL the user
inputs. The defaults live in `utils/constant.ts KISSKH_DEFAULT_MIRRORS`.
Requests walk the picked mirrors in the user's chosen order, skipping
mirrors with a failure in the last `KISSKH_FAIL_TTL_MS` and otherwise
falling back to the best success/fail ratio (`selectKisskhUrl` in
`src/source/kisskh.ts`). Tier picks default to `__all__`, which
`normalizeKisskhTiers` expands server-side to every option of the tier. The
page-side mirror UX is in [CONFIG_PAGE.md](CONFIG_PAGE.md).

## Provider contract and vocabulary

The abstract `BaseProvider` (`src/source/provider.ts`) defines the provider
contract; `getMeta`/`getSubtitles` take an optional `config` so providers
can read per-user settings (mirrors).

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
