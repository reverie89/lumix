# Config page

`public/landing.html`, `public/js/landing.js` and `public/css/style.css`
form one self-contained page; these files own the on-screen mechanics (a
Provider tab bar, an ordered mirror list, tier chip grids, TV/10-foot focus
and hint rules). Server-side config handling is in
[ARCHITECTURE.md](ARCHITECTURE.md); the agent rules are in the root
[AGENTS.md](../AGENTS.md).

## Behaviors that must survive any edit

- **Provider tab bar** — a tab bar holds kisskh's panel: an ordered mirror
  list and four Explore tiers (Type / Region / Status / Update) as chip
  grids.
- **Tiers** — each tier needs at least one pick.

## Config encoding

The whole config is base64-encoded JSON in the URL path.

## Mirrors

The page auto-prefixes `https://` when the user types no scheme (see Mirrors
in [ARCHITECTURE.md](ARCHITECTURE.md) for the defaults and the walk order).
