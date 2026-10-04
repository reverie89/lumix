# Config page

`public/landing.html`, `public/js/landing.js` and `public/css/style.css`
form one self-contained page; these files own the on-screen mechanics (a
Provider tab bar with one panel per provider, chip grids, TV/10-foot focus
and hint rules). Server-side config handling is in
[ARCHITECTURE.md](ARCHITECTURE.md); the agent rules are in the root
[AGENTS.md](../AGENTS.md).

## Behaviors that must survive any edit

- **Provider tab bar** — a tab bar holds one panel per provider: kisskh
  (ordered mirror list + Type / Region / Status / Update tiers) and 欧乐
  (API host list + Type / Region / Sort tiers), as chip grids.
- **Enabled toggles** — each provider has an Enabled toggle; off leaves the
  provider out of the config entirely. 欧乐 defaults off, so a fresh page's
  link is kisskh-only.
- **Tiers** — each tier needs at least one pick.

## Config encoding

The whole config is base64url-encoded JSON in the URL path — standard
base64's `/` would split the path once Chinese tier names are in the
config.

## Mirrors

The page auto-prefixes `https://` when the user types no scheme (see Mirrors
in [ARCHITECTURE.md](ARCHITECTURE.md) for the defaults and the walk order).
