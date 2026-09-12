# Prompts for Claude Code

Run these in order, one per turn. Verify the checkpoint after each before moving on —
a wrong measurement in step 2 is cheap to fix and very expensive to find in step 6.

`CLAUDE.md` sits in the project root and is read automatically, so none of these
prompts need to repeat the measurements.

---

## 1 — Scaffold

```
Read CLAUDE.md, then scaffold the project: package.json (ESM, engines node >=20.6,
one dependency @napi-rs/canvas, npm scripts for smoke/build/rebuild/prompts/models/
review/print all using --env-file=.env except smoke), .env.example with every key and
setting documented inline, .gitignore excluding node_modules, out, .env and art/*
except art/README.txt, a games.txt with four example lines, and empty lib/ and review/
directories. No source code yet.
```

Checkpoint: `npm install` succeeds and `node -e "console.log('ok')"` runs.

---

## 2 — Renderer

```
Write lib/render.mjs. It exports DPMM, CASE, FONTS, DEFAULT_CFG, DEFAULT_SPECS and
renderScene(ctx, cfg, art, {bleed, cropMarks}), plus drawCover and wrapLines helpers.

Everything draws in millimetres per CLAUDE.md. Implement the full layout anatomy:
12mm top band across all three panels, front panel with top-anchored title over a
scrim, rotated spine, and the back panel with tagline, 44mm screenshot column,
feature bullets, and the bottom block at y=108 containing spec chips, credit line,
legal text, and a row of rating box, address and barcode.

Do not hardcode a line count for the legal text. Derive the max lines from the actual
vertical gap between where the legal text starts and where the bottom row (rating box,
address, barcode) begins — a fixed count like "5 lines" will fit short legal text fine
and silently overlap the row below the first time someone lengthens it.

Draw the spec glyphs (player, disc, controller, download, HD) as vector paths in a
single glyph() function. The rating box is a plain bordered box with a letter and the
word RATING — not any rating board's actual mark. The barcode is a deterministic
pattern seeded from a hash of the title.

Title text must auto-fit: shrink the font until it fits the given line count.

Take no imports except from within this file. It must run unmodified in both Node
and a browser.
```

Checkpoint: `node --check lib/render.mjs`.

---

## 3 — Offline smoke test

```
Write smoke.mjs. It renders one wrap using a procedurally generated 1512x1748
gradient image as stand-in art, with no network and no API keys, writes out/smoke.png,
and prints the canvas dimensions against the expected 3260x1819 (270+6 x 148+6 mm at
300 DPI with 3mm bleed — both dimensions get the bleed added, not just the width).

Also measure whether the condensed title font actually resolved, by comparing
measureText width for "Arial Narrow" against generic sans-serif, and report it.
```

Checkpoint: `npm run smoke`, then **open `out/smoke.png` and look at it**. Fix the
layout here, while iteration is free. Do not proceed until it looks right.

---

## 4 — Data sources

```
Write lib/sources.mjs exporting rawgLookup, sgdbCover, llmCopy, llmReview,
llmArtPrompt, listFreeModels and fetchBuffer.

rawgLookup searches by title filtered to the platform ID (PS4=18, PS5=187), prefers an
exact normalised name match over RAWG's relevance ordering, then fetches detail and
screenshots. Return a flat object including an exactMatch boolean and an ESRB letter
mapped to a short rating string.

The LLM layer is provider-agnostic behind one internal chat(parts, opts) function
supporting both OpenRouter's OpenAI-compatible /chat/completions and Gemini's
generateContent. parts is an array of {text} and/or {image: Buffer} so the same
function serves the copywriting and the vision review.

llmArtPrompt writes an image-generation prompt for a human to paste into the Gemini
app. It must instruct: original artwork only, never named characters or existing
official covers; portrait 3:4; subject in the central 80%; bottom third calm for the
title; no text or lettering in the image. Include a template fallback that works with
no LLM key at all.

listFreeModels queries OpenRouter /api/v1/models and returns :free models flagged by
whether they accept image input.

Retry 429 and 5xx with backoff. Every JSON parse must tolerate markdown fences.
```

Checkpoint: `node --check lib/sources.mjs`.

---

## 5 — Quality control

```
Write lib/qc.mjs exporting runChecks and mergeVision.

runChecks takes the config, RAWG metadata, loaded art and the rendered canvas context.
Checks: source art below 1512x1748, landscape art crushed into the portrait panel,
inexact RAWG match, empty title, spine text over 46 chars, blurb under 25 or over 130
words, no screenshots. Plus a contrast check that reads real pixels off the rendered
canvas behind the title block via getImageData and warns if mean luminance exceeds 150.

Return {issues, fails, warns, score, status} where status is failed / needs_review /
auto_approved. Auto-approve requires zero warnings.

mergeVision folds a vision model's JSON verdict into that result and re-derives status
against a score threshold.
```

Checkpoint: `node --check lib/qc.mjs`.

---

## 6 — Pipeline

```
Write pipeline.mjs with subcommands build, review, print, prompts and models.

build reads games.txt ("Title | PS4"), and per game: RAWG lookup, SteamGridDB grid,
download art and up to 3 screenshots, LLM copy, then compose the config from
DEFAULT_CFG. Every slot needs a deterministic fallback from RAWG data — tagline from
genres and year, bullets from genres plus release year plus Metacritic — so output is
identical with or without an LLM.

art/<slug>.png and art/<slug>-back.png override fetched art and are re-checked on
every build, cache or no cache.

Render at 300 DPI to out/<slug>/wrap.png, crop a 600px-wide front panel to
out/<slug>/front.png for review thumbnails and the vision check, run QC, and write
everything to out/manifest.json. A cover previously approved by hand keeps its
decision across rebuilds. COVER_LAYOUT=auto|ps4|ps5 either follows each game's platform
or forces one look across the shelf.

A failed game logs and continues; it does not abort the batch.
```

Checkpoint: `npm run build` with only `RAWG_KEY` set and one game in `games.txt`.

---

## 7 — Review queue

```
Add the review subcommand: a plain node:http server on :5173 serving review/index.html,
GET /api/manifest, POST /api/decide, and static files from out/.

review/index.html is a single file, no build step, no framework. It lists covers
filtered by status (defaulting to needs_review), shows the rendered wrap next to its
QC issues, and offers sliders for title size, zoom and framing plus a title field.
Re-render posts the changed config, re-renders server-side from the cached source
images with no API calls, and reloads. Approve and Reject write the decision to the
manifest.

Style it flat and light — no dark theme, no shadows, hairline borders.
```

Checkpoint: `npm run review`, adjust a slider, hit re-render, confirm the image changes.

---

## 8 — Print output

```
Add the print subcommand. Collect everything approved (explicit approval, or
auto_approved and not rejected) and write out/print.html: one A4 landscape page per
cover with @page size A4 landscape, the wrap img sized in real millimetres, and a
caption naming the game and reminding to print at 100%. Page-break after each.
```

Checkpoint: `npm run print`, open in Chrome, print one page at Scale 100 on plain
paper, measure 270 mm across the trim marks with a ruler.

---

## 9 — Hardening

```
Review the whole project for these specific risks and fix what you find:
- any place a failed API call can abort the batch instead of recording and continuing
- any hardcoded model ID with no fallback path
- rate limit sleeps missing between calls
- cache keys that collide between the same game on PS4 and PS5
- getImageData being called on a context whose transform makes the coordinates wrong
- files written outside out/ from a user-supplied slug

Then write README.md covering setup, keys, the approval gate and printing.
```
