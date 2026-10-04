# AGENTS.md

## Scope

These instructions apply to the entire repository. `docs/ARCHITECTURE.md`
carries the server mechanics and `docs/CONFIG_PAGE.md` the config-page
mechanics this file points to — read the relevant one before planning or
editing.

## Project Context

**lumix** is a [Stremio](https://www.stremio.com/) addon that streams dramas,
series and movies. Users configure it once on a web page and Stremio calls
the addon's catalog/meta/stream/subtitles endpoints with that config baked
into every URL. TMDB enrichment is optional: set `TMDB_API_KEY` in `.env`,
or leave it empty and the addon skips TMDB. There is no server-side user
storage.

- Server source lives in `src/`; the config page in `public/landing.html`,
  `public/js/landing.js` and `public/css/style.css`.
- Not source: `dist/`, `data/` (the sqlite database, gitignored) and
  `node_modules/` — ignore their diffs unless the task targets them.
- Dev commands: `npm run dev` (tsc + server, reads `.env`), `npm test`,
  `npm run db:generate` / `npm run db:migrate` (drizzle migrations also
  apply on server start). Copy `.env.example` — every var is optional.
- The stack is locked — do not change it without asking. The full table and
  the module map live in `docs/ARCHITECTURE.md`.
- Self-hosting, Docker and the dev compose are documented in README.

## Engineering Principles

Follow these principles for every code change:

- DRY: every rule is written once — extract into `src/service/` or
  `src/utils/` instead of copying a local variant.
- SSOT: one authority per answer — a change lands in one file and everything
  else reads from it.
- KISS: prefer the boring solution — plain functions over clever
  abstractions, the shared axios client over bespoke retry loops.
- YAGNI: build what the request needs — no "in case a provider comes back"
  hooks (see Purge, don't deprecate), no abstraction with one caller.
- SOLID: one reason to change per module — a new provider is a new scraper
  class behind the `BaseProvider` contract, not an edit threaded through
  every layer.

## Planning Principle — Design In Totalality

The config page is the app's single shared visual language: a change to one
section (a provider's tier grid, the order rows) is a change to the whole
form. Reuse the existing section/chip/row patterns rather than inventing a
parallel version for the new surface. When two sections look similar, flag
it for a decision rather than silently diverging.

### Reuse Assessment

Every plan states, before approval is requested, what it reuses and why
anything new cannot reuse what exists.

### UX Mockups

Any plan that touches what the config page looks like or how it behaves on
screen must include a UI mockup (rendered HTML/SVG preferred, ASCII
acceptable) and a plain-language explanation for a non-technical reader.

## Server Guidelines

- One scraper per provider in `src/source/`, reusable logic in
  `src/service/`, addon wiring in `src/lib/`, HTTP routers in `src/api/`,
  drizzle schema + queries in `src/db/`, leaf helpers in `src/utils/`. The
  provider-catalogs SSOT rules and the add/remove-a-provider checklists are
  in `docs/ARCHITECTURE.md`.
- `src/utils/` must not import from `src/source/` or `src/lib/` — it is the
  bottom of the graph. Constants a util needs live in
  `src/utils/constant.ts`.
- Env vars are server deployment settings only — including `TMDB_API_KEY`.
  Anything per-user (mirrors, categories) belongs in the config page, never
  in env. New flags that users will write as `FLAG=false` must use the
  strict `booleanFlag` zod parser (`z.coerce.boolean` treats `"false"` as
  true).

## Config Page Guidelines

- Vanilla JS chip grids: no framework, no dropdowns; native checkboxes and
  buttons so TV D-pads can drive the form.
- The behaviors that must survive any edit are pinned by tests and detailed
  in `docs/CONFIG_PAGE.md` — read it before editing the page.

## Security Guidelines

- Never commit API keys, tokens, or personal data. API keys are deployment
  settings in `.env` only — never config-page fields.
- There is no server-side user storage; do not add any.
- Do not log secrets, authorization headers, or user-identifying URLs.

## Testing And Verification

Run the smallest relevant verification set before finishing a change:

- `npm run build` — tsc clean.
- `npm test` — vitest green (pure-domain tests only; no network in unit
  tests).
- For HTTP-facing changes, run the server with a scratch env (set
  `TMDB_API_KEY` only when testing the TMDB path) and check: `/manifest.json`
  lists the expected catalogs (default stays kisskh-only); a config-scoped
  `/catalog/...` returns metas for each enabled provider; a legacy
  (old-format) config link still resolves its kisskh catalogs.
- Grep for identifiers you meant to purge — expect zero hits outside
  history.

If a command cannot run in the current environment, report the command and
the reason.

## Purge, don't deprecate

When a provider or feature is removed, remove **every** trace in the same
change: source files, tests, schemas + a migration, env vars from `env.ts`
and `.env.example`, UI markup, fixtures (.hurl), deps from `package.json`,
and the vitest projects that only matched the deleted tests. `grep` for the
deleted identifiers before declaring done — the history keeps what git
keeps. Dead code is not kept "in case a provider comes back"; re-adding is
what git history is for.

## Git Commits

- Never commit on your own. After the verification set above passes, ask the
  user for permission to commit, and only commit (with a Conventional
  Commits message) when they approve.
- A commit message is `type(scope): subject` — lowercase, imperative, no
  trailing period. Scope is the localized area (`providers`, `landing`,
  `manifest`…), omitted when the change spans the app. Add a short body only
  when the why isn't obvious from the subject. Never add attribution
  trailers (e.g. `Co-Authored-By:`). The initial commit is the one
  exception: it stays `Initial commit`.
- If the user commits themselves, do not amend or rewrite their history
  unless asked.

## Documentation

- Keep README behavior claims aligned with code.
- Comments state the rule, not the history. No extraction archaeology, no
  "this bit us once".
- One canonical home per explanation — `docs/ARCHITECTURE.md` for server
  mechanics, `docs/CONFIG_PAGE.md` for config-page mechanics;
  cross-reference instead of restating.
