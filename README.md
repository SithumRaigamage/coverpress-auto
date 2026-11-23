# Coverpress

Print-ready PS4/PS5 case inserts for the games you own digitally. Import a list of
titles, bring artwork, and get 300 DPI wraps with the band, spine, back-cover copy,
spec chips, legal text and barcode already laid out — with the uncertain ones held back
for review instead of printed.

**Current state:** the API is finished and tested; the browser app is being rebuilt from
scratch. There is no HTML in this repository right now — `server/index.mjs` speaks JSON
only, and there is no sign-up or sign-in while it runs in single-account local mode.
The frontend specification is `docs/FRONTEND-PLAN.md`.

```
API  ─── server/index.mjs        JSON, local mode, no sessions
CLI  ─── pipeline.mjs            same renderer, no browser, no network needed
```

## API

```bash
npm install
cp .env.example .env        # optional
npm run dev                 # http://127.0.0.1:3000
```

```bash
curl -s localhost:3000/api/me
curl -s -X POST localhost:3000/api/projects \
  -H 'content-type: application/json' -d '{"name":"Shelf 2026","platform":"PS5"}'
curl -s -X POST localhost:3000/api/projects/<id>/import \
  -H 'content-type: application/json' -d '{"titles":"Bloodborne|PS5|manual"}'
curl -s -X PUT localhost:3000/api/covers/<coverId>/art/front \
  -H 'content-type: image/png' --data-binary @front.png
curl -s localhost:3000/api/projects/<id>/status
curl -s localhost:3000/api/projects/<id>/print
```

Uploading a front queues the build; the cover appears at `needs_review` or
`auto_approved` with its QC score, and its `wrapUrl` becomes printable.

### No auth, on purpose

Local mode uses one account (the oldest row in `accounts`, created on first boot).
That is fine on `127.0.0.1` and **not** fine on a public interface: every request is
that account. Do not bind `0.0.0.0` until accounts are switched back on. The schema
still carries `account_id` on every row, so restoring multi-user is a routing change,
not a migration.

- **Plan limits** — Free: 10 covers/month, 2 projects. Studio: 500 covers/month,
  50 projects. Enforced at import, so no provider quota is spent on covers that cannot
  be stored. `npm run plan studio` changes the local account's plan live.
- **Provider keys** — RAWG / OpenRouter keys are sealed with AES-256-GCM and used only
  server-side; no route returns a value. SteamGridDB is deliberately not connected:
  its terms are personal, non-commercial use only.
- **Legal** — `GET /api/legal` returns the acceptable-use text as data. Read
  `docs/LEGAL-AND-VIABILITY.md` before charging money.
- **Approval** — a cover is printable when it is `approved` (by hand) or
  `auto_approved` (zero QC warnings). A hand approval survives later rebuilds.
- **Print** — `GET /api/projects/:id/print` returns the page plan in millimetres
  (276 × 154 mm, 270 × 148 mm trim, one approved cover per A4 landscape page). The
  frontend renders it; the server no longer emits an HTML sheet.

Data lives in `data/` (SQLite, uploads, renders). Back that directory up.

## Tests

```bash
npm test        # node:test, real API on an ephemeral port, temp data dir
npm run smoke   # offline render check: 3260 x 1819 px wrap, no keys, no network
```

47 tests cover: the JSON-only surface (no page routes exist), single-account local mode,
project/cover CRUD, import and quota limits, upload validation by magic bytes, the build
queue → QC → render versioning, override whitelisting, decisions, print plan in
millimetres, sealed keys, cross-origin refusal and path traversal. Not covered by the
suite: provider calls (RAWG/OpenRouter) and the vision review — they need live keys.

## CLI

The offline harness for the renderer, and the only place SteamGridDB may be used
(personal, non-commercial use).

```bash
npm run build      # fetch, compose, auto-check games.txt
npm run rebuild    # same, ignoring the cache
npm run print      # A4 print sheet of approved covers
npm run prompts    # write art prompts to art/<slug>/PROMPTS.md
npm run models     # list OpenRouter free models
```

## How a cover is built

```
titles ─→ metadata (RAWG, optional) ─→ compose wrap ─→ auto-check ─┬─ auto_approved ─┐
             ↑                              ↑                      ├─ needs_review ──┼→ print plan
        art upload (always yours)      lib/cover.mjs              └─ failed         ┘
```

The renderer is millimetre-based and canvas-only (`lib/render.mjs`), the QC rules are
deterministic and pixel-sampled (`lib/qc.mjs`), and both are shared by the API and the
CLI — there is no second implementation to drift.

Docs: `docs/FRONTEND-PLAN.md` (the rebuild), `docs/SAAS-PLAN.md` (architecture,
security), `docs/LEGAL-AND-VIABILITY.md` (terms research), `docs/USER-STORIES.md`
(product requirements).
