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
2. **Game detail** (`/games/:id`): every art candidate from RAWG (and SteamGridDB, if
   enabled) at its true aspect ratio, each with a fit score against the
   1512 × 1748 px front panel. The best fit is picked for you; click another tile to
   swap it. Choose PS5/PS4 and a Standard, Minimal or Raw-image layout. Edit the
   drafted back-cover copy inline, then click **Run all steps**.
3. **Pipeline run** (`/runs/:id`): seven steps with a live log, polled every second:
   fetch metadata, collect art, pick front art, write copy, render, quality checks,
   route. The real wrap appears as soon as it is rendered.
4. **Review queue** (`/review`): a five-column board (Queued, Building, Needs review,
   Approved, Failed). Approve or run again with the mouse or with `J`/`K`/`A`/`R`.
   Replacing the front art by upload is a hidden override on review cards only.
5. **Print sheets** (`/print`): one wrap per A4 landscape page at 276 × 154 mm. Print
   at 100% and measure 270 mm across the trim marks.

A cover counts against the monthly quota once, when it is created. Re-running,
replaying and re-rendering are free.

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
from `frontend/e2e/server.mjs` with RAWG, SteamGridDB, the image CDN and Ollama
stubbed, so it needs no keys and makes no network calls.

## Environment

All keys are read from `.env` at start-up and never reach the browser. Settings is
read-only; edit `.env` and restart to change anything.

| Variable | Purpose |
| --- | --- |
| `RAWG_KEY` | Required. Library, metadata, screenshots. 20,000 requests a month free; the sidebar meter counts the server's calls. |
| `SGDB_KEY` | Optional, **personal, non-commercial use only**. Adds SteamGridDB portrait grids and hero banners to the art picker. Leave it unset in any hosted or paid deployment. |
| `LLM_PROVIDER` | `ollama` (default, local, no key) or `openrouter` |
| `OLLAMA_HOST`, `OLLAMA_TEXT_MODEL` | Ollama for back-cover copy (default `llama3.2`). The sidebar dot shows whether Ollama is actually reachable. |
| `OPENROUTER_KEY`, `OPENROUTER_TEXT_MODEL` | Hosted alternative to Ollama |
| `PORT`, `HOST` | API bind address (default `127.0.0.1:3000`) |
| `DATA_DIR` | SQLite, art cache, renders (default `data/`) |

With no language model reachable, copy is built from the RAWG description, so every
cover still completes.

## API additions for the UI

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/rawg/search?q&platform&genre&year&ordering&page` | Library page. An empty `q` lists popular PS5/PS4 games. Cached for 10 minutes. |
| GET | `/api/games/:rawgId` | Metadata, current back-cover copy, existing covers |
| GET | `/api/games/:rawgId/art` | Merged RAWG + SteamGridDB candidates with `width`, `height`, `kind` and `fit` (0–100), best first |
| POST | `/api/games/:rawgId/copy` | Draft back-cover copy with the LLM (cached), or fall back to RAWG |
| POST | `/api/games/:rawgId/covers` | `{ platform, style, artId?, copy?, projectId? }`: create (or re-run) and enqueue |
| POST | `/api/covers/batch` | `{ games: [{ rawgId, name, platform }] }`: one cover per game |
| GET | `/api/covers?projectId` | Every cover across shelves (the review board) |
| GET | `/api/covers/:id/run` | Seven steps, log lines, render URLs and QC for the run screen |
| GET | `/api/runs` | Recent runs and the active count |

RAWG detail, measured art sizes and SteamGridDB results are cached under
`data/art/cache/`, so opening a game or rebuilding a cover twice costs no API calls.

## CLI (offline batch)

```bash
npm run build      # fetch, compose, auto-check games.txt
npm run rebuild    # same, ignoring the cache
npm run print      # A4 print sheet of approved covers
npm run models     # list Ollama / OpenRouter models
npm run plan studio   # change the local account's plan
npm run usage         # covers and projects used this month
```

## Data

SQLite, cached art, renders and the generated secret key live in `data/`. Back that
directory up.

Docs: `docs/FRONTEND-PLAN.md`, `docs/SAAS-PLAN.md`, `docs/LEGAL-AND-VIABILITY.md`,
`docs/USER-STORIES.md`.
