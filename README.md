# Coverpress Auto

Batch-generates print-ready PS4/PS5 case inserts for digital games. You give it a list of
titles; it fetches art and metadata, writes the back-cover copy, generates art prompts for
custom covers, composes a 300 DPI wrap, runs quality checks, and only sends the ones it
isn't confident about to a manual queue.

```
games.txt ─→ fetch + LLM copy + LLM art prompts ─→ compose ─→ auto-check ─┬─ auto_approved ─┐
              ↑                                        ↑                     ├─ needs_review ──┼─→ print.html
           RAWG + SteamGridDB                  art/<slug>/ (yours)          └─ failed         ┘
```

## Quick start

```bash
npm install
cp .env.example .env       # add your keys
npm run build              # fetch + LLM + compose — also writes art/<slug>/PROMPTS.md
npm run review             # http://localhost:5173
npm run print
```

Needs **Node 20.6+** (for `--env-file`).

## `games.txt` format

One per line: `Title | Platform | mode`

| Field | Values | Default |
|---|---|---|
| Title | anything RAWG can find | — |
| Platform | `PS4`, `PS5` | `PS5` |
| mode | `custom` (recommended), `auto` | `custom` |

- **`custom`** — your art from `art/<slug>/` is used. If `front.png` is missing, the pipeline logs a warning and falls back to scraped art, so the build still succeeds.
- **`auto`** — always use SteamGridDB / RAWG art.

## The APIs

| Service | Free tier | Role |
|---|---|---|
| **RAWG** | 20,000 req/month | Title matching, description, publisher, ESRB rating, screenshots. Requires a backlink credit — already printed on the back panel. |
| **SteamGridDB** | Free key | 600×900 portrait cover art. RAWG's image is 16:9 and gets badly cropped into the 128×148 mm panel. |
| **OpenRouter** | `:free` models — 20 req/min, 50 req/day (1,000/day after a one-time $10 credit purchase) | Back-cover copy, art prompts, and the automated visual review. |

Everything except RAWG is optional — without a language model the blurb falls back to
RAWG's description and the vision review is skipped.

**Which free model?** The `:free` list on OpenRouter rotates, so a hardcoded ID will
eventually 404. `npm run models` queries the live list and separates the ones that accept
image input (needed for `OPENROUTER_VISION_MODEL`) from text-only ones.

**Budget.** Three calls per game on first build (copy, art prompts, vision review), one
on rebuild (vision only). An unfunded OpenRouter account handles ~16 games a day.
The build sleeps 3.2 s between calls to stay under 20/min. Everything caches to
`out/.cache/` and `out/<slug>/PROMPTS.json`, so re-running is free — `npm run rebuild`
forces a refetch.

## Custom art workflow

Every `npm run build` writes art-generation prompts to `art/<slug>/PROMPTS.md` — one
prompt for the front cover, one for the back panel background, and three for gameplay
screenshots. No separate command needed. The build also renders a cover from auto art
(RAWG + SteamGridDB) immediately so you can see the layout while generating custom art.

To swap in your own art:

1. Open `art/<slug>/PROMPTS.md` and paste each prompt into Google Flow / Gemini
2. Save the images into `art/<slug>/` at the filenames listed in the table below
3. Run `npm run build` again — anything in `art/<slug>/` wins over fetched art

### Art folder layout

```
art/<slug>/
├── PROMPTS.md             ← copy-pasteable prompts (regenerated on build)
├── front.png              ← main cover art (1512×1748 px, 3:4 portrait)
├── back.png               ← back panel background (optional)
└── shots/
    ├── 0.jpg              ← screenshot 1 (721×406 px, 16:9)
    ├── 1.jpg              ← screenshot 2
    └── 2.jpg              ← screenshot 3
```

Missing slots fall back gracefully:

| Missing | Falls back to |
|---|---|
| `front.png` in `custom` mode | SteamGridDB / RAWG art |
| `back.png` | Uses `front.png` as the back panel background |
| `shots/` | RAWG screenshots |

**When you generate:** ask for portrait **3:4** and the highest resolution offered. The
panel is 0.87:1, so a 3:4 image crops slightly top and bottom — keep the subject in
the central 80%. Leave the bottom third calm; that's where the title prints. The generated
prompts already say all this. They also ask for original artwork rather than recreations
of official covers or specific characters — most image tools refuse those anyway.

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
npm run build      fetch, LLM copy, write art prompts, compose, auto-check
npm run rebuild    same, ignoring the cache
npm run prompts    regenerate art/<slug>/PROMPTS.md (-- --missing: games without custom art)
npm run models     list OpenRouter free models and which take images
npm run review     manual queue on :5173
npm run print      A4 print sheet of everything approved
```
