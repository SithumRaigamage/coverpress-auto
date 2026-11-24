# Coverpress

Print-ready PS4/PS5 case inserts for the games you own digitally. Pick games from
RAWG and the app does the rest: it fetches metadata and art, picks the best-fitting
front image, drafts back-cover copy, renders a 300 DPI wrap, checks it, and either
auto-approves it or puts it in the review queue. There's no upload step and no typing.

```text
Web  ─── frontend/               React app on :5173, proxies /api to :3000
API  ─── server/index.mjs        JSON, local mode, no sessions
CLI  ─── pipeline.mjs            same renderer, no browser, no network needed
```

## Run it

```bash
npm install
cp .env.example .env      # add RAWG_KEY (free, https://rawg.io/apidocs)
npm run dev               # API on :3000 + web app on :5173, opens the browser
```

On macOS you can also double-click `Start Coverpress.command`.

The app runs on `127.0.0.1` only, with no sign-up, login or sessions. One local
account is created on first boot. Don't expose the port.

## How it flows

1. **Game library** (`/`): popular PS5/PS4 games from RAWG, or search with ⌘K.
   You can filter by platform, genre and year. Select several games and click
   **Batch-generate**, or click **Generate cover** on one.
2. **Game detail** (`/games/:id`): every art candidate from RAWG, SteamGridDB (if
   enabled) and AI generation (if enabled) at its true aspect ratio, each with a fit
   score against the 1512 × 1748 px front panel. The best fit is picked for you; click
   another tile to swap it. Choose PS5/PS4 and a Standard, Minimal or Raw-image layout.
   Edit the drafted back-cover copy inline, then click **Run all steps**.
   **AI generated art:** llama3.2 drafts an image prompt from the game's RAWG data.
   Edit it if you like, then click **Generate art** (2 images by default). The images
   appear in the grid with an "AI" tag.
3. **Pipeline run** (`/runs/:id`): eight steps with a live log, polled every second:
   fetch metadata, collect art, generate AI art (optional, off by default), pick front
   art, write copy, render, quality checks (deterministic checks plus llava), route.
   - **Replay run** makes a *new variant*: art this cover hasn't used, from a
     different source than last time (RAWG → SteamGridDB → AI), other back-panel
     screenshots, freshly seeded copy, and a new title position with a band colour
     sampled from the art. Once every SteamGridDB grid it knows has been used, it
     fetches SteamGridDB's next page, so reruns keep bringing new art.
   - **Run again with same art** only re-renders.
4. **Review queue** (`/review`): a five-column board (Queued, Building, Needs review,
   Approved, Failed). There is **one card per game and platform**; every run is a
   version on that card.
   - Switch between v1, v2, v3… and approve any of them. The approved version is the
     one that prints.
   - **Run again** makes a new variant. **Adjust** (zoom, offsets, title size)
     re-renders with the same art.
   - Keyboard: `J`/`K` move, `A` approves the shown version, `R` runs again.
   - Replacing the front art by upload is a hidden override on review cards only.
5. **Print sheets** (`/print`): one wrap per A4 landscape page at exactly 100%, with
   crop marks at the trim, dashed spine-fold marks and a 100 mm test ruler.
   **Print at 100% / Actual size, do not fit to page.**

A cover counts against the monthly quota once, when it is created. Re-running,
replaying, variants and re-rendering are free. With `DEV_MODE=true` (the default in
`.env.example`) there are no cover or shelf limits at all.

## Print size

PS4 and PS5 both use the Blu-ray keepcase. These numbers come from `CASE` in
`lib/render.mjs`, and the print sheet derives from them:

| Part | Size |
| --- | --- |
| Back panel | 128 × 148 mm |
| Spine | 14 mm |
| Front panel | 128 × 148 mm |
| Full wrap (trim) | 270 × 148 mm |
| With 3 mm bleed | 276 × 154 mm (3260 × 1819 px at 300 DPI) |

Tests assert the trim, the mm-only print CSS, and (in Playwright) that the printed wrap
measures 276 × 154 mm on an A4 landscape PDF page.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API (:3000) + web app (:5173), opens the browser |
| `npm run dev:api` / `npm run dev:web` | Either half on its own |
| `npm test` | API tests: real server, ephemeral port, temp data dir, no network |
| `npm run smoke` | Offline render check: 3260 × 1819 px wrap |
| `npm --prefix frontend test` | Frontend unit and component tests (Vitest) |
| `npm --prefix frontend run test:e2e` | Playwright: search → generate → run → approve → print, fully offline |
| `npm --prefix frontend run build` | Typecheck and build `frontend/dist` |

Before the first e2e run, install Playwright's browser once:
`npx --prefix frontend playwright install chromium`. The e2e suite boots the real API
from `frontend/e2e/server.mjs` with RAWG, SteamGridDB, Gemini, the image CDN and Ollama
stubbed, so it needs no keys and makes no network calls.

## Environment

All keys are read from `.env` at start-up and never reach the browser. The only
setting you can change in the UI is the pipeline's AI-art step. For everything else,
edit `.env` and restart.

