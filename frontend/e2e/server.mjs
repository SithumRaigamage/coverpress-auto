#!/usr/bin/env node
/* Offline API for the Playwright suite (and for looking at the UI without keys).

   Boots the real API — real routes, worker, renderer and QC — in a temp data
   dir, with RAWG, SteamGridDB, the image CDN and Ollama stubbed at the fetch
   boundary. Nothing leaves the machine and no real key is needed.

     node e2e/server.mjs            # API on 127.0.0.1:3100
     E2E_API_PORT=3200 node e2e/server.mjs */

import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { createApp } from "../../server/index.mjs";

const PORT = Number(process.env.E2E_API_PORT || 3100);
const UI_ORIGIN = process.env.E2E_UI_ORIGIN || "http://127.0.0.1:5174";
// Fixture art is served for real, so both the API and the browser can load it.
const IMG_PORT = PORT + 1;
const IMG_BASE = `http://127.0.0.1:${IMG_PORT}`;

const GAMES = [
  { id: 101, name: "Lantern Road", year: 2024, genres: ["Adventure", "RPG"], hue: 28, platforms: ["PlayStation 5", "PlayStation 4"], sgdb: true },
  { id: 102, name: "Neon Harbor", year: 2023, genres: ["Action"], hue: 290, platforms: ["PlayStation 5"] },
  { id: 103, name: "Glass Orchard", year: 2022, genres: ["Puzzle", "Indie"], hue: 150, platforms: ["PlayStation 4"] },
  { id: 104, name: "Iron Tide", year: 2021, genres: ["Shooter"], hue: 210, platforms: ["PlayStation 5", "PlayStation 4"] },
  { id: 105, name: "Paper Comet", year: 2020, genres: ["Platformer"], hue: 0, platforms: ["PlayStation 4"] },
  { id: 106, name: "Quiet Summit", year: 2019, genres: ["Simulation"], hue: 190, platforms: ["PlayStation 5"] },
];

