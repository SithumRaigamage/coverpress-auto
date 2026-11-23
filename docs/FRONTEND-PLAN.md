# Frontend plan — rebuilt from zero

Status: **planning**. The previous server-rendered UI was deleted on purpose
(`server/views.mjs`, `server/public/`, all HTML routes). What exists today is a
JSON API (`server/index.mjs`) in single-account local mode with no sign-up, no
sign-in and no pages. This document specifies the frontend that replaces it.

Read this before writing frontend code. It supersedes §9 of `docs/SAAS-PLAN.md`.

---

## 1. What is being replaced, and why

The deleted UI was server-rendered HTML with a hand-written CSS/JS pair, chosen
so the product needed no build step. Three things made that the wrong trade:

1. **Every interaction needed a full page round trip.** Uploading art, nudging a
   title, polling build progress and switching covers between review items were
   all form posts and redirects. The app felt like a form, not a tool.
2. **The renderer's whole value is visual judgement.** The product is: look at a
   300 DPI wrap, adjust, approve. Server-rendered markup forced the image to be
   re-fetched at page level, so the "stage" could never stay put while you
   changed something.
3. **The design system lived in one 1,100-line CSS file**, coupled to markup
   generated in JavaScript strings. Rethinking the layout meant rewriting both.

The API is deliberately finished before the UI this time: the contract in §5 is
what the new frontend codes against, and the API is tested without a browser
(`npm test`, 47 tests).

**Deleted:** all HTML views, static CSS/JS, `/login`, `/signup`, `/logout`,
sessions, cookie handling, the printed HTML sheet.
**Kept:** the renderer (`lib/`), QC, the job queue, quota, sealed provider keys,
accounts *schema* (single account used), legal text (now data at `/api/legal`).

---

## 2. Non-negotiables

These come from the domain, not from taste. A design that violates one is wrong.

- **Millimetres are the truth.** The wrap is 270 × 148 mm (3 mm bleed → 276 × 154).
  Preview must never imply a pixel size is what prints.
- **Panel aspect 0.865:1.** Cover thumbnails are portrait 3:4, never cropped to a
  square, never a 16:9 tile.
- **Printing happens in the browser at 100%.** No "scale to fit" affordance, no
  zoom control near the print button. The screen shows the wrap; the print sheet
  shows it at real size with a 270 mm ruler instruction.
- **No trademarked marks.** No logo lockups in UI chrome either — platform labels
  are plain lettering.
- **Personal use, one shelf.** The legal line is a product constraint: no
  "share", "publish", "marketplace" or "export to store" affordances.
- **Provider keys never reach the browser.** Settings shows set/not-set only.

---

## 3. Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Build | **Vite 6** | Zero-config, instant HMR, static output that Node can serve. |
| UI | **React 19 + TypeScript** | Team-familiar, huge ecosystem for drag-drop and virtualisation. |
| Routing | **React Router 7 (data mode)** | URL is the source of truth for shelf/cover selection; deep links for review. |
| Server state | **TanStack Query 5** | Polling, cache invalidation and optimistic decisions are the whole app's data model. |
| Styling | **Tailwind CSS v4** + CSS variables | Tokens in CSS vars so the design system is auditable; utilities for layout speed. |
| primitives | **Radix UI** (dialog, popover, tooltip, tabs, slider, toast) | Accessibility is not something to re-implement. Styled locally, never a component library theme. |
| Forms | **React Hook Form + Zod** | Validation shared with API types. |
| Icons | **Lucide** | Thin, consistent stroke; no brand marks. |
| Tests | **Vitest + Testing Library**, **Playwright** | Unit for logic, one E2E path for the money flow. |

Rejected: Next.js (no SEO need, no SSR benefit, adds a server runtime for nothing),
Svelte/Solid (no advantage here), MUI/Chakra (theme fights the design), Zustand
(server state is 90% of state; the rest is local), Electron (a browser is already
the canvas).

**Where it lives:** `frontend/` in this repo, built to `frontend/dist`. The Node
process serves `dist` for non-`/api` routes in production; in development Vite
runs on `:5173` and proxies `/api` to `:3000`, so there is no CORS and no second
origin.

```bash
npm run dev:api     # node server/index.mjs      → :3000
npm run dev:web     # vite                        → :5173
```

---

## 4. Layout of the code

