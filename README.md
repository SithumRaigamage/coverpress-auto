# Coverpress

Print-ready PS4/PS5 case inserts for the games you own digitally. Import a list of
titles, and the app fetches metadata and art automatically, renders 300 DPI wraps,
and holds uncertain covers for review before printing.

```
Web  ─── frontend/               React app on :5173, proxies /api to :3000
API  ─── server/index.mjs        JSON, local mode, no sessions
CLI  ─── pipeline.mjs            same renderer, no browser, no network needed
```

## Run the web app (one command)

**macOS:** Double-click `Start Coverpress.command`. It starts the API, waits for it
to be ready, starts the web app, and opens your browser at `http://127.0.0.1:5173`.

**Terminal (equivalent):**

```bash
# 1. Install dependencies (once)
npm install

# 2. Copy the env template (optional — Ollama needs no key)
cp .env.example .env

# 3. Start API + web app, browser opens automatically
npm run dev
```

The app runs entirely on `127.0.0.1`. No sign-up, no login, no sessions — one local
account is created on first boot.

## Run from the terminal only

| Command | What it does |
| --- | --- |
| `npm run dev` | Start API (:3000) + web app (:5173), open browser |
| `npm run dev:api` | Start API only (:3000) |
| `npm run dev:web` | Start web app only (:5173, API must already be running) |
| `npm run serve` | Serve the built frontend on :8080 (production-style, API proxied) |
| `npm test` | Run the test suite (real API, ephemeral port, temp data dir) |
| `npm run smoke` | Offline render check: 3260 × 1819 px wrap, no keys, no network |

## Import games automatically

### Search and import from RAWG (no typing)

Open a shelf and click **Browse RAWG**. Search the RAWG catalog using the key you
saved in **Settings → Provider Keys** (or `RAWG_KEY` in `.env`), pick as many games
as you like, and click **Import games**. Selected titles go straight through the
automatic pipeline — metadata fetch, screenshots, render, review. No typing and no
manual image upload.

The browser calls `GET /api/rawg/search?q=<query>&platform=PS5|PS4`. It needs a
configured RAWG key; without one the API returns a guidance error. SteamGridDB is
deliberately not part of this flow (see below).

### Paste titles (manual entry)

You can still paste titles in the import panel on a shelf:

```
Elden Ring | PS5 | auto
Hollow Knight | PS5 | auto
Celeste | PS4 | manual
```

- `auto` — fetches RAWG metadata and screenshots, renders, and sends to review. No
  manual upload needed.
- `manual` — creates the cover without fetching; you upload front art yourself.

Each cover lands in **review** (`needs_review`) where you can adjust the title,
anchor, zoom, offsets, edition line and ribbon, then **Approve** or **Reject**.
If you don't approve, click **"Run all steps again"** to re-fetch metadata/art,
re-render, and return to review with a new version.

Approved covers become printable; the print screen lays them out one per A4
landscape page at the correct millimetres.

## First-time setup (recommended)

```bash
# Install Ollama and pull models (local LLM, no key, no quota)
ollama pull llama3.2
ollama pull llava

# Get a free RAWG key (20,000 requests/month) for metadata/screenshots
# https://rawg.io/apidocs
# Add it to .env or paste it in Settings → Provider Keys in the web app.
```

SteamGridDB is **not** connected in the web app — its Terms of Use allow personal,
non-commercial use only. It remains available in the offline CLI and in the
Postman collection (`postman/coverpress-apis.json`) for direct API testing.

## Environment

Copy `.env.example` to `.env` and fill in what you need:

| Variable | Purpose |
| --- | --- |
| `RAWG_KEY` | RAWG.io API key for metadata/screenshots (web app + CLI) |
| `OLLAMA_HOST` | Ollama URL (default `http://127.0.0.1:11434`) |
| `OLLAMA_TEXT_MODEL` | Text model for back-cover copy (default `llama3.2`) |
| `OLLAMA_VISION_MODEL` | Vision model for QC review (default `llava`) |
| `OPENROUTER_KEY` | Optional hosted alternative to Ollama |
| `PORT`, `HOST` | API bind address (default `127.0.0.1:3000`) |
| `DATA_DIR` | Where SQLite, uploads and renders live (default `data/`) |

## CLI (offline batch)

```bash
npm run build      # fetch, compose, auto-check games.txt
npm run rebuild    # same, ignoring the cache
npm run print      # A4 print sheet of approved covers
npm run prompts    # write art prompts to art/<slug>/PROMPTS.md
npm run models     # list installed Ollama models (or OpenRouter :free models)
npm run plan studio   # change the local account's plan
npm run usage        # show covers/projects used this month
```

`games.txt` format: `Title | Platform | mode` where mode is `auto` or `manual`.

## Data

SQLite, uploads, renders and the generated secret key live in `data/`. Back that
directory up — it contains all your covers, decisions and render history.

## Tests

```bash
npm test        # 57 tests, real API on ephemeral port, temp data dir
npm run smoke   # offline render check, no keys, no network
```

Docs: `docs/FRONTEND-PLAN.md`, `docs/SAAS-PLAN.md`, `docs/LEGAL-AND-VIABILITY.md`,
`docs/USER-STORIES.md`.