/** A soft gradient with a few shapes — readable as "art" at a glance, no text, no logos. */
function art(width, height, hue, seed = 0) {
  const c = createCanvas(width, height);
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, width * 0.4, height);
  g.addColorStop(0, `hsl(${hue}, 55%, 42%)`);
  g.addColorStop(1, `hsl(${(hue + 40) % 360}, 45%, 10%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 6; i++) {
    const r = ((seed * 7 + i * 13) % 10) / 10;
    ctx.fillStyle = `hsla(${(hue + i * 25) % 360}, 70%, ${55 + i * 4}%, 0.22)`;
    ctx.beginPath();
    ctx.arc(width * (0.15 + 0.7 * r), height * (0.2 + 0.1 * i), Math.min(width, height) * (0.08 + 0.05 * i), 0, Math.PI * 2);
    ctx.fill();
  }
  return c.toBuffer("image/jpeg");
}

const IMAGES = new Map();
const img = (key, w, h, hue, seed) => {
  const url = `${IMG_BASE}/${key}.jpg`;
  IMAGES.set(url, () => art(w, h, hue, seed));
  return { url, w, h };
};

const fixtures = new Map(
  GAMES.map((g) => {
    const shots = [0, 1, 2].map((i) => ({ id: g.id * 10 + i, ...img(`${g.id}-shot-${i}`, 1280, 720, g.hue, i) }));
    const bg = img(`${g.id}-bg`, 1920, 1080, g.hue, 9);
    const grid = g.sgdb ? img(`${g.id}-grid`, 2000, 3000, g.hue, 4) : null;
    const hero = g.sgdb ? img(`${g.id}-hero`, 1920, 620, g.hue, 5) : null;
    return [g.id, { ...g, shots, bg, grid, hero }];
  })
);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const target = String(input);
  if (target.startsWith("https://api.rawg.io/")) {
    const u = new URL(target);
    const m = u.pathname.match(/^\/api\/games(?:\/(\d+))?(\/screenshots)?$/);
    if (!m) return json({ detail: "Not found." }, 404);
    if (!m[1]) {
      const q = (u.searchParams.get("search") || "").toLowerCase();
      const list = [...fixtures.values()].filter((g) => !q || g.name.toLowerCase().includes(q));
      return json({
        count: list.length,
        next: null,
        results: list.map((g) => ({
          id: g.id,
          slug: g.name.toLowerCase().replace(/\s+/g, "-"),
          name: g.name,
          released: `${g.year}-05-01`,
          genres: g.genres.map((name) => ({ name })),
          metacritic: 80,
          background_image: g.bg.url,
          platforms: g.platforms.map((name) => ({ platform: { name } })),
          short_screenshots: [{ id: -1 }, ...g.shots.map((s) => ({ id: s.id }))],
        })),
      });
    }
    const g = fixtures.get(Number(m[1]));
    if (!g) return json({ detail: "Not found." }, 404);
    if (m[2]) return json({ results: g.shots.map((s) => ({ id: s.id, image: s.url, width: s.w, height: s.h })) });
    return json({
      id: g.id,
      slug: g.name.toLowerCase().replace(/\s+/g, "-"),
      name: g.name,
      released: `${g.year}-05-01`,
      description_raw:
        `${g.name} is a ${g.genres.join(" and ").toLowerCase()} game about a long journey across a changing world. ` +
        "You travel light, meet strangers who need help, and slowly learn why the roads were closed in the first place. " +
        "Every region has its own weather, its own music and its own small mysteries to untangle.",
      publishers: [{ name: "Example Publisher" }],
      developers: [{ name: "Example Studio" }],
      genres: g.genres.map((name) => ({ name })),
      tags: [{ name: "Singleplayer" }],
      esrb_rating: { name: "Teen" },
      metacritic: 80,
      background_image: g.bg.url,
      background_image_additional: null,
      platforms: g.platforms.map((name) => ({ platform: { name } })),
    });
  }
  if (target.startsWith("https://www.steamgriddb.com/")) {
    const name = decodeURIComponent(target.split("/search/autocomplete/")[1] || "");
    if (name) {
      const g = [...fixtures.values()].find((x) => x.name === name && x.sgdb);
      return json({ data: g ? [{ id: g.id * 100, name: g.name }] : [] });
    }
    const g = [...fixtures.values()].find((x) => x.sgdb && target.includes(`/game/${x.id * 100}`));
    if (!g) return json({ data: [] });
    if (target.includes("/grids/")) return json({ data: [{ id: 1, url: g.grid.url, thumb: g.grid.url, width: g.grid.w, height: g.grid.h }] });
    return json({ data: [{ id: 2, url: g.hero.url, thumb: g.hero.url, width: g.hero.w, height: g.hero.h }] });
  }
  if (target.startsWith("https://generativelanguage.googleapis.com/")) {
    // Stubbed Gemini: a 3:4 picture, no network, no billing.
    const data = art(864, 1184, Math.floor(Math.random() * 360), 7).toString("base64");
    return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data } }] } }] });
  }
  if (target.includes(":11434")) throw new Error("connect ECONNREFUSED (Ollama is not part of the e2e stub)");
  return realFetch(input, init);
};

const cache = new Map();
const images = http.createServer((req, res) => {
  const key = `${IMG_BASE}${req.url}`;
  const make = IMAGES.get(key);
  if (!make) return res.writeHead(404).end();
  if (!cache.has(key)) cache.set(key, make());
  res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=3600" }).end(cache.get(key));
});
await new Promise((resolve) => images.listen(IMG_PORT, "127.0.0.1", resolve));

process.env.RAWG_KEY = "e2e-rawg-key";
process.env.SGDB_KEY = "e2e-sgdb-key";
process.env.GEMINI_API_KEY = "e2e-gemini-key";
process.env.GEMINI_GAP_MS = "0";
process.env.VISION_REVIEW = "false";
process.env.DEV_MODE = "true";
process.env.OLLAMA_HOST = "http://127.0.0.1:11434";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "coverpress-e2e-"));
const app = createApp({ dataDir, secret: "e2e-secret-0123456789", appOrigin: UI_ORIGIN, workerIntervalMs: 200, logger: { log() {}, error() {} } });
app.db.prepare("UPDATE accounts SET plan = 'studio'").run();
const { url } = await app.start(PORT, "127.0.0.1");
console.log(`e2e API on ${url} (data: ${dataDir})`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    images.close();
    await fs.rm(dataDir, { recursive: true, force: true });
    process.exit(0);
  });
}
