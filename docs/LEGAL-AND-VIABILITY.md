# Legal exposure and commercial viability

Not legal advice. This is the research a product owner should do before charging money,
with the sources you would take to a lawyer.

Short version:

1. **The tool is defensible. The business model you picked is the weak part.**
2. **Two integrations cannot be used commercially as built** — SteamGridDB explicitly,
   RAWG ambiguously.
3. **A hosted, paid service that stores and reproduces publisher artwork is the risky
   quadrant.** A free, local, user-supplied-art tool is the safe one.
4. **$19/month is the wrong price for the job.** The need is one shelf, once.

## 1. Where the copyright risk actually sits

Cover art is two separate rights:

- **Copyright** in the artwork, characters and screenshots — owned by the publisher or
  developer.
- **Trademark** in logos, wordmarks and rating marks — PlayStation/PS5/PS4, ESRB, PEGI,
  Blu-ray, Dolby, DTS, publisher logos.

Making a copy for your own use is a personal act. **Charging for the reproduction changes
who is doing it.** The Game Crafter states the point plainly for print services: they
will not print copyrighted or trademarked material *even for personal use*, because a
commercial company doing the printing breaks the non-commercial clause
([help.thegamecrafter.com](https://help.thegamecrafter.com/article/9-intellectual-property)).

So the dividing line is not "personal vs commercial intent of the buyer". It is **who
performs the reproduction at scale, for money**.

| Shape | Exposure | Why |
| --- | --- | --- |
| Local CLI, user's own art, no payment | Low | User reproduces on their own machine, at home. |
| Free browser tool, art never uploaded (CoverStitch) | Low | Nothing is stored or served; no commercial reproduction. |
| Paid SaaS, user-uploaded art, generic marks | Medium | You host and reproduce; you need terms, takedowns and a strict no-logos policy. |
| Paid SaaS that fetches retail grids/art automatically | High | You are distributing third-party artwork as a feature. |
| Print-and-ship service | Highest | You are the printer. This is the case Game Crafter refuses outright. |

Also note: the "not for sale" legal line printed on the cover does **not** make selling
it lawful. It is a notice of intent, not a licence.

## 2. The two integrations, specifically

### SteamGridDB — cannot be used in a commercial product

Their Terms of Use require you to

> access the Service for any reason other than your personal, non-commercial use

and forbid

> use the Site or the Service for the solicitation of business in the course of trade or
> in connection with a commercial enterprise

([steamgriddb.com/terms](https://www.steamgriddb.com/terms)).

Using a *customer's* API key does not launder this: the commercial service is still the
one making the requests. On top of the contract problem, the "grid" category frequently
contains finished retail art with the real logo lockup baked in — the exact thing the
renderer is built to avoid.

**What changed in the product:** a hosted or paid deployment does not call SteamGridDB.
The local, single-user app may opt in for personal use by setting `SGDB_KEY` in `.env`
(off by default); the key stays server-side, the settings page states the personal-use
restriction, and the footer credits SteamGridDB whenever it is on. Grids are requested in
no-logo/alternate/blurred/material styles to avoid baked-in logo lockups. The CLI
(personal, local) supports it as before. Leaving `SGDB_KEY` unset is a launch requirement
for any hosted version.

### RAWG — ambiguous, needs written permission or a paid plan

RAWG's own documentation contradicts itself:

- The API docs say free for personal use with attribution, and "free for commercial use
  for startups and hobby projects with not more than 100,000 monthly active users"
  ([api.rawg.io/docs](https://api.rawg.io/docs/)).
- The pricing page sells **Free = "Non-commercial projects only"** and **Business
  ($149/mo) = commercial use** ([rawg.io/apidocs](https://rawg.io/apidocs)).
- The Terms of Service grant "a personal non-transferable right" and prohibit
  commercial extraction ([rawg.io/tos_api](https://rawg.io/tos_api)).

**Practical position:** if you charge money, budget for the Business plan or get written
confirmation that a BYO-key model is acceptable, and keep the attribution on every back
panel (already implemented). Do not build the product around the free tier.

### Everything else

- **ESRB/PEGI marks** are licensed property; the ESRB site's terms prohibit separating
  graphics from their context without permission
  ([esrb.org/terms-of-use](https://www.esrb.org/terms-of-use)). The renderer already
  draws a plain bordered rating box instead — keep it that way.
- **PS4/PS5 lettering**: nominative use to say what the wrap fits is the normal,
  defensible practice, but never use the PlayStation logo/wordmark, never imply
  endorsement, and put the disclaimer where a buyer sees it.
- **Sony's notice** confirms PS4/PS5/PlayStation are registered trademarks
  ([sonyinteractive.com](https://sonyinteractive.com/en/copyright-and-trademark-notice)).

## 3. What is now in the product because of this

- SteamGridDB is off unless `SGDB_KEY` is set in `.env` (local, personal use only); a
  hosted deployment leaves it unset (`server/auth.mjs`, `server/catalog.mjs`).
- Front art is fetched automatically (RAWG screenshots and backgrounds, plus SteamGridDB
  when enabled) and ranked by fit; uploading is a hidden override in review.
- `GET /api/legal` returns the acceptable-use text as data (`server/legal.mjs`), so the frontend renders it without the rules living in markup.
- A takedown contact slot: set `LEGAL_CONTACT` in the environment.
- Tests assert the legal page exists, that SteamGridDB is never called without `SGDB_KEY`, and that its restriction is stated.

What a lawyer should still write for you, before charging: Terms of Service, Privacy
Policy (you hold emails, uploads and IP addresses), a DMCA/takedown procedure, and a
GDPR data-processing position if you take EU customers.

## 4. Is it a good SaaS business?

Honest answer: **not as a venture-scale SaaS; plausibly as a niche paid tool** — and the
current shape is the worst of both.

Evidence against the current plan:

- **The closest competitor is free and needs no account.** CoverStitch combines
  front/spine/back in the browser, no upload to a server, no signup, batch mode included
  ([coverstitch.io](https://coverstitch.io/how-to-print.html)). Your paid product has to
  beat free-and-local while also carrying hosting, storage and legal risk.
- **The job is finite.** A collector with 60 digital games does this once. A $19/month
  subscription asks them to keep paying after the shelf is done; 10 free covers is not
  enough to finish, and 500 is absurd for the same person. That is a churn machine.
- **The valuable input is not yours.** Art quality decides the output, and the legal
  answer says the art must come from the user. You are selling layout + print imposition
  — valuable, but a $5 problem, not a $19/month one.
- **Demand is narrow and already served** by The Cover Project, VGBoxArt, Photoshop
  templates and Reddit threads.

Where the money actually is, in order of legal risk *ascending*:

1. **One-time licence / credits.** $4–6 per shelf, or $15 lifetime for the local tool.
   Matches a finite job, no churn, no hosting for the paid tier.
2. **Pro features on a free tool.** Batch imposition, custom case presets (Switch, PS3,
   DVD), duplex inside art, PDF export. One-time unlock, art never leaves the machine.
3. **B2B**: retro shops, game cafés, museums and indie studios displaying physical
   libraries. Fewer, larger customers; invoicing instead of subscriptions; they need
   *blank/own-art* inserts, which is legally cleaner than fan covers.
4. **Print-on-demand**: highest willingness to pay, highest legal exposure. Only with
   your own original artwork or explicit licences.

Verdict: build it as **a paid tool for people restoring their own shelves**, priced per
use, with hosting kept minimal — or keep it local. Do not raise money on the current
model, and do not run paid ads into a $19/month subscription that most users cancel after
one month.

## 5. What to validate before writing more code

- 20 collectors: how many would pay $5 once for a finished shelf? Ask for the card, not
  an opinion.
- Which case formats they actually need (PS3, Switch, PS2 are bigger retro groups than
  PS5 digital owners).
- Whether they already own usable art, or expect you to supply it. If they expect you to
  supply it, the business is a different (and much riskier) one.
- Support load per 100 covers — the review queue exists because renders fail in ways
  users cannot diagnose.
