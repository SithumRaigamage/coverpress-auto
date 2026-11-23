# Coverpress — user stories

Personas:

- **Sam, the collector.** 60 digital PS5 games, no PC skills beyond a browser. Wants the
  shelf to look like a shelf. Plan: Free, maybe Studio.
- **Nia, the maker.** Makes and sells her own insert designs for a small shop. Uploads
  her own art, cares about print accuracy and batch speed. Plan: Studio.
- **Alex, the operator.** Runs the deployment. Cares about isolation, quotas, refunds and
  not being paged.

Priorities: **P0** must exist to charge money, **P1** next, **P2** later.
Status: **shipped** (covered by `npm test`), **next**, **later**.

> **UI status (23 Nov 2026):** the entire presentation layer was deleted and is being
> rebuilt from zero — see `docs/FRONTEND-PLAN.md`. Stories below marked **shipped** are
> shipped *as API behaviour* and tested there; the screens that used to carry them are
> gone. Epic A (accounts) is **paused**: local mode has no sign-up or sign-in. Treat the
> stories as product requirements for the new frontend, not as a description of what a
> browser currently shows.

---

## Epic A — Getting in

### A1 · Sign up and land on a workspace — P0 · shipped
As Sam, I want to create an account with email and password so my covers are mine.

Acceptance criteria
- Signup rejects a password under 10 characters and a malformed email with a readable
  message, keeping the form filled.
- A duplicate email (case-insensitive) is refused with 409 and a link to sign in.
- Success sets an `HttpOnly`, `SameSite=Lax` session cookie and lands on `/app`.
- The raw session token never appears in the database.

Tests: `tests/auth.test.mjs` (weak password, malformed email, duplicate, session hashing).

### A2 · Sign in, sign out, stay signed in — P0 · shipped
As Sam, I want a normal login that survives a refresh.

Acceptance criteria
- Wrong password returns 401 without revealing whether the email exists.
- Ten failed attempts per address+email in ten minutes is refused.
- Logging out invalidates the session server-side; the old cookie stops working.

Tests: `tests/auth.test.mjs`.

### A3 · Password reset — P1 · next
As Sam, I want to recover my account without emailing support.
Criteria: single-use token, 30-minute expiry, no account enumeration, audit log entry.

---

## Epic B — Building a shelf

### B1 · Create a project and import titles — P0 · shipped
As Sam, I want to paste my game list instead of editing a text file.

Acceptance criteria
- `Title | Platform` per line; the platform is optional and falls back to the project's.
- A trailing `| auto` opts that cover into fetched art.
- Import reports "N covers added" and how many were held back by the monthly limit.
- Titles are per-account; two accounts importing the same title never collide.

Tests: `tests/quota.test.mjs`, `tests/http.test.mjs`, `tests/tenant.test.mjs`.

### B2 · Set a house style once per project — P0 · shipped
As Nia, I want every cover in a shelf to share my accent colour and mark.

Acceptance criteria
- Layout follows the platform by default; PS4 or PS5 can be forced.
- Accent, mark, edition line and address block save per project and apply to new builds.
- Print geometry (panel 128 mm, spine 14 mm) is never editable from the browser.

Tests: `tests/render.test.mjs` (theme + geometry clamp), `tests/build.test.mjs` (cfg stored).

### B3 · Upload my own artwork — P0 · shipped
As Nia, I want to drop a PNG in and have the build start.

Acceptance criteria
- PNG/JPEG/WebP only, decided by magic bytes, decode-verified, ≥ 400×400 px, ≤ 12 MB.
- The front slot queues a build automatically; back and shots replace the panel art.
- Uploaded art always wins over fetched art, and a rebuild never overwrites it.
- Art is stored per account+cover; another account cannot read or replace it.

Tests: `tests/http.test.mjs` (sniffing, tiny image, slot names, stored path shape),
`tests/tenant.test.mjs`, `tests/build.test.mjs`.

