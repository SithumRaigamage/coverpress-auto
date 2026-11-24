/* The game catalog: RAWG metadata and art candidates, cached on disk.

   Everything fetched here is cached under data/art/cache/ keyed by RAWG id, so
   opening a game twice, or building a cover from it, costs zero API calls the
   second time. Search pages are cached in memory for ten minutes so scrolling
   the library back and forth does not burn the 20k/month RAWG quota.

   SteamGridDB is personal, non-commercial use only. It is called only when
   SGDB_KEY is set in .env; with no key the art list is RAWG-only. */

import fs from "node:fs/promises";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { rawgGame, rawgSearch, sgdbArt, sgdbGrids, SGDB_PAGE, fetchBuffer } from "../lib/sources.mjs";
import { artFit } from "../lib/qc.mjs";
import { coverCfg } from "../lib/cover.mjs";
import { safeJoin } from "./http.mjs";

const SEARCH_TTL = 10 * 60 * 1000;
const SEARCH_MAX = 200;

export function createCatalog({ dataDir, keys, onRawgCall = () => {}, logger = console, generated = null }) {
  const searchCache = new Map();
  const inflight = new Map();

  const cacheFile = (name) => safeJoin(dataDir, `art/cache/${name}`);

  async function readCache(name) {
    const file = cacheFile(name);
    if (!file) return null;
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return null;
    }
  }

  async function writeCache(name, value) {
    const file = cacheFile(name);
    if (!file) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value));
  }

  /** One fetch per key at a time, so a double-click does not double the API calls. */
  function once(key, fn) {
    if (inflight.has(key)) return inflight.get(key);
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  const id = (rawgId) => {
    const n = Number(rawgId);
    if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error("A RAWG game id is a positive integer."), { status: 400 });
    return n;
  };

  function requireRawg() {
    const key = keys.rawg();
    if (!key) {
      throw Object.assign(new Error("No RAWG API key configured. Set RAWG_KEY in .env, then restart the server."), {
        status: 400,
        permanent: true,
      });
    }
    return key;
  }

  /* ------------------------------------------------------------ search */

  async function search(params) {
    const key = requireRawg();
    const cacheKey = JSON.stringify(params);
    const hit = searchCache.get(cacheKey);
    if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.value;
    const value = await rawgSearch(params.q, { ...params, key, onCall: onRawgCall });
    searchCache.set(cacheKey, { at: Date.now(), value });
    if (searchCache.size > SEARCH_MAX) searchCache.delete(searchCache.keys().next().value);
    return value;
  }

  /* -------------------------------------------------------------- game */

  /** RAWG detail + screenshots for one game, from disk after the first fetch. */
  async function game(rawgId) {
    const n = id(rawgId);
    const cached = await readCache(`rawg-${n}.json`);
    if (cached) return cached;
    const key = requireRawg();
    return once(`rawg-${n}`, async () => {
      const value = await rawgGame(n, key, { onCall: onRawgCall }).catch((err) => {
        // A 4xx from RAWG (unknown id, bad key) will not fix itself on retry.
        if (/^4\d\d /.test(err.message)) {
          throw Object.assign(new Error(`RAWG could not return game #${n} (${err.message.slice(0, 3)}).`), {
            status: err.message.startsWith("404") ? 404 : 502,
            permanent: true,
          });
        }
        throw err;
      });
      value.background = value.background ? await measure(value.background) : null;
      value.backgroundAdditional = value.backgroundAdditional ? await measure(value.backgroundAdditional) : null;
      value.fetchedAt = new Date().toISOString();
      await writeCache(`rawg-${n}.json`, value);
      return value;
    });
  }

  /** RAWG does not report the background image's size; download it once to measure. */
  async function measure(url) {
    try {
      const img = await loadImage(await fetchBuffer(url));
      return { url, width: img.width, height: img.height };
    } catch (err) {
      logger.error?.(`could not measure ${url.split("?")[0]}: ${err.message}`);
      return { url, width: 0, height: 0 };
    }
  }

  async function sgdb(rawgId, title) {
    const key = keys.sgdb();
    if (!key) return { enabled: false, items: [] };
    const n = id(rawgId);
    const cached = await readCache(`sgdb-${n}.json`);
    if (cached) return { enabled: true, ...cached };
    return once(`sgdb-${n}`, async () => {
      try {
        const value = await sgdbArt(title, key);
        await writeCache(`sgdb-${n}.json`, value);
        return { enabled: true, ...value };
      } catch (err) {
        // A SteamGridDB outage must not block a cover: RAWG art still works.
        logger.error?.(`SteamGridDB lookup failed for ${title}: ${err.message}`);
        return { enabled: true, items: [], error: "SteamGridDB could not be reached." };
      }
    });
  }

  /**
   * Fetch the next page of SteamGridDB grids into the cache. "Run again" calls
   * this once every grid it knows has been used, so reruns keep bringing new
   * art instead of cycling. Pages are tried in order; a page with nothing new
   * (or a short page) marks the list as exhausted, and it is not asked again.
   */
  async function moreSgdb(rawgId) {
    const key = keys.sgdb();
    if (!key) return { added: 0, reason: "off" };
    const n = id(rawgId);
    return once(`sgdb-more-${n}`, async () => {
      let cur = await readCache(`sgdb-${n}.json`);
      if (!cur) {
        const g = await game(rawgId);
        await sgdb(rawgId, g.meta.name);
        cur = await readCache(`sgdb-${n}.json`);
      }
      if (!cur?.gameId) return { added: 0, reason: "no_game" };
      if (cur.exhausted) return { added: 0, reason: "exhausted" };
      const seen = new Set((cur.items || []).map((i) => i.url));
      let page = Number(cur.page ?? 0);
      let fresh = [];
      let last = { items: [] };
      // Two tries: whether SteamGridDB counts pages from 0 or 1, one of them is new.
      for (let tries = 0; tries < 2 && !fresh.length; tries++) {
        page += 1;
        last = await sgdbGrids(cur.gameId, key, { page });
        fresh = last.items.filter((i) => !seen.has(i.url));
        if (last.items.length < SGDB_PAGE) break;
      }
      const exhausted = !fresh.length || last.items.length < SGDB_PAGE;
      await writeCache(`sgdb-${n}.json`, { ...cur, items: [...(cur.items || []), ...fresh], page, exhausted });
      return { added: fresh.length, exhausted, page };
    });
  }

  /* --------------------------------------------------------------- art */

  const candidate = (source, kind, idPart, url, width, height, thumb) => {
    const fit = artFit(width, height);
    return {
      id: `${source === "RAWG" ? "rawg" : "sgdb"}:${idPart}`,
      source,
      kind,
      url,
      thumb: thumb || url,
      width,
      height,
      fit: fit.score,
      printReady: fit.printReady,
    };
  };

  /** Every art candidate for a game, scored against the 1512 × 1748 px panel, best first. */
  async function art(rawgId) {
    const g = await game(rawgId);
    const items = [];
    const seen = new Set();
    const push = (item) => {
      if (!item.url || seen.has(item.url)) return;
      seen.add(item.url);
      items.push(item);
    };
    for (const s of g.screenshots || []) push(candidate("RAWG", "screenshot", `shot-${s.id}`, s.url, s.width, s.height));
    if (g.background) push(candidate("RAWG", "background", "background", g.background.url, g.background.width, g.background.height));
    if (g.backgroundAdditional) {
      const b = g.backgroundAdditional;
      push(candidate("RAWG", "background", "background-2", b.url, b.width, b.height));
    }
    const sg = await sgdb(rawgId, g.meta.name);
    for (const s of sg.items || []) push(candidate("SteamGridDB", s.kind, `${s.kind === "hero banner" ? "hero" : "grid"}-${s.id}`, s.url, s.width, s.height, s.thumb));
    // AI images made for this game (data/art/generated), already scored.
    for (const a of generated ? await generated.list(g.meta.id) : []) push(a);

    items.sort((a, b) => b.fit - a.fit || b.width * b.height - a.width * a.height);
    return {
      items,
      best: items[0]?.id || null,
      counts: {
        all: items.length,
        rawg: items.filter((i) => i.source === "RAWG").length,
        sgdb: items.filter((i) => i.source === "SteamGridDB").length,
        ai: items.filter((i) => i.source === "AI").length,
      },
      sgdb: { enabled: sg.enabled, error: sg.error || null },
      ai: { enabled: Boolean(generated?.enabled()), model: generated?.model() || null },
    };
  }

  /** Card chips for the library, from the disk cache only — never a network call. */
  async function summary(rawgId) {
    const g = await readCache(`rawg-${Number(rawgId)}.json`);
    if (!g) return null;
    const sg = (await readCache(`sgdb-${Number(rawgId)}.json`)) || { items: [] };
    const sizes = [
      ...(g.screenshots || []),
      ...(g.background ? [g.background] : []),
      ...(sg.items || []),
    ];
    return {
      rawg: (g.screenshots || []).length + (g.background ? 1 : 0),
      sgdb: (sg.items || []).length,
      printReady: sizes.some((s) => artFit(s.width, s.height).printReady),
    };
  }

  /* -------------------------------------------------------------- copy */

  /** Deterministic copy from RAWG data — the same fallback the renderer uses. */
  function fallbackCopy(meta) {
    const cfg = coverCfg({ meta, platform: "PS5" });
    return {
      tagline: cfg.tagline,
      blurb: cfg.blurb,
      features: String(cfg.features || "").split("\n").filter(Boolean),
    };
  }

  async function cachedCopy(rawgId) {
    return readCache(`copy-${id(rawgId)}.json`);
  }

  async function saveCopy(rawgId, copy) {
    await writeCache(`copy-${id(rawgId)}.json`, copy);
  }

  /** Local file for a generated-art URL, so the build reads it from disk. */
  const localFile = (url) => (generated ? generated.localFile(url) : null);

  return { search, game, art, moreSgdb, summary, fallbackCopy, cachedCopy, saveCopy, localFile };
}
