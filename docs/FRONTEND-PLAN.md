# Frontend plan

Status: **built** (branch `ui-rebuild`). This replaces the earlier "print workshop"
plan: the light paper/ink shelf UI with manual uploads was deleted and rebuilt as a dark,
SaaS-style app whose main flow is fully automated. Read this before changing frontend
code.

---

## 1. Principles

- **Automated by default.** Picking a game, or a batch, creates the cover, enqueues the
  build, opens the run screen, and ends auto-approved or in review. No upload step and
  no typed titles. The upload endpoint survives only as a hidden override on review
  cards.
- **Millimetres are the truth.** The wrap is 270 × 148 mm (276 × 154 with 3 mm bleed),
  the panel is 128 × 148 mm (1512 × 1748 px at 300 DPI). Cover thumbnails are always
  portrait at 128:148 (`.cover-frame`), never square, never 16:9.
- **No trademarked marks** in chrome or covers. Platforms are plain "PS5"/"PS4" text. No
  emoji, no gradients in chrome.
- **Keys never reach the browser.** Settings shows set/not-set only. Everything comes
  from `.env`.
- **Personal use.** There are no share, publish or store affordances. The footer
  credits RAWG always, and SteamGridDB whenever `SGDB_KEY` is set.

## 2. Stack

Vite 6, React 19, TypeScript, React Router 7 (data mode), TanStack Query 5,
Tailwind CSS v4 over CSS-variable tokens, Lucide icons, Radix available for primitives.
Fonts are self-hosted via `@fontsource-variable` (Space Grotesk, Inter, JetBrains Mono).
Tests: Vitest + Testing Library, Playwright.

`npm run dev` at the repo root starts the API on :3000 and Vite on :5173 (proxying
`/api`).

## 3. Code layout

```text
frontend/
  src/
    main.tsx, app/{router,providers,shell}.tsx
    api/        client.ts (the only fetch), types.ts, queries.ts, mutations.ts
    components/ ui.tsx (Button, IconButton, Pill, Chip, Segmented, Select, Meter,
                ProgressBar, CoverThumb, Card, PageHeader, states), Toast.tsx
    features/   library/ games/ runs/ review/ shelves/ print/ settings/ legal/
    lib/        status.ts (status→tone/column, fit tone, progress), cn.ts
    styles/     tokens.css (source of truth), app.css (@theme mapping, base, print)
  e2e/          server.mjs (offline API), flow.spec.ts
```

Components never call `fetch`. All invalidation and optimistic updates live in
`api/mutations.ts`.

## 4. Design tokens (`src/styles/tokens.css`)

| Token | Value | Use |
| --- | --- | --- |
| bg / sidebar / surface / raised | `#0D0E12` / `#111318` / `#15171D` / `#1E2129` | Page, sidebar, cards, raised controls |
| border / border-strong | `#23262F` / `#2A2E38` | 1 px lines |
| text / muted / faint | `#ECEEF2` / `#A3AAB7` / `#8E96A4` | Contrast ≥ 5.4:1 on every surface |
| accent (lime) | `#C8F26A`, ink `#0D0E12` on it | Primary buttons, active states, progress |
| info | `#7AA7FF` | Building |
| success | `#3DD6A3` / text `#9BE8C9` | Approved, fit ≥ 80 |
| warning | `#F5A524` / text `#F7C56B` | In review, fit ≥ 60 |
| danger | `#FF8A80` | Failed, fit < 60 |

Radius: 8 px controls, 10 px buttons, 12–14 px cards and panels. Touch targets are
≥ 44 px (`min-h-11`). Tailwind names: `bg-surface`, `text-muted`, `border-line`,
`rounded-card`, `font-display` and so on.

## 5. Shell

- **Sidebar** (232 px; on phones it becomes a header with horizontally scrolling nav):
  lime logo tile with a book icon, "Coverpress". Nav: Game library, My shelves,
  Pipeline runs (live count in lime), Review queue (amber count), Print sheets,
  Settings. Footer: RAWG meter (`x / 20k`, from `/api/me` `usage.rawg`), covers this
  month, and a status dot built from `/api/settings/llm` `status.connected`, a real
  probe of Ollama.
