# Coverpress — project context

Read this before writing any code. It contains measurements and API facts that are
easy to get wrong and expensive to get wrong late.

## What this is

A Node CLI that batch-generates print-ready PS4/PS5 case inserts for digital games.
Input is a list of game titles. Output is 300 DPI PNGs, quality-checked, with only
the uncertain ones sent to a manual review queue.

```
games.txt → fetch metadata + art → compose wrap → auto-check ─┬─ auto_approved ─┐
                    ↑                                         ├─ needs_review ──┼→ print.html
              art/ (hand-made)                                └─ failed         ┘
```

## Hard measurements — do not change these

PS4 and PS5 use the identical Blu-ray keepcase.

| Thing | Value |
| --- | --- |
| Panel | 128 × 148 mm |
| Spine | 14 mm (a movie Blu-ray is 12 mm — wrong for games) |
| Full wrap | 270 × 148 mm |
| At 300 DPI | 3189 × 1748 px |
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
| SteamGridDB | Free key, Bearer auth | 600×900 portrait grids. The single biggest quality lever. **Caveat:** the "grid" category is often an actual finished retail box art crop, complete with the game's real logo lockup baked into the pixels — that directly conflicts with the trademark constraint above. There's no metadata flag for this; the only reliable fix is switching that game to `custom` mode with generated or hand-made art. |
| OpenRouter | `:free` models — 20 req/min, 50 req/day unfunded, 1,000/day after a one-time $10 purchase | Back-cover copy, art prompts, vision review. |
| Gemini | Flash models, 10 req/min, 1,500 req/day | Same jobs, alternative provider. |

**No free image generation exists.** Gemini's image API has no free tier and
`gemini-2.5-flash-image-preview` was retired on 15 Jan 2026. Nano Banana 2 via Google
AI Plus is the consumer app only — no API. So custom art is a **drop-in folder**
(`art/<slug>.png`), never a pipeline API step. Do not write code that tries to
generate images.

Which OpenRouter models carry `:free` rotates. Never hardcode a model ID as the only
option — provide a command that queries `/api/v1/models` and filters for `:free`,
separating those whose `architecture.input_modalities` includes `image`.

## Conventions

- ES modules, `"type": "module"`, Node 20.6+ (npm scripts use `--env-file=.env`).
- One runtime dependency: `@napi-rs/canvas`. Do not add others.
- `path.dirname(fileURLToPath(import.meta.url))` for the project root — never
  `new URL(...).pathname`, which breaks on Windows.
- Cache all fetched metadata and images under `out/.cache/` keyed by slug. Re-runs
  must cost zero API calls. A `--force` flag bypasses it.
- Sleep between API calls to respect rate limits: 400 ms for RAWG, 3.2 s for
  OpenRouter, 6.5 s for Gemini.
- Every template slot must have a deterministic fallback built from RAWG data, so
  covers look identical whether or not a language model is configured.
- Never let a failed game abort the batch — record the error in the manifest and move on.
- Every field `DEFAULT_CFG` declares must actually be wired from `pipeline.mjs`'s config
  construction, or read nowhere in `render.mjs` — an orphaned field on either side is
  dead: it either silently produces no output (renderer never reads it) or can never be
  set (pipeline never populates it). `edition` was defined but never drawn; `subtitle`
  was drawn but never populated — same bug from two directions.
- Cover styling is overridable per-run via env: `COVER_MARK`, `COVER_ACCENT`,
  `COVER_ADDRESS` (multi-line values need real newlines inside quotes — Node's
  `--env-file` does not turn a literal `\n` into one), `COVER_LAYOUT`, `COVER_EDITION`.
  All have working defaults; none are required.

## Commands to end up with

```
npm run smoke      offline render check, no network or keys
npm run build      fetch, compose, auto-check
npm run rebuild    same, ignoring cache
npm run prompts    write art prompts for the Gemini app
npm run models     list OpenRouter free models
npm run review     manual queue on :5173
npm run print      A4 print sheet of approved covers
```
