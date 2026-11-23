# Coverpress — project context

Read this before writing any code. It contains measurements and API facts that are
easy to get wrong and expensive to get wrong late.

## What this is

Print-ready PS4/PS5 case inserts for digital games: a JSON API, a local CLI that
shares the same renderer, and a browser frontend being rebuilt from zero
(`docs/FRONTEND-PLAN.md`).

```
client ─→ server/index.mjs (JSON API, local mode, no sessions) ─→ repo.mjs ─→ SQLite (data/)
                  │                                                   └── usage_events (quota)
                  ├── jobs.mjs (queue) ─→ build.mjs ─→ lib/cover.mjs ─→ lib/render.mjs
                  │                                        └── lib/qc.mjs
                  └── legal.mjs (acceptable use as data)
```

The API serves no HTML. There is no sign-up, sign-in or session: `localAccount()`
resolves one account at boot and every request acts as it. Keep it bound to
loopback; exposing the port exposes the data.

The CLI is `pipeline.mjs` (`games.txt` → `out/<slug>/wrap.png`) and is the offline
harness for the renderer.

## Hard measurements — do not change these

PS4 and PS5 use the identical Blu-ray keepcase.

| Thing | Value |
| --- | --- |
| Panel | 128 × 148 mm |
| Spine | 14 mm (a movie Blu-ray is 12 mm — wrong for games) |
| Full wrap | 270 × 148 mm |
| At 300 DPI | 3189 × 1748 px trim; 3260 × 1819 px with 3 mm bleed |
| Single panel at 300 DPI | 1512 × 1748 px — the minimum useful source art size |
| Default bleed | 3 mm each side |

Panel aspect is 0.865:1. Source art that is 16:9 landscape gets destroyed by that crop;
portrait 600×900 or 3:4 art is what you want.

## Coordinate system

**All rendering code works in millimetres.** The caller sets
`ctx.setTransform(DPMM, 0, 0, DPMM, ...)` where `DPMM = 300 / 25.4`, then every
coordinate, font size and line width in the draw functions is a millimetre value.
Do not mix pixel units into the draw functions. This is what makes the same code
work in Node (`@napi-rs/canvas`) and in a browser canvas unchanged.

Origin (0,0) is the top-left **trim** corner. Bleed extends into negative coordinates.

Panel x-offsets within the wrap: back = 0, spine = 128, front = 142.

`ctx.getImageData` ignores the canvas transform. Any pixel sampling (the QC title-contrast
check) must add the bleed offset in device pixels — `runChecks({ bleed })`.

## Layout anatomy

Modelled on real retail inserts.

- **Top band**, 12 mm, spans the full 270 mm across all three panels. PS4 style =
  accent-coloured band + black bottom block. PS5 style = white band + white bottom block.
- **Front panel**: full-bleed art below the band, title anchored top under a downward
  scrim, optional ribbon strip, rating box bottom-left, user's mark bottom-right.
- **Spine**: flat colour, title rotated 90°, platform label in the band, mark at the foot.
- **Back panel**: tagline top-left in large condensed caps, three screenshots in a
  right-hand column 44 mm wide, feature bullets in the left column, then the bottom
  block starting at y=108: spec chips, credit line, legal small print, and a bottom row
  of rating box, address block, barcode. The legal text's line count must be derived
  from the actual gap above that bottom row, not hardcoded — a fixed line count fits
  short legal text but silently overlaps the rating box the first time it's lengthened.

## Trademark constraint — not negotiable

Never reproduce, and never write code that fetches or embeds: the PlayStation logo or
wordmark, ESRB/PEGI board marks, Blu-ray/Dolby/DTS logos, or publisher logos. Draw
generic equivalents as vectors instead — a plain rating box, hand-drawn spec glyphs,
plain "PS4"/"PS5" lettering. Every cover carries legal text stating it is a personal-use
item, not official, and not for sale.

## APIs and their real free tiers

| Service | Free tier | Role |
| --- | --- | --- |
| RAWG | 20,000 req/month, key as query param | Title match, description, publisher, ESRB rating, screenshots. **Backlink attribution is a licensing condition** — print "Game data by RAWG.io" on the back panel. |
| SteamGridDB | Free key, Bearer auth | 600×900 portrait grids. **Do not use it in the hosted app**: its Terms of Use are personal, non-commercial only, so a paid service calling it (even with the customer's key) is a ToS breach. The CLI may use it for a personal batch. Its "grid" category is often finished retail art with the real logo lockup baked in. |
| OpenRouter | `:free` models — 20 req/min, 50 req/day unfunded, 1,000/day after a one-time $10 purchase | Back-cover copy, art prompts, vision review. |
| Gemini | Flash models, 10 req/min, 1,500 req/day | Same jobs, alternative provider. |

**No free image generation exists.** Gemini's image API has no free tier and
`gemini-2.5-flash-image-preview` was retired on 15 Jan 2026. Nano Banana 2 via Google
AI Plus is the consumer app only — no API. So custom art is an **upload** in the web app
and a drop-in folder in the CLI, never a pipeline API step. Do not write code that tries
to generate images.

Which OpenRouter models carry `:free` rotates. Never hardcode a model ID as the only
option — `npm run models` queries `/api/v1/models` and filters for `:free`, separating
those whose `architecture.input_modalities` includes `image`.

In the SaaS, provider keys are **per account**, sealed with AES-256-GCM and used only
server-side. Never move them to a shared deployment key: RAWG's licence and free quota
belong to the customer, not the operator.

## Legal

`GET /api/legal` (`server/legal.mjs`) returns acceptable use and what the renderer
refuses to draw, as structured data for the frontend to render. `LEGAL_CONTACT` sets
the takedown address returned alongside it.

Before changing pricing, adding a provider or adding an image source, read
`docs/LEGAL-AND-VIABILITY.md`. Rules that came out of that research:

- Never call SteamGridDB from the server. Art is always uploaded by the customer.
- RAWG's commercial terms are ambiguous (docs say small commercial use is fine; the
  pricing page sells it as a Business plan). Do not assume the free tier covers a paid
  product.
