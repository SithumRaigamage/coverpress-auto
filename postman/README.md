# Postman collection — upstream APIs

Import `coverpress-apis.json` into Postman, then set the collection variables:

| Variable | Where to get it |
| --- | --- |
| `rawgKey` | https://rawg.io/apidocs — free tier, key goes in the query string |
| `sgdbKey` | https://www.steamgriddb.com/profile/preferences/api |
| `gameName` | Any title, e.g. `Elden Ring` |
| `rawgGameId` | Copy an `id` from the RAWG "Search games" response |
| `sgdbGameId` | Copy `data[0].id` from the SteamGridDB "Autocomplete" response |

Run **Search games → Game details → Screenshots** to see exactly the data the
build worker consumes. `lib/sources.mjs` maps these responses onto cover slots
and caches them, so a rebuild costs no API calls.

**SteamGridDB is for the offline CLI only.** Its terms of use allow personal,
non-commercial access; the hosted app refuses an `sgdb` key and never calls it.
Grids frequently contain retail logo lockups, which the renderer is built to
avoid. See `docs/LEGAL-AND-VIABILITY.md` before using these images.