- **Top bar:** "Search games on RAWG…" (⌘K / Ctrl+K focuses it). Typing drives the
  library's `?q=` from any page, debounced 300 ms, and only real keystrokes navigate.
  It also has a notifications popover (recent finished runs) and the initials avatar.

## 6. Screens

| Route | Screen | Data |
| --- | --- | --- |
| `/` | Game library: platform segment, genre, year, sort; grid `minmax(188px)` (2 columns on phones); infinite scroll with a "Load more" fallback; multi-select → batch | `GET /api/rawg/search` (infinite) |
| `/games/:rawgId` | Detail and art picker: front preview, Platform and Layout segments (Standard / Minimal / Raw image), copy card, Run all steps / Add to shelf, art grid with All / RAWG / SteamGridDB tabs | `GET /api/games/:id`, `/art`; `POST /copy`, `/covers` |
| `/runs` | Recent runs | `GET /api/runs` |
| `/runs/:coverId` | Pipeline run: status badge, Replay run, Go to review, progress bar, 7-step list, wrap preview, QC chips, live log | `GET /api/covers/:id/run`, polled every 1 s while active |
| `/review` | Kanban (Queued, Building, Needs review, Approved, Failed); shelf filter; Print approved (n) | `GET /api/covers`, `/decision`, `/retry`, `/build` |
| `/shelves` | Shelf cards with mosaics; create shelf | `/api/projects` |
| `/print`, `/print/:projectId` | Shelf list, then 276 × 154 mm pages with `@page A4 landscape` | `/api/projects/:id/print` |
| `/settings`, `/legal` | Read-only provider and LLM status, plan, data dir; acceptable use | `/api/settings`, `/api/legal` |

**Fit score** (`artFit` in `lib/qc.mjs`) is 60% how much of the image survives a
cover-crop to 128:148, plus 40% resolution after that crop against 1748 px. It uses the
same judgements QC warns on, so a high score means fewer QC warnings. The highest fit is
the default front.

**Layouts** are a per-cover `style` override: `standard` (full template), `minimal` (no
edition line, ribbon, tagline or bullets) and `raw` (front panel is the art edge to edge;
QC checks only the art).

**Review semantics:** "Run again" calls `/retry` for needs_review, failed and rejected
covers, and `/build` (replay) otherwise. Rejected covers sit in the Failed column.
Approve and run again update optimistically and roll back with a toast on error.

## 7. Polling

| Query | Interval |
| --- | --- |
| Run screen | 1 s while the job is queued or running, or the cover is busy; stops after |
| Cover lists | 1.5 s while anything is building; idle otherwise |
| Runs (sidebar count) | 1.5 s while active, 15 s heartbeat otherwise |
| LLM status | 30 s (server caches the probe for 15 s) |

## 8. Accessibility

Every control is a real `button` or `a`. Icon-only buttons carry `aria-label`
(Playwright asserts there are none without a name). Segmented controls are radiogroups
with arrow-key support. The run log is `role="log"`. Toasts use one polite live region,
and errors use `role="alert"`. The focus ring is a 2 px lime outline, always visible.
`prefers-reduced-motion` removes animation. Pages do not scroll horizontally at 390 px.
The board scrolls inside its own container.

## 9. Tests

- `npm --prefix frontend test`: `lib/status` unit tests, plus ReviewBoard optimistic
  approve with rollback and keyboard shortcuts.
- `npm --prefix frontend run test:e2e`: `e2e/server.mjs` boots the real API, worker and
  renderer with RAWG, SteamGridDB, the image CDN and Ollama stubbed. The specs cover
  search → generate → run completes → approve → print, the art-picker swap, phone-width
  overflow on four screens, and accessible names.

## 10. Known gaps

- SteamGridDB counts and the Print-ready/Low-res chip on library cards are known only
  after a game has been opened once (from the disk cache). Fetching them for every card
  would cost RAWG and SteamGridDB requests per scroll.
- Run updates are polled, not streamed (SSE was optional in the brief).
- There is no inline nudge editor (zoom, offsets, title size) in review yet; the API
  (`POST /covers/:id/render`) supports it.