- Do not add a bundled library of retail covers, and do not add print-and-ship
  fulfilment — that makes the operator the commercial reproducer.

## Conventions

- ES modules, `"type": "module"`, **Node 22.5+** (`node:sqlite`, plus `--env-file`).
- One runtime dependency: `@napi-rs/canvas`. Do not add others. SQLite is `node:sqlite`.
- `path.dirname(fileURLToPath(import.meta.url))` for the project root — never
  `new URL(...).pathname`, which breaks on Windows.
- **Every tenant query is scoped.** `repo.mjs` is the only SQL surface; a project, cover
  or render lookup must join through `projects.account_id`. A lookup by id alone is a
  security bug, not a shortcut.
- **The API is JSON only.** No HTML, no templates, no static client files in
  `server/`. Responses are `sendJson`; errors are `{ error: "sentence" }` with a 4xx/5xx
  status. Unknown routes return a JSON 404 so a caller never gets an HTML error page.
- **Stored file paths are data-dir-relative** and resolved with `safeJoin`. Never join a
  user-controlled string onto a directory.
- **Review overrides are whitelisted and clamped** (`lib/cover.mjs`). Print geometry
  (`panelW`, `spine`, `base`) is not settable by a request.
- **Job handling**: the handler owns the cover's status, the worker owns the job row.
  A thrown error must leave the cover at `failed` with a message — never `processing`.
  Transient errors retry with backoff; user-fixable errors are `permanent`.
- **Quota is charged at ingest**, not at render: re-renders must cost nothing or reviewers
  stop fixing covers.
- **The frontend is planned, not present.** `docs/FRONTEND-PLAN.md` is the spec:
  React + TS + Vite in `frontend/`, TanStack Query, design tokens, routes and
  milestones. Do not add a view layer to `server/` and do not re-create
  `server/public/` — the previous server-rendered UI was deleted deliberately.
- **Wire plan changes through the database row, not a cached account object**: the
  operator can change the plan while the process runs, and quota must follow.
- Cache all fetched metadata and images under `data/art/` (SaaS) or `out/.cache/` (CLI)
  keyed by id/slug. Re-runs must cost zero API calls.
- Sleep between API calls to respect rate limits: 400 ms for RAWG, 3.2 s for
  OpenRouter, 6.5 s for Gemini.
- Every template slot must have a deterministic fallback built from RAWG data, so
  covers look identical whether or not a language model is configured.
- Never let a failed game abort a batch — record the error and move on.
- Every field `DEFAULT_CFG` declares must actually be wired from `lib/cover.mjs`'s config
  construction, or be read nowhere in `render.mjs` — an orphaned field on either side is
  dead. `edition` was defined but never drawn; `subtitle` was drawn but never populated.
- Cover styling is per project in the web app; the CLI reads `COVER_MARK`,
  `COVER_ACCENT`, `COVER_ADDRESS` (multi-line values need real newlines inside quotes —
  Node's `--env-file` does not turn a literal `\n` into one), `COVER_LAYOUT`,
  `COVER_EDITION`.

## Removing things

The game picker and the CLI review queue were removed on purpose: both were second front
doors onto flat files. Do not reintroduce a file-shaped workflow. If a feature needs a
list of games, it goes in the database.

## Commands

```
npm test           node:test suite (real server, ephemeral port, temp data dir)
npm run smoke      offline render check, no network or keys
npm run dev        API on :3000
npm start          same, without --env-file
npm run build      CLI: fetch, compose, auto-check games.txt
npm run rebuild    CLI: same, ignoring the cache
npm run prompts    CLI: write art prompts to art/<slug>/PROMPTS.md
npm run models     CLI: list OpenRouter free models
npm run print      CLI: A4 print sheet of approved covers
npm run plan       operator: set the local account's plan
npm run usage      operator: covers and projects used this month
```

Product docs: `docs/SAAS-PLAN.md` (architecture, security, roadmap) and
`docs/USER-STORIES.md` (personas, stories, acceptance criteria).