```
frontend/
  index.html
  vite.config.ts            # proxy /api → 127.0.0.1:3000
  src/
    main.tsx
    app/
      router.tsx            # route table
      providers.tsx         # QueryClient, Toaster, theme
      shell.tsx             # sidebar + main region
    api/
      client.ts             # fetch wrapper, error normalisation
      types.ts              # DTOs mirroring the server (single source of truth)
      queries.ts            # query keys + hooks per endpoint
      mutations.ts          # upload, import, build, decision, theme
    features/
      shelves/              # list, create, shelf header, mosaics
      covers/               # grid, card, import, upload drop zone
      review/               # rail, stage, controls, QC panel, keyboard
      print/                # print sheet + print stylesheet
      settings/             # plan, usage, provider keys, legal
    components/             # Button, Field, SlideOver, Chip, Meter, EmptyState…
    lib/                    # format.ts (mm, dates), poll.ts, cn.ts
    styles/
      tokens.css            # colour, type, spacing, radius, motion
      app.css               # base + print rules
  public/                   # favicon only
```

Rule: **components never call `fetch`.** Only `api/*` does; features use hooks.

---

## 5. API contract (already implemented)

Base `/api`. JSON in, JSON out. Errors are `{ "error": "sentence" }` with a
4xx/5xx status. No cookies; every mutation is same-origin.

| Method | Path | Body → response |
| --- | --- | --- |
| GET | `/me` | → `{ account: { id, email, local, plan{name,label,coversPerMonth,projects,price}, usage{used,limit,projects,projectLimit} } }` |
| GET | `/projects` | → `{ projects: Project[], usage, plan, pending }` |
| POST | `/projects` | `{ name, platform? }` → `201 { project }`; `402` at the project cap |
| GET | `/projects/:id` | → `{ project, stats{counts,total}, covers: Cover[], pending }` |
| PATCH | `/projects/:id` | `{ accent?, mark?, address?, edition?, layout?, platform? }` → `{ project }` |
| POST | `/projects/:id/import` | `{ titles: string \| string[] }` → `201 { created[], skipped, autoQueued, usage, message }` |
| POST | `/projects/:id/build` | `{}` → `202 { queued, pending }` |
| GET | `/projects/:id/status` | → `{ pending, covers: [{ id, status, renderId, renderVersion, score, error }] }` — the polling endpoint |
| GET | `/projects/:id/print` | → `{ paper, trimMm, pageWidthMm: 276, pageHeightMm: 154, pages: [{ coverId, title, platform, version, wrapUrl, widthMm, heightMm }], instructions }` |
| GET | `/covers/:id` | → `{ cover, cfg, qc, overrides }` — `cfg` is what the renderer used |
| PATCH | `/covers/:id` | `{ overrides }` → `{ id, overrides }` (geometry keys silently dropped) |
| POST | `/covers/:id/build` | `{}` → `202 { jobId, pending }` |
| POST | `/covers/:id/render` | `{ overrides }` → `202 { jobId }` — version bump, **free** of quota |
| POST | `/covers/:id/decision` | `{ decision: "approved"\|"rejected", overrides? }` → `{ id, status, decidedAt }` |
| DELETE | `/covers/:id` | → `{ deleted, projectId }` |
| PUT | `/covers/:id/art/:slot` | raw PNG/JPEG/WebP body (`front`, `back`, `shot0..2`) → `{ width, height, bytes, artUrl, jobId }` |
| GET | `/covers/:id/art/:slot` | → image bytes |
| GET | `/renders/:id/wrap.png` \| `front.png` | → image bytes, `private, max-age=60` |
| GET | `/settings` | → `{ account, keys{rawg,openrouter}, unsupported, storage }` |
| PUT | `/settings/keys` | `{ name, value }` → `{ keys }`; empty `value` clears |
| GET | `/legal` | → `{ title, summary, sections[], contact }` |

`Cover`: `{ id, projectId, title, platform, mode, status, error, score, issues[],
renderId, renderVersion, artUrl, thumbUrl, wrapUrl, decidedAt, createdAt }`.
`status ∈ queued | processing | auto_approved | needs_review | failed | approved | rejected`.

**Rules the UI must respect**

- Quota is charged at import; **re-render never is**. Say so in the UI when
  someone hesitates over an extra nudge.
- `402` on project creation is a plan limit, not an error — render as an upgrade
  hint, not a red banner.
- `failed` covers carry a user-fixable `error` string; show it verbatim and put
  the fix (upload front art) next to it.
- A build is asynchronous. Any action that returns `202` must start polling
  `/status` until `pending === 0`, then refetch the project.

---

## 6. Design system

