# Coverpress Auto

Batch-generates print-ready PS4/PS5 case inserts for digital games. You give it a list of
titles; it fetches art and metadata, writes the back-cover copy, composes a 300 DPI wrap,
runs quality checks, and only sends the ones it isn't confident about to a manual queue.

```
games.txt ─→ fetch ─→ compose ─→ auto-check ─┬─ auto_approved ─┐
              ↑                              ├─ needs_review ──┼─→ print.html
           art/ (yours)                      └─ failed         ┘
```

## Quick start

```bash
npm install
cp .env.example .env       # add your keys
npm run models             # see which OpenRouter free models exist today
npm run build
npm run review             # http://localhost:5173
npm run print
```

Needs **Node 20.6+** (for `--env-file`).

## The APIs

| Service | Free tier | Role |
|---|---|---|
| **RAWG** | 20,000 req/month | Title matching, description, publisher, ESRB rating, screenshots. Requires a backlink credit — already printed on the back panel. |
| **SteamGridDB** | Free key | 600×900 portrait cover art. RAWG's image is 16:9 and gets badly cropped into the 128×148 mm panel. |
| **OpenRouter** | `:free` models — 20 req/min, 50 req/day (1,000/day after a one-time $10 credit purchase) | Back-cover copy, art prompts, and the automated visual review. |
| **Gemini** | Flash: 10 req/min, 1,500 req/day | Same jobs, if you'd rather use Google directly. |

Set `LLM_PROVIDER` to pick. Everything except RAWG is optional — without a language model
the blurb falls back to RAWG's description and the vision review is skipped.

**Which free model?** The `:free` list on OpenRouter rotates, so a hardcoded ID will
eventually 404. `npm run models` queries the live list and separates the ones that accept
image input (needed for `OPENROUTER_VISION_MODEL`) from text-only ones.

**Budget.** Two calls per game, so an unfunded OpenRouter account handles ~25 games a day.
The build sleeps 3.2 s between calls to stay under 20/min. Everything caches to
`out/.cache/`, so re-running is free — `npm run rebuild` forces a refetch.

## Custom art

No API generates images for free. Gemini's image API has no free tier, and Nano Banana 2
via Google AI Plus is the consumer app — no API behind it. So art comes in by hand:

```bash
npm run prompts             # or: npm run prompts -- --missing
```

That writes `out/prompts.md`: one image prompt per game, each with the exact filename to
save it as. Generate them in the Gemini app or Google Flow, drop the files into `art/`,
and re-run `npm run build`. Cached metadata means no API calls are spent.

- `art/<slug>.png` — front cover art
- `art/<slug>-back.png` — back panel background (optional)

Anything in `art/` beats SteamGridDB and RAWG, and is re-checked every build.

**When you generate:** ask for portrait **3:4** and the highest resolution offered. The
panel is 0.87:1, so a 3:4 image crops slightly top and bottom — keep the subject in the
central 80%. Leave the bottom third calm; that's where the title prints. The generated
prompts already say all this. They also ask for original artwork rather than recreations
of official covers or specific characters — Google's tools tend to refuse those anyway.

## The approval gate

**Deterministic checks** (`lib/qc.mjs`, no API calls): art below 1512×1748, landscape art
crushed into a portrait panel, title sitting on a bright region (sampled off the actual
rendered canvas), inexact RAWG match, overlong spine text, thin or overflowing copy, no
screenshots.

**Vision check** (optional): the rendered front panel goes to the model, which returns JSON
on legibility, clipping, crop and contrast. Runs only when nothing hard-failed, so quota
isn't spent on covers already known to be broken.

Result per cover: `auto_approved` (no warnings, score ≥ `AUTO_THRESHOLD`), `needs_review`,
or `failed`. In the review UI you can adjust title, size, zoom and framing, **Re-render**
off the cached images, and approve. Hand approvals survive later rebuilds.

## Printing

`npm run print` writes `out/print.html` — one A4 landscape page per approved cover, sized
in real millimetres. Open in Chrome, ⌘P:

- Paper **A4** (Letter is 279 mm wide and clips the 276 mm bleed wrap)
- Scale **Custom → 100**, never "Fit to printable area"
- Margins **None** or Default

Test on plain paper first and measure: 270 mm wide at the trim marks, 148 mm tall. Then
print on 180–250 gsm matte photo paper. Cut on the crop marks, score the spine folds
against a metal ruler, feed in from the top of the sleeve.

## Commands

```
npm run build      fetch, compose, auto-check
npm run rebuild    same, ignoring the cache
npm run prompts    write art prompts (-- --missing for games without custom art)
npm run models     list OpenRouter free models and which take images
npm run review     manual queue on :5173
npm run print      A4 print sheet of everything approved
```

## Caveat

Written but not executed — no network in the authoring environment. Syntax checks pass;
treat the first `build` as a shakedown run.
