# Coverpress — SaaS plan

Written from the existing CLI (v1) to a shippable v2. Sections marked **shipped** are in
this tree and covered by `npm test`.

## 1. Analysis: what the CLI is good at, and what blocks a product

| Area | v1 reality | Consequence for a SaaS |
| --- | --- | --- |
| Entry point | `games.txt` + `npm run build` on the user's laptop | Non-technical buyers cannot start. The work list has to live in a database. |
| Identity | None — one user, one `out/` folder | No way to sell seats, meter usage, or stop one customer seeing another's covers. |
| Review | `node pipeline.mjs review` on :5173, reading `out/manifest.json` | Ties review to the machine that built the covers. Approvals vanish if the folder is lost. |
| Art | Drop files into `art/<slug>/` | Fine locally; impossible for a customer who has no shell. Needs upload. |
| Provider keys | `.env` on the machine | Per-customer keys must be stored per account, encrypted, never shown again. One shared key would burn the operator's RAWG quota and leak in support screenshots. |
| Rendering | Solid: millimetre-precise, 300 DPI, deterministic QC | **Reusable as-is.** This is the product; everything else was scaffolding. |
| Failure handling | Failed game logs and continues | Right idea, but the user never sees *why* unless they read a terminal. |
| Duplicate UIs | Game picker (:5174) and review queue (:5173) wrote/read flat files | Two front doors for the same data. Removed. |

The renderer, QC rules, provider adapters and print sheet were worth keeping. The
file-shaped workflow around them was not.

## 2. Packaging and pricing

The cost driver is not CPU — it is provider quota and the operator's support time.

| Plan | Price | Covers / month | Projects | Notes |
| --- | --- | --- | --- | --- |
| Free | $0 | 10 | 2 | Manual art + your own RAWG key. Enough to finish one shelf. |
| Studio | $19 / mo | 500 | 50 | Same engine, more room; the upgrade path out of the free cap. |

Decisions:

- **Charge on ingest, not on render.** Re-renders are CPU-only and must stay free, or
  reviewers stop fixing covers. `usage_events(kind='cover.created')` is the meter.
- **Bring your own provider keys.** RAWG's free tier is 20k requests/month and its
  licence requires attribution; reselling it would be a licensing problem, not just a
  cost one. Keys are stored per account and sealed with AES-256-GCM.
- **No SteamGridDB in the hosted product.** Its terms are personal/non-commercial only,
  and its grids frequently contain retail logo lockups. The local app may opt in with
  `SGDB_KEY`; a hosted deployment must leave it unset.
  See `docs/LEGAL-AND-VIABILITY.md` for the full legal position and what it costs.
- **Billing is deliberately manual in v2.** `server/cli.mjs plan <email> studio` records
  the upgrade; a payment provider is the first item in M1. Shipping a fake checkout is
  worse than an honest invoice.

## 3. Removals (shipped)

| Removed | Why |
| --- | --- |
| `picker/index.html` + `pipeline.mjs select` | A second way to edit `games.txt`. The web app owns titles now. |
| `review/index.html` + `pipeline.mjs review` | Read `out/manifest.json`; replaced by the authenticated review queue. |
| `test-picker.mjs` | Imported `@playwright/browser`, which was never a dependency — it could not run. |
| `INPUTS.md`, `PROMPTS.md` | Build-history notes for the CLI handoff; not product documentation. |
| `pipeline.mjs`'s inline config builder | Duplicated `lib/cover.mjs`; drift between the two is how `edition`/`subtitle` broke before. |
| `npm run dev` → `select` | The name now runs the actual product. |

Kept on purpose: `npm run smoke` (offline render check), `build/rebuild`, `prompts`,
`models`, `print`. The CLI is the engine harness — it proves the renderer without a
browser and is what an operator uses to reproduce a customer's cover locally.

## 4. Architecture (shipped)

One Node process, one dependency (`@napi-rs/canvas`), Node ≥ 22.5 for `node:sqlite`.

```
client ──HTTP/JSON──> server/index.mjs ──> repo.mjs ──> SQLite (data/coverpress.sqlite)
                        │                   │
                        │                   └── usage_events  (quota meter)
                        ├── jobs.mjs  (queue table + one in-process worker)
                        │        └── build.mjs ──> lib/cover.mjs ──> @napi-rs/canvas
                        │                                  └── lib/qc.mjs
                        └── legal.mjs (acceptable use as data)
                                     data/art/<account>/<cover>/…  (uploads + fetched)
                                     data/renders/<renderId>/wrap.png + front.png
```

Why this shape:

- **SQLite over a hosted database.** The product renders CPU-bound PNGs on a Node
  process; it is not going serverless. WAL-mode SQLite handles a single-box SaaS and
  keeps the "one runtime dependency" rule. `repo.mjs` is the only SQL surface, so a
  Postgres move later is one file.
- **JSON API, separate client.** The server has no view layer, so the presentation can
  be rebuilt without touching rendering, quota or the queue. The client is a Vite app
  in `frontend/` (spec: `docs/FRONTEND-PLAN.md`). In development Vite proxies `/api` to
  the Node process, so there is one origin and no CORS.