Direction: **a print workshop, not a dashboard.** Paper, ink, one accent, real
cover art doing the talking. Closer to a film-scanner app than to admin software.

### Colour (light)

| Token | Value | Use |
| --- | --- | --- |
| `--ink` | `#14161A` | text, primary buttons |
| `--ink-2` | `#3D444E` | secondary text |
| `--ink-3` | `#6C7480` | labels, metadata |
| `--paper` | `#F6F4EF` | app background (warm, not grey) |
| `--card` | `#FFFFFF` | panels, cards |
| `--line` | `#E2DED4` | 1px borders |
| `--accent` | `#14607A` | selection, links, progress (ink-blue, not a brand colour) |
| `--ok` | `#2F6B4F` | approved |
| `--warn` | `#A65A18` | needs review / QC warnings |
| `--danger` | `#9B2C2C` | failed, destructive |

Dark variant inverts paper/ink and keeps accent; **not** required for v1, but
tokens must be structured so it is a variable swap (`[data-theme="dark"]`).

### Type

- Display: **Barlow Condensed 600** — "SHELF 2026", cover titles, numbers. Nods at
  the printed band without imitating it.
- UI: **Inter** 400/500/600 — everything else.
- Mono: **JetBrains Mono** for millimetres, DPI, version numbers, keys set/unset.
- Scale: 11 / 12 / 13 / 15 / 18 / 24 / 32 px (rem-based: 0.6875 → 2rem).
  No text below 11 px; body copy is 15 px.

### Space, shape, motion

- 4 px base; spacing steps 4/8/12/16/20/28/40/64.
- Radius: 2 px on covers and inputs (print-sharp), 8 px on panels, 999 px only on
  chips.
- Border: 1 px `--line`; no shadows except the review stage
  (`0 10px 30px rgb(0 0 0 / .18)`) and the slide-over.
- Motion: 120 ms ease-out for hover, 180 ms for panels. `prefers-reduced-motion`
  removes transforms; nothing animates on load.
- Focus: 2 px `--accent` ring, 2 px offset, always visible — never `outline: none`.

### What not to do

No gradients on UI chrome, no glassmorphism, no rounded-3xl cards, no emoji as
icons, no drop shadows on buttons, no purple. Cover art is the only saturated
thing on screen.

---

## 7. Information architecture

Five routes plus print. No nested tabs, no wizard.

| Route | Screen | Purpose |
| --- | --- | --- |
| `/` | Shelves | All shelves as cards with cover mosaics; usage meter; "New shelf". |
| `/shelves/:id` | Shelf | Cover grid, import, house style, progress banner. |
| `/shelves/:id/review?cover=:id` | Review | Rail + one large wrap + QC + controls. Deep-linkable per cover. |
| `/shelves/:id/print` | Print | Real-size sheet, print button, 270 mm instruction. |
| `/settings` | Settings | Plan, usage, provider keys, legal, data location. |
| `/legal` | Legal | Rendering of `/api/legal`; also linked from settings. |

`?cover=` is the only UI state in the URL, because "look at this one" is the one
thing people paste into a message to themselves. Zoom, panel and scroll state are
local component state.

---

## 8. Screens

### 8.1 Shelves (`/`)

Two-column layout: 220 px sidebar, main.

- Header: "Shelves" (Barlow Condensed 32) + one-sentence purpose + primary
  "New shelf".
- New shelf: an inline row (name input + PS5/PS4 segmented control + Create),
  not a modal. Collapsed to a button when > 6 shelves exist.
- Shelf card: 3:4 mosaic of up to three latest covers (CSS grid, 6 px gutter,
  covers bleed off the right edge to imply more), name, `PS5 · 3 covers · 1 ready`,
  hover reveals "Open".
- Empty state: one card-sized illustration of an empty case + "Start with a shelf,
  then paste your titles." + Create button.
- Sidebar: wordmark, nav (Shelves, Settings), shelf list with counts, usage meter
  (`3 of 10 covers · Studio`), account email, "Local mode" chip.

### 8.2 Shelf (`/shelves/:id`)

- Sticky header: breadcrumb, shelf name, `PS5 · 3 covers · 1 ready`, actions
  (Review, Print, Build all).
- **Progress banner** appears only while `pending > 0` or a cover is `processing`:
  thin 2 px accent bar + `Building 2 of 3…`, auto-hides. Polling stops when idle.