### B4 · Fetch metadata for me — P1 · shipped (needs customer key)
As Sam, I want to type a title and get the back-cover text and screenshots.

Acceptance criteria
- Requires a RAWG key on the account; without one the cover fails with a message that
  says exactly what to add.
- An inexact title match becomes a review warning, not a silent substitution.
- Screenshots and the back-panel background are cached as rows + files; a rebuild costs
  zero calls.
- **Portrait front art is never fetched.** SteamGridDB's terms are personal/non-commercial
  only, so art is always uploaded; RAWG's 16:9 hero image would be destroyed by the
  panel crop.
- RAWG attribution prints on every back panel (licence condition).

Tests: `tests/render.test.mjs` (fallback copy), `tests/build.test.mjs` (actionable
failure). Provider calls are not exercised offline — see "not covered" in the README.

### B5 · See why a build failed — P0 · shipped
As Sam, I want a failed cover to explain itself instead of saying "Building" forever.

Acceptance criteria
- A build error writes the message onto the cover row and marks it failed.
- Transient errors retry with backoff (3 attempts) and return the cover to queued.
- No cover can remain in `processing` after the worker finishes.

Tests: `tests/build.test.mjs` ("a manual cover without art fails with an actionable
message").

---

## Epic C — Quality gate

### C1 · Automatic checks decide what needs a human — P0 · shipped
As Alex, I want only genuinely uncertain covers in the queue.

Acceptance criteria
- Checks: art resolution below 1512×1748, landscape art in a portrait panel, missing art
  or title, spine over 46 chars, blurb under 25 / over 130 words, no screenshots, and
  title contrast sampled from the rendered pixels behind the title.
- Zero warnings → `auto_approved`; any warning → `needs_review`; any failure → `failed`.
- Results are stored per render, not per cover, so a re-render's verdict is comparable.

Tests: `tests/build.test.mjs` (QC stored, no fails on good art), `tests/render.test.mjs`;
`lib/qc.mjs` rule-level coverage is through the render path.

### C2 · Review, adjust, re-render, approve — P0 · shipped
As Sam, I want to fix a title that is too big without re-uploading anything.

Acceptance criteria
- Sliders for title size, zoom and framing plus a title field, all applied to the real
  render on the server.
- Re-render creates a new version, costs no quota and makes no provider calls.
- Only whitelisted overrides are stored; forged keys (`panelW`, `spine`, `base`) are
  dropped and numeric values clamped.
- Approve/reject is a decision; an approval survives a later rebuild.

Tests: `tests/build.test.mjs` (overrides, version bump, sticky approval),
`tests/render.test.mjs` (sanitising).

### C3 · Compare versions side by side — P2 · later
As Nia, I want to see the previous render next to the new one before approving.

---

## Epic D — Printing

### D1 · Print sheet of approved covers — P0 · shipped
As Sam, I want one page per cover at true size.

Acceptance criteria
- A4 landscape, `width: 276mm` (270 trim + 3 mm bleed each side), one cover per page,
  caption reminding 100% scale.
- Only `approved` and `auto_approved` covers appear; rejected ones never do.
- Requires the owner's session; the PNGs are served only to that account.

Tests: `tests/build.test.mjs` (sheet contents + sizes), `tests/tenant.test.mjs` (foreign
render 404), `tests/http.test.mjs` (rejected cover excluded).

---

## Epic E — Running the business

### E1 · Free plan caps, clearly explained — P0 · shipped
As Alex, I want the limit enforced before work is done, not after.

Acceptance criteria
- Free: 10 covers/month, 2 projects. Studio: 500 covers/month, 50 projects.
- Over-quota imports still create what fits and say how many were held back.
- The cap is per account and resets at the start of the UTC month.
- The cap applies at import, so no API quota is spent on covers that cannot be stored.

Tests: `tests/quota.test.mjs` (cap, held-back count, project cap, per-account counting).

### E2 · Subscribe and upgrade — P1 · next
As Sam, I want to pay and keep going without waiting for a human.
Criteria: Stripe Checkout for Studio, webhook sets `plan`, invoice history, cancellation
keeps access until period end, failed payment downgrades after a grace period.

### E3 · Operator plan change — P0 · shipped
As Alex, I need to fix a customer's plan after a manual invoice.
Criteria: `node server/cli.mjs plan <email> studio` only; no HTTP endpoint; prints the
result; `usage` lists covers used this month per account.

Tests: `tests/quota.test.mjs` exercises the plan change through the database.

### E4 · Per-account provider keys — P0 · shipped
As Nia, I want to use my own RAWG/OpenRouter keys without them being visible to anyone,
including support.

Acceptance criteria
- Keys are sealed with AES-256-GCM under the deployment secret.
- Settings shows only "set" or "not set"; no route ever returns a key value.
- Removing a key deletes it; the next build reports what is missing.

Tests: `tests/auth.test.mjs` covers the session primitives; key sealing is unit-testable
via `auth.seal`/`auth.unseal` (no HTTP route returns a value; asserted by inspection of
`views.settingsPage`).

### E5 · Email on failure — P2 · later
As Sam, I want an email when a shelf finishes or fails.

---

## Epic G — Staying lawful

### G1 · Readable acceptable-use rules — P0 · shipped
As Alex, I want the rules on the site, so a customer cannot claim they were never told.

Acceptance criteria
- `/legal` is readable signed out and linked from signup and settings.
- It states: personal shelf only, no resale, no uploading art you lack rights to, no
  official/endorsed claim, and what the renderer refuses to draw.
- A takedown contact is configurable (`LEGAL_CONTACT`) and shown when set.

Tests: `tests/http.test.mjs` (public page, required wording).

### G2 · No commercially-licensed API in the hosted app — P0 · shipped
As Alex, I do not want a ToS violation in the product.

Acceptance criteria
- SteamGridDB cannot be configured or called from the hosted service; a key upload for
  it is refused. The CLI keeps it for personal use.
- Front art must be uploaded in every mode.

Tests: `tests/build.test.mjs` (manual cover without art fails with an upload message),
`tests/render.test.mjs`.

---

## Epic F — Trust

### F1 · My data is not visible to other accounts — P0 · shipped
Criteria: every project/cover/render/art lookup is scoped by `account_id`; a foreign id
returns 404, never a redirect or a partial page.

Tests: `tests/tenant.test.mjs` (page, JSON, render, upload, build, decision, dashboard).

### F2 · Nothing I paste can run in my browser — P0 · shipped
Criteria: all interpolations escaped; uploads restricted to raster formats; no inline
event handlers in the markup.

Tests: `tests/http.test.mjs` (script title escaped, SVG refused).

### F3 · Only my own origin can change my data — P0 · shipped
Criteria: cross-site mutations return 403; cookies are `SameSite=Lax`; state changes are
POST/PUT only.

Tests: `tests/auth.test.mjs` (cross-origin project creation refused).

### F4 · Trademark-safe output — P0 · shipped
Criteria: the renderer draws generic marks only (plain rating box, hand-drawn spec
glyphs, plain platform lettering); every cover carries the personal-use legal line;
attribution to RAWG prints on the back panel.

Tests: enforced by `lib/render.mjs` (no logo assets exist) and `tests/build.test.mjs`
(legal text present in the cfg). Manual review of `out/smoke.png` is the visual check.

---

## Not doing (and why)

| Idea | Why not |
| --- | --- |
| AI image generation | No free image API exists; the AGENTS/CLAUDE notes are explicit. Custom art stays an upload. |
| A template gallery / marketplace | Legal exposure (retail art) and it is a different product. |
| Xbox/Switch spines | Different case geometry; needs its own measurement pass. |
| Editing print geometry per project | One bad mm ruins a print run; that is a support cost, not a feature. |
| Real-time collaboration | M2 teams first. |
