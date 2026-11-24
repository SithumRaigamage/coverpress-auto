/* "Run again" brings new art: it alternates sources, and once every
   SteamGridDB grid it knows has been used it fetches SteamGridDB's next page.
   SteamGridDB and RAWG are stubbed at the fetch boundary; no server, no render. */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCatalog } from "../server/catalog.mjs";
import { nextUnused } from "../server/build.mjs";

const realFetch = globalThis.fetch;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const grid = (n) => ({ id: n, url: `https://cdn.test/grid-${n}.png`, thumb: `https://cdn.test/t-${n}.png`, width: 600, height: 900 });

let pages = {};
const sgdbCalls = [];
globalThis.fetch = (input, init) => {
  const t = String(input);
  if (t.startsWith("https://www.steamgriddb.com/")) {
    sgdbCalls.push(t);
    assert.equal(init?.headers?.Authorization, "Bearer sg-key");
    const u = new URL(t);
    if (u.pathname.startsWith("/api/v2/search/autocomplete/")) return Promise.resolve(json({ success: true, data: [{ id: 900, name: "Pager Game" }] }));
    if (u.pathname === "/api/v2/grids/game/900") return Promise.resolve(json({ success: true, data: pages[u.searchParams.get("page")] || [] }));
    if (u.pathname === "/api/v2/heroes/game/900") return Promise.resolve(json({ success: true, data: [] }));
  }
  if (t.startsWith("https://api.rawg.io/")) {
    const p = new URL(t).pathname;
    if (p === "/api/games/42") return Promise.resolve(json({ id: 42, slug: "pager", name: "Pager Game", genres: [], platforms: [], background_image: null }));
    if (p === "/api/games/42/screenshots") return Promise.resolve(json({ results: [] }));
  }
  return Promise.resolve(new Response("", { status: 404 }));
};

const dirs = [];
async function catalog() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "coverpress-rerun-"));
  dirs.push(dataDir);
  return createCatalog({ dataDir, keys: { rawg: () => "rawg-key", sgdb: () => "sg-key" }, logger: { log() {}, error() {} } });
}
after(async () => {
  globalThis.fetch = realFetch;
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true });
});

const range = (from, n) => Array.from({ length: n }, (_, i) => grid(from + i));

test("reruns alternate sources instead of walking down one source", () => {
  const c = [
    { url: "r1", source: "RAWG" },
    { url: "r2", source: "RAWG" },
    { url: "s1", source: "SteamGridDB" },
  ];
  assert.equal(nextUnused(c, ["r1"], { lastSource: "RAWG" }).pick.url, "s1");
  assert.equal(nextUnused(c, ["r1", "s1"], { lastSource: "SteamGridDB" }).pick.url, "r2");
  // One source left: it still moves on to the next unused image.
  assert.equal(nextUnused(c, ["s1", "r1"], { lastSource: "RAWG" }).pick.url, "r2");
  // No source on the candidates (the CLI's shape): best unused first, as before.
  assert.equal(nextUnused([{ url: "a" }, { url: "b" }], ["a"]).pick.url, "b");
});

test("more SteamGridDB grids: next page appended, then exhausted on a short page", async () => {
  pages = { 0: range(1, 12), 1: range(13, 12), 2: range(25, 5) };
  sgdbCalls.length = 0;
  const cat = await catalog();
  const first = await cat.art(42);
  assert.equal(first.counts.sgdb, 12);

  let more = await cat.moreSgdb(42);
  assert.equal(more.added, 12);
  assert.equal((await cat.art(42)).counts.sgdb, 24);

  more = await cat.moreSgdb(42);
  assert.equal(more.added, 5);
  assert.equal(more.exhausted, true);
  assert.equal((await cat.art(42)).counts.sgdb, 29);

  const before = sgdbCalls.length;
  assert.equal((await cat.moreSgdb(42)).reason, "exhausted");
  assert.equal(sgdbCalls.length, before, "an exhausted list is not asked again");
  assert.ok(sgdbCalls.some((u) => /page=2/.test(u)));
});

test("if SteamGridDB counts pages from 1, the repeated page is skipped and the next one is used", async () => {
  pages = { 0: range(1, 12), 1: range(1, 12), 2: range(40, 12) };
  const cat = await catalog();
  await cat.art(42);
  const more = await cat.moreSgdb(42);
  assert.equal(more.added, 12);
  const ids = (await cat.art(42)).items.filter((i) => i.source === "SteamGridDB").map((i) => i.url);
  assert.equal(new Set(ids).size, 24, "no duplicates");
});

test("without SGDB_KEY nothing is fetched", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "coverpress-rerun-"));
  dirs.push(dataDir);
  const cat = createCatalog({ dataDir, keys: { rawg: () => "rawg-key", sgdb: () => "" }, logger: { log() {}, error() {} } });
  assert.equal((await cat.moreSgdb(42)).reason, "off");
});