- **An in-process worker.** A render is ~1 s of CPU; parallel workers on one vCPU just
  fight. Jobs are rows, so scaling out later means running another process that claims
  from the same table.
- **Versioned renders.** Every build writes a new `renders` row and keeps the last five.
  A reviewer can compare, and `print` always uses the newest row.

## 5. Data model

```
accounts ─┬─ provider_keys (sealed, per provider)
          ├─ usage_events (quota meter)
          └─ projects ─── covers ─┬─ art (front/back/shot0..2)
                                  ├─ renders (version, wrap/front PNG, cfg, qc)
                                  └─ jobs (queued/running/done/failed)
```

Isolation rule: **no query looks up a cover, project or render by id alone.**
`repo.getCover`, `getProject`, `getRender` and every list query join through
`projects.account_id`. `tests/data.test.mjs` asserts those lookups return null across
accounts. Local mode currently has one account, so the isolation is a storage
invariant rather than a per-request identity.

## 6. Security decisions

| Risk | Mitigation |
| --- | --- |
| Exposure of a local-mode deployment | **No auth in local mode.** Loopback binding is the boundary; never publish the port until accounts return. |
| CSRF | Mutations refuse a cross-site `Origin`/`Sec-Fetch-Site`; JSON-only bodies mean no form posts. |
| Provider key leakage | AES-256-GCM under `APP_SECRET` (or a `0600` key file); values are never re-rendered, only `set`/`not set`. |
| Uploaded HTML/SVG | Magic-byte sniffing (PNG/JPEG/WebP only) plus a decode check; no SVG. |
| Path traversal | Stored paths are data-dir-relative and resolved through `safeJoin`; render filenames are an allowlist. |
| Cross-tenant reads | Ownership join on every query; tested. |
| XSS | The API returns JSON with `nosniff`, and titles are only ever text in a JSON string. |
| Client tampering with print geometry | Review overrides are whitelisted and clamped; `panelW`/`spine` can never be set by a request. |

## 7. Known limits (honest)

- **Single node.** No S3, no multi-worker, no zero-downtime deploy. Data lives on disk;
  back up `data/`.
- **No payment provider.** Upgrades are operator actions via `server/cli.mjs`.
- **No email.** No verification, no password reset; support resets manually.
- **One worker, sequential.** A 200-cover import queues for minutes; the UI polls.
- **No teams.** One account owns its projects; sharing is M2.
- **Trademark posture unchanged.** The renderer draws generic marks only. There is no
  third-party image library in the hosted app at all — front art must be uploaded,
  which is both the quality lever and the legal one.
- **RAWG commercial terms need confirming.** Their docs permit small commercial use;
  their pricing page sells commercial use as a $149/mo Business plan. Budget for it or
  get written confirmation.
- **No automated billing, so no refunds flow yet.** Refund handling is manual until M1.

## 8. Roadmap

**M0 — this release:** accounts, projects, import, upload, queue, render, QC, review,
approve, print sheet, quotas, per-account keys, tests.

**M1 — sell it:** Stripe subscriptions (checkout + webhook → `plan`), email
verification and reset, transactional email on build failure, PDF export of the sheet.

**M2 — teams:** workspace = account with members and roles (owner/reviewer), shared
project access, audit trail on decisions.

**M3 — scale:** object storage for art/renders, Postgres, N workers, per-account rate
limits on provider calls, structured logs and a job dashboard.

## 9. Presentation layer

The server-rendered UI was removed and is being rebuilt as a client app. This
section records only what the API guarantees to any client; the design itself lives
in `docs/FRONTEND-PLAN.md`.

- **The API is the product boundary.** JSON only, no templates, no static client
  files under `server/`. Errors are `{ error }` with a 4xx/5xx status, so a client
  never has to parse an HTML error page.
- **Local mode has no auth.** One account, resolved at boot, every request acts as
  it. Bind loopback only. `account_id` remains on every row, so multi-user is a
  routing change later.
- **Async work is polled, not pushed.** Mutations return `202 { jobId, pending }`;
  `GET /api/projects/:id/status` is the polling endpoint. No SSE/WebSocket yet.
- **The print plan is data.** `GET /api/projects/:id/print` returns page geometry in
  millimetres; the client renders the sheet and prints at 100%.
- **Assets are stable URLs** (`/api/renders/:id/wrap.png`, `private, max-age=60`), so
  a client can cache and diff renders by `renderId`.

Decisions that survive from the old UI because they are domain facts, not taste:
cover thumbnails are 3:4 (not 16:9), review is comparative (rail + one stage), the
cover grid is the main object, and progress must update in place.

## 10. Metrics that decide whether this works

- Activation: % of signups that upload one front art and get an approved cover.
- Time to first print-ready cover (target: under 10 minutes).
- Review rate: share of covers needing a human. Rising means art sourcing got worse.
- Re-render rate per approved cover (quality of the first pass).
- Free → Studio conversion after the 10-cover cap is hit.
- Monthly covers per active account (the real usage signal).
