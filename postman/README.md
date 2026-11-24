# Postman collection

Import `coverpress-apis.json` into Postman, then set two collection variables to the
same values as in `.env`:

| Variable | Where to get it | `.env` name |
| --- | --- | --- |
| `rawgKey` | https://rawg.io/apidocs (free tier, 20,000 requests a month) | `RAWG_KEY` |
| `sgdbKey` | https://www.steamgriddb.com/profile/preferences/api | `SGDB_KEY` |

The other variables fill themselves: each request saves the ids the next one needs
(`rawgGameId`, `sgdbGameId`, `artId`, `coverId`, `renderId`). Change `gameName` to
try another game.

## Folders

**RAWG**: the exact calls Coverpress makes. The library (popular PS5 + PS4, or a
search), game details, and screenshots. Screenshots and the two background images
are front-art candidates; screenshots also fill the back panel.

**SteamGridDB**: the exact calls Coverpress makes, with the Bearer key. Autocomplete
finds the game, then portrait grids (12 per page, no logo lockups) and hero banners.
"Portrait grids, next page" is what a rerun fetches once every grid it knows has been
used. Each full page bumps `sgdbPage`, so you can walk the pages by sending it again.

**Coverpress local API**: the app on `http://127.0.0.1:3000` (start it with
`npm run dev`). Run top to bottom: search, art candidates, generate a cover, watch
the run, rerun, versions, approve. "3 · Deleting" holds the delete endpoints. Every
request in it deletes data.

## How a rerun picks new art

"Rerun: new variant" (`POST /api/covers/:id/build` with `{ "mode": "variant" }`):

1. Takes the best-fitting image this cover hasn't used, from a different source than
   last time (RAWG → SteamGridDB → AI), so each version visibly changes.
2. When every SteamGridDB grid it knows has been used, it fetches SteamGridDB's next
   page and adds it to `data/art/cache/sgdb-<rawgId>.json`. A short page means the
   list has run out and SteamGridDB isn't asked again for that game.
3. Rotates the back-panel screenshots, redrafts the copy with a new seed and varies the
   layout.

RAWG usually has only a handful of screenshots per game, all fetched the first time,
so new art on later reruns comes from SteamGridDB (and from AI art, when Gemini is set up).

SteamGridDB is for personal, non-commercial use only. Coverpress asks for art without
logos, but some grids still carry a real logo. Check before you print.
