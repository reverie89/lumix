# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-10

### Added

- 爱壹帆 (iyf) provider — catalog, meta and stream endpoints; subtitles are burned in upstream, so its subtitle endpoint serves none
- startup splash — the container log opens with the wordmark and release version

### Changed

- the built-in default selects all three providers — kisskh, 欧乐 and 爱壹帆 — with slimmer picks; the unconfigured manifest, a fresh config page and malformed-config fallback all start from this selection
- kisskh series/movie rows are type-verified against TMDB — confidently mislabeled titles drop out, unsure ones keep the upstream guess
- the docker runtime image shrinks to bare alpine + the node binary
- dependencies bumped to current majors — @hono/node-server 2, better-sqlite3 13, dotenv 18, typescript 7, vitest 5; drizzle stays on the 1.0 release candidate

### Fixed

- a warm content cache resolved without its episode — every episode of a series streamed episode 1 for the cache's lifetime
- kisskh catalogs and search hide pre-premiere rows marked "Coming <date>" upstream

## [0.2.1] - 2026-10-09

### Added

- language selector (English / 中文) — localizes the config page, catalog names and the manifest description; TMDB detail fetches switch to zh-CN
- local-time `[YYYY-MM-DD HH:mm:ss]` timestamps on log lines

### Changed

- the provider controls are a numbered add/remove list with stacked per-provider sections; tabs and Enabled toggles are gone
- TMDB matches persist across restarts — content mappings link once, refresh on remap and never unlink; NaN years and missing posters are handled; shared stream logic moves into the base provider
- provider mirror defaults are a deployment setting — `KISSKH_MIRRORS` / `OLE_HOSTS` env vars feed the config page and the no-mirrors fallback instead of bundled lists
- duplicate mirror picks collapse (case- and trailing-slash-insensitive, first occurrence wins) on the config page and in config normalization
- rate limits raised — catalog 200 / meta 60 / stream 40 / subtitles 30 per 10-minute window, and the catalog budget is counted per provider per IP so one provider's board scrolling doesn't starve the other's

## [0.2.0] - 2026-10-04

### Added

- 欧乐 (ole) provider — catalog, meta and stream endpoints with kisskh-aligned category vocabulary, opt-in from the config page's provider tab; upstream subtitles are burned in, so its subtitle endpoint serves none

## [0.1.0] - 2026-10-04

Initial release of **lumix** — a Stremio addon that streams dramas, series and movies from kisskh, with optional TMDB enrichment.

### Added

- kisskh catalog, meta, stream and subtitle endpoints; the whole config travels as base64 JSON in the URL path and is decoded and normalized server-side
- config page built for 10-foot/TV use — an ordered kisskh mirror list and four Explore tiers (Type / Region / Status / Update) as chip grids, each tier needing at least one pick, `__all__` expanded server-side
- mirror failover — requests walk the picked mirrors in the user's order, skip mirrors that failed within the fail TTL, otherwise fall back to the best success/fail ratio
- embedded SQLite cache (better-sqlite3 + Drizzle, WAL) at `./data/lumix.db` — migrations on startup, catalog warm-up, expired stream/subtitle rows pruned
- optional TMDB enrichment (artwork, overviews, years) via the `TMDB_API_KEY` deployment setting; without it kisskh's own data is served
- search with fuzzy title matching (`MIN_MATCHING_SCORE`, ignore words) and TMDB id fallback
- `/subtitle` VTT proxy for TV clients, restricted to kisskh mirrors and the kisskh CDN, with its own rate-limit budget
- kisskh token scripts run in a node:vm sandbox, compiled once per mirror with eviction on failure
- fixed-window rate limiting per resource (cf-connecting-ip-first keying) answering with HTTP-200 placeholders instead of error bursts
- single-flight fetches for concurrent cold URLs, LRU response cache, negative caching, background m3u8 prefetch and background TMDB/DB persistence
- optional outbound proxies — Webshare rotating proxy for kisskh, Mediaflow-style wrapper for TMDB and subtitles
- Docker deployment — Dockerfile, docker-compose.yaml and a CI workflow publishing the image to ghcr.io; the server always listens on port 55913

[unreleased]: https://github.com/reverie89/lumix/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/reverie89/lumix/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/reverie89/lumix/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/reverie89/lumix/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/reverie89/lumix/releases/tag/v0.1.0
