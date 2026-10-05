# Config page

`public/landing.html`, `public/js/landing.js` and `public/css/style.css`
form one self-contained page; these files own the on-screen mechanics
(numbered order rows, tap-to-add chips, color-coded provider sections,
TV/10-foot focus and hint rules). Server-side config handling is in
[ARCHITECTURE.md](ARCHITECTURE.md); the agent rules are in the root
[AGENTS.md](../AGENTS.md).

## Behaviors that must survive any edit

- **Language** — the selector (English / 中文, default English) translates
  the page and stores the config's top-level `language`, which localizes
  the Stremio-side catalog names (`[L/欧乐] 大陆`), the manifest
  description and TMDB text (zh fetches TMDB details with `language=zh-CN`;
  searches stay English so title matching is unaffected).
- **Providers** — the Provider list is the add/remove control: each added
  provider is a numbered row (‹ › ✕), providers missing from the list sit
  below it as tap-to-add chips, and removing keeps the picks for a re-add
  while leaving the provider out of the config entirely (both providers
  start enabled on a fresh page, kisskh first).
- **Sections** — each added provider renders a color-coded section — kisskh
  in the page's Google Blue, 欧乐 in green — holding its groups: each tier
  is an ordered pick list with tap-to-add chips, tiers are individually
  optional (an empty tier adds no catalogs), and a provider only needs one
  tier with picks.
- **Ordering** — the provider-order list (the sections stack in its order),
  the tier-group order (‹ › in each tier legend) and the pick order within
  each tier all flow into the config and become the catalog order Stremio
  displays.

## Config encoding

The whole config is base64url-encoded JSON in the URL path — standard
base64's `/` would split the path once Chinese tier names are in the
config.

## Mirrors

The page auto-prefixes `https://` when the user types no scheme, and
deduplicates picks exactly as `normalizeConfig` does server-side (see
Mirrors in [ARCHITECTURE.md](ARCHITECTURE.md) for the defaults, the
injection and the walk order).