| Variable | Purpose |
| --- | --- |
| `RAWG_KEY` | Required. Library, metadata, screenshots. 20,000 requests a month free; the sidebar meter counts the server's calls. |
| `SGDB_KEY` | Optional, **personal, non-commercial use only**. Adds SteamGridDB portrait grids and hero banners to the art picker. Leave it unset in any hosted or paid deployment. |
| `DEV_MODE` | `true` (default in `.env.example`): no cover or shelf limits. The plan code is kept for a future SaaS, only bypassed. The RAWG meter still applies. |
| `GEMINI_API_KEY` | Optional, **paid**. Enables AI-generated front art (Gemini image model). Off when unset. |
| `GEMINI_IMAGE_MODEL` | Image model ID (default `gemini-2.5-flash-image`). Change it if Google retires the model. |
| `GEMINI_GAP_MS` | Pause between Gemini calls in one press (default 6500) |
| `OLLAMA_HOST`, `OLLAMA_TEXT_MODEL` | Ollama is the only language model: `llama3.2` writes back-cover copy and AI-art prompts. The sidebar dot shows whether Ollama is actually reachable. |
| `OLLAMA_VISION_MODEL`, `VISION_REVIEW` | `llava` reviews each rendered front during quality checks (default on) |
| `PORT`, `HOST` | API bind address (default `127.0.0.1:3000`) |
| `DATA_DIR` | SQLite, art cache, renders (default `data/`) |

With Ollama unreachable, copy and art prompts are built from the RAWG description, so
every cover still completes.

## API additions for the UI

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/rawg/search?q&platform&genre&year&ordering&page` | Library page. An empty `q` lists popular PS5/PS4 games. Cached for 10 minutes. |
| GET | `/api/games/:rawgId` | Metadata, current back-cover copy, existing covers |
| GET | `/api/games/:rawgId/art` | Merged RAWG + SteamGridDB + AI candidates with `width`, `height`, `kind` and `fit` (0–100), best first |
| GET | `/api/games/:rawgId/ai-prompt` | The front-art prompt: your saved edit, or llama3.2's draft (RAWG fallback) |
| POST | `/api/games/:rawgId/ai-art` | `{ prompt, count }`: generate images with Gemini (default 2), cached under `data/art/generated/` |
| GET | `/api/generated/:rawgId/:file` | A generated image |
| POST | `/api/games/:rawgId/copy` | Draft back-cover copy with the LLM (cached), or fall back to RAWG |
| POST | `/api/games/:rawgId/covers` | `{ platform, style, artId?, copy?, projectId? }`: create, or re-run the existing cover for that game + platform |
| POST | `/api/covers/batch` | `{ games: [{ rawgId, name, platform }] }`: one cover per game + platform; existing ones get a new variant |
| GET | `/api/covers?projectId` | Every cover across shelves, each with its versions (the review board) |
| GET | `/api/covers/:id/versions` | Every version, newest first, with QC and the art used |
| POST | `/api/covers/:id/build` | `{ mode: "variant" \| "same" }`: new variant, or re-render with the same art |
| POST | `/api/covers/:id/decision` | `{ decision, renderId? }`: approve any version |
| GET | `/api/covers/:id/run` | Steps, log lines, render URLs and QC for the run screen |
| PUT | `/api/settings/pipeline` | `{ aiArt: boolean }`: the optional AI-art step |
| GET | `/api/runs` | Recent runs and the active count |
| DELETE | `/api/covers/:id` | A cover with every version, its art and its runs (409 while it is building) |
| POST | `/api/covers/delete` | `{ ids }`: several covers, e.g. a review column; building covers come back in `skipped` |
| DELETE | `/api/covers/:id/versions/:renderId` | One version. Never the last; deleting the approved one sends the cover back to review |
| DELETE | `/api/runs/:id` | One run from the history; a queued run is cancelled, a running one is refused |
| DELETE | `/api/runs` | Clear finished and failed runs; active runs stay |
| DELETE | `/api/projects/:id` | A shelf and every cover on it |
| DELETE | `/api/generated/:rawgId/:file` | One AI draft image |
| DELETE | `/api/games/:rawgId/ai-art` | Every AI image for a game (the saved prompt stays) |
| POST | `/api/reset` | `{ confirm: "DELETE", aiArt? }`: every shelf, cover, version and run; AI art too when `aiArt` is true |

RAWG detail, measured art sizes and SteamGridDB results are cached under
`data/art/cache/`, and generated images under `data/art/generated/`, so opening a game
or rebuilding a cover twice costs no API calls.

Every delete in the UI asks for confirmation first. Deleting a shelf with covers, and
Settings → Danger zone, also need `DELETE` typed. Settings, the RAWG cache and the
usage meters are never deleted.

On start-up the API merges any duplicate covers of the same game and platform into one
cover. Their renders become versions, and approvals are kept.

## CLI (offline batch)

```bash
npm run build      # fetch, compose, auto-check games.txt
npm run rebuild    # same, ignoring the cache
npm run print      # A4 print sheet of approved covers
npm run models     # list installed Ollama models
npm run plan studio   # change the local account's plan
npm run usage         # covers and projects used this month
```

## Data

SQLite, cached art, renders and the generated secret key live in `data/`. Back that
directory up.

Postman: `postman/coverpress-apis.json` has the exact RAWG and SteamGridDB calls and the
whole local API, including reruns (see `postman/README.md`).

Docs: `docs/FRONTEND-PLAN.md`, `docs/SAAS-PLAN.md`, `docs/LEGAL-AND-VIABILITY.md`,
`docs/USER-STORIES.md`.