- **Cover grid**: `repeat(auto-fill, minmax(176px, 1fr))`, gap 24/18. Card = art
  (3:4, `object-fit: cover`, `loading="lazy"`), status row (chip + score), title
  (2-line clamp, tooltip), meta (`PS5 · your art`), actions on hover **and** on
  keyboard focus: Rebuild, Remove.
- **Drop target**: dragging an image over a card highlights the card and uploads
  to that cover's front on drop. Dragging over empty grid space offers "create a
  cover from this image" (name from filename, then edit inline).
- **Paste** on the shelf screen with a file in the clipboard uploads to the
  currently focused (or single selected) card.
- **Add games**: collapsed panel. Textarea (one per line, `Title|PS5|auto`),
  count preview, "Add N covers". Shows the last import's message inline:
  `4 covers added, 2 held back by the 10-cover limit` with an upgrade link.
- **House style**: collapsed panel. Accent swatch, mark (2 chars), edition,
  address (textarea), layout (Auto/PS4/PS5). Applies to the shelf; save is
  explicit (`PATCH`), and a note says existing covers keep their style until
  rebuilt.

### 8.3 Review (`/shelves/:id/review?cover=:id`)

The screen the product is judged on. Three regions, no page reloads.

- **Rail (232 px)**: one row per cover — 40 px thumb, title, status chip, score.
  Active row has a 2 px accent left border. Clicking pushes `?cover=` (soft
  navigation). `j/k` move, `Enter` selects.
- **Stage (flex)**: dark mat (`#101318`) with the wrap centred, `max-height: 56vh`,
  `width: auto` so the whole wrap — back, spine, front — is visible without
  scrolling at 1440×900. Below it, a segmented control **Wrap / Front / Back /
  Spine** that zooms `img` via a clip window rather than downloading a different
  file. A `1:1` toggle shows the true 300 DPI crop (pixel-for-pixel) inside a
  scroll container, labelled `300 DPI actual pixels`.
- **Inspector (360 px, right)**: title + status, QC list (warn glyph + sentence;
  fails in `--danger`), then controls: title text, title size (12–24 mm slider),
  anchor (top/center/bottom), zoom (1.0–2.5), offset X/Y (−30..30 mm), edition,
  and **Re-render** (free). Footer: Approve (primary), Reject, Download wrap.
  Approve is optimistic — the chip flips immediately, the request rolls it back on
  failure with a toast.
- **Undo**: `Cmd+Z` reverses the last decision or override batch (single-level,
  in-memory).
- **Empty state**: "Nothing needs review — everything is approved." with a link
  to print.
- Poll while the selected cover is `queued`/`processing` (1.2 s, exponential to
  5 s, stop on terminal status); when a new `renderId` arrives, crossfade the
  stage image and keep scroll position.

### 8.4 Print (`/shelves/:id/print`)

- One page per approved cover, `276 × 154 mm`, `@page { size: A4 landscape;
  margin: 8mm }`, `print-color-adjust: exact`.
- On screen: the sheet as paper with a trim outline, page count, and a checklist
  (`Print at 100%`, `No scaling`, `Measure 270 mm`).
- Before printing, a `window.print()` only; no PDF library, no image scaling
  controls.
- Zero approved covers: explain what approval means, link to review.

### 8.5 Settings (`/settings`)

Sections as stacked cards: **Plan & usage** (meter, limits, what re-rendering
costs), **Provider keys** (RAWG, OpenRouter — password inputs, "Saved" state,
never a revealed value, note that SteamGridDB is unavailable and why), **Data**
(database file name, data directory, "everything stays on this machine"),
**Legal** (link). "Local mode" is explained at the top: no login, single account,
do not expose this port.

### 8.6 States that must exist, per screen

