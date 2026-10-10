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
  the Stremio-side catalog names, the manifest description and TMDB text
  (zh fetches TMDB details with `language=zh-CN`; searches stay English so
  title matching is unaffected).
- Removing a provider keeps its picks for a re-add while leaving the
  provider out of the config entirely.
- A fresh page starts all three providers enabled, kisskh first.
- Tiers are individually optional (an empty tier adds no catalogs).
- All three ordering levels (provider list, tier groups, picks within a
  tier) flow into the config as the catalog order Stremio displays.

## Config encoding

The whole config is base64url-encoded JSON in the URL path — standard
base64's `/` would split the path once Chinese tier names are in the
config.

## Mirrors

The page auto-prefixes `https://` when the user types no scheme, and
deduplicates picks exactly as `normalizeConfig` does server-side (see
Mirrors in [ARCHITECTURE.md](ARCHITECTURE.md) for what each provider's
picks mean, the env-provided defaults and the failover order).
