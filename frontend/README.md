# Coverpress frontend

The browser workbench for the Coverpress JSON API. It follows
[`docs/FRONTEND-PLAN.md`](../docs/FRONTEND-PLAN.md): a light "print workshop"
(paper, ink, one accent, real cover art doing the talking), not a dashboard.

## Run locally

```bash
# terminal 1 — the API (:3000)
npm run dev:api      # from the repo root

# terminal 2 — this app (:5173)
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:3000`, so there is no CORS and no
second origin. There are no network font requests: Barlow Condensed, Inter and
JetBrains Mono are named first with system fallbacks behind them.

```bash
npm run typecheck    # tsc --noEmit
npm test             # Vitest (lib formatting and schemas)
npm run build        # typecheck + production build to dist/
npm run preview      # serve the built app locally (API still required)
```

## Routes

| Route | Screen |
| --- | --- |
| `/` | Shelves: cards with 3:4 mosaics, inline create, usage summary |
| `/shelves/:id` | Shelf: cover grid, import, house style, build-all + progress polling |
| `/shelves/:id/review?cover=:id` | Review: rail, stage (wrap/front/back/spine, 1:1), QC, adjustments |
| `/shelves/:id/print` | Print: 276 × 154 mm sheets, 100% A4 landscape print stylesheet |
| `/settings` | Plan, usage, provider keys, optional LLM config, data location |
| `/legal` | Rendered `/api/legal` document |

## Code map

```
src/app/         router (React Router 7 data mode), providers, shell
src/api/         client (the only fetch surface), DTO types, queries, mutations
src/features/    shelves, covers, review, print, settings, legal
src/components/  Button, Field, Chip, Meter, Dialog, Toast, Tooltip primitives
src/lib/         format, polling, Zod schemas, cn
src/styles/      design tokens + base/print CSS
```

Components never call `fetch`; only `src/api/*` does. Screens use TanStack Query
hooks, which own polling (status stops when `pending === 0`; review backs off
1.2 s → 5 s while a cover renders) and invalidation after mutations. Quota is
charged at import — re-renders are deliberately labelled "free" in the UI.

## Notes

- `/api/settings/llm`, `PUT /api/settings/llm` and `/api/settings/models` are
  supported when the API build exposes them; model discovery is an explicit
  "Check connection" action, never a background call.
- Cover art is always uploaded by the customer. There is no SteamGridDB key
  field, image generation step, share affordance or print-fulfilment flow.
- The renderer accepts only top/bottom title anchors and 7–26 mm title sizes;
  the review form exposes the 12–24 mm range the spec calls for, and the server
  clamps anything else.
- Initial JS is code-split by route and stays under the 180 kB gzipped budget.