Loading (skeletons that match final geometry), empty, error with retry, `402`
plan limit, 404 shelf, offline ("Can't reach the API — is `npm run dev:api`
running?"). No spinner replaces a layout; no layout shift on load.

---

## 9. Interaction details

| Action | Behaviour |
| --- | --- |
| Upload | Drag onto card → immediate 0–100% bar on that card → optimistic "queued" chip → polling picks up the render. Reject > 12 MB or non-image client-side, with the server's message as fallback. |
| Paste list | `Title|PS5|auto` per line; blank lines and `#` ignored; preview count updates as you type. |
| Build all | Enqueues everything; banner appears; button disables while `pending > 0`. |
| Approve/Reject | Optimistic; moves focus to the next unreviewed cover in the rail; announces via `aria-live="polite"`. |
| Keyboard | `j/k` next/prev cover, `Enter` open, `a` approve, `r` reject, `Cmd/Ctrl+Enter` re-render, `Cmd+Z` undo, `Esc` closes slide-overs, `?` opens the shortcut list. |
| Delete | Confirm in a popover on the card (not a modal): "Remove cover and its renders?" — irreversible, server deletes files. |
| Toasts | Bottom-centre, max 3, 4 s, dismissible; errors persist until dismissed. |

---

## 10. Data flow

Query keys: `["me"]`, `["projects"]`, `["project", id]`, `["cover", id]`,
`["status", projectId]`, `["print", projectId]`, `["legal"]`.

- `staleTime`: 30 s for lists/details; `0` for `status` (it is a poll).
- Poll `status` with `refetchInterval` while `pending > 0` or the selected cover is
  queued/processing, and **stop** otherwise — no idle polling.
- On `pending → 0`: invalidate `project`, `projects`, `cover` once.
- Mutations that return `202`: set a local `building` flag, start polling, toast
  nothing (the banner is the feedback).
- Optimistic updates only for decisions and overrides, always with rollback.
- No global store. Local UI state: selected panel, zoom mode, shortcut help.

---

## 11. Accessibility & performance

- Target WCAG 2.2 AA. Contrast ≥ 4.5:1 for text, 3:1 for borders that carry
  meaning. Chips pair text with colour, never colour alone.
- Every icon-only button has an `aria-label`; the drop zone is a real `<button>`
  plus a file input, so upload works without drag.
- Focus is never trapped except in the settings key dialog; `Esc` always closes.
- The review stage image has a descriptive `alt` built from title + platform +
  version.
- Announce build completion and decisions through one polite live region.
- Budgets: initial JS ≤ 180 KB gzipped, LCP < 2.0 s on a 2019 laptop, CLS < 0.02.
  Covers are lazy, `srcset` at 2 widths later if measurement says so — do not
  pre-optimise.
- The wrap PNG is ~2–4 MB; the rail uses `front.png`, never the wrap.

---

## 12. Testing

- **Vitest** for `lib/` formatting, poll state machine, override clamping UI,
  Zod schemas.
- **Testing Library** for: shelf empty state, import preview count, optimistic
  approve rollback, keyboard navigation in the rail.
- **Playwright** (one spec, the money path): create shelf → paste 2 titles →
  upload a fixture PNG → wait for render → adjust zoom → approve → print page
  shows 2… 1 page with the right wrap URL. Plus one spec for `402` at the project
  cap and one for a 404 shelf.
- No visual regression suite until the design stops moving.

---

## 13. Milestones

**M0 — Shell (½ day).** Vite + TS + Tailwind tokens; router; sidebar shell; API
client with typed DTOs; `/me` in the footer; empty states. *Done when* `/` renders
the local account and shelf list from the API with no console errors.

**M1 — Shelves and import (1 day).** Shelves list, create shelf, shelf page with
grid, import panel, build-all, progress polling. *Done when* a pasted list of
three titles appears as three cards and `pending` settles to 0 without a reload.

**M2 — Upload and render (1 day).** Drag/paste/file-picker upload with per-card
progress, queued → rendering → ready transitions, failed state with the server's
message. *Done when* dropping a 1512×1748 PNG produces a wrap image on the card.

**M3 — Review (1½ days).** Rail + stage + inspector + optimistic decisions +
keyboard map + QC display + 1:1 pixel view. *Done when* a cover can be reviewed
end-to-end without touching the mouse, and a re-render keeps selection.

**M4 — Print and settings (½ day).** Print sheet with correct millimetre CSS,
settings (plan, keys, data, legal). *Done when* printing to PDF yields A4
landscape pages measuring 276 × 154 mm in a PDF viewer.

**Deferred:** accounts UI (sign-in comes back with hosting; the schema is ready),
billing, dark theme, mobile-first review (tablet portrait works; phone is read-only
for v1), image cropper, share links.

---

## 14. Open decisions for the owner

1. **Direction:** workshop (paper/ink, condensed display) vs neutral tool (grey,
   system font). The tokens in §6 assume workshop.
2. **Hosting model:** local-only forever (then accounts stay off and the UI never
   needs a login screen until M5), or hosted SaaS (accounts return, and the plan
   §13 "deferred" list moves into scope before launch).
3. **Density:** 176 px cards (4–5 per row at 1440) vs 220 px (3 per row). The
   smaller grid is implemented; the larger is one token change.

Answer those and M0 starts.
