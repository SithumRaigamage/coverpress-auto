/* Game catalog, art picker, automated flow and run progress.

   RAWG, SteamGridDB and the image CDN are stubbed at the fetch boundary, so the
   real API, the real worker and the real renderer run with no network or keys. */

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { boot, png, getJson, post } from "./helpers.mjs";

const realFetch = globalThis.fetch;
const calls = [];

const IMAGES = {
  "https://img.test/shot-1.jpg": png(1280, 720),
  "https://img.test/shot-2.jpg": png(1280, 720),
  "https://img.test/bg.jpg": png(1920, 1080),
  "https://img.test/grid.png": png(1024, 1536),
  "https://img.test/hero.png": png(1920, 620),
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const GAME = {
  id: 42,
  slug: "test-quest",
  name: "Test Quest",
  released: "2024-03-01",
  description_raw: "A long road through a quiet kingdom. You carry a lantern and a map.",
  publishers: [{ name: "Example Publisher" }],
  developers: [{ name: "Example Studio" }],
  genres: [{ name: "Adventure" }, { name: "RPG" }],
  tags: [{ name: "Singleplayer" }],
  esrb_rating: { name: "Teen" },
  metacritic: 88,
  background_image: "https://img.test/bg.jpg",
  background_image_additional: null,
  platforms: [{ platform: { name: "PlayStation 5" } }],
};

function stubbedFetch(input, init) {
  const target = String(input);
  if (target.startsWith("https://api.rawg.io/")) {
    calls.push({ target, init });
    const u = new URL(target);
    if (u.pathname === "/api/games") {
      return Promise.resolve(
        json({
          count: 2,
          next: u.searchParams.get("page") === "1" ? "https://api.rawg.io/api/games?page=2" : null,
          results: [
            { ...GAME, short_screenshots: [{ id: -1 }, { id: 1 }, { id: 2 }] },
            { id: 7, slug: "other", name: "Other Game", released: "2021-01-01", genres: [], platforms: [], short_screenshots: [] },
          ],
        })
      );
    }
    if (u.pathname === "/api/games/42") return Promise.resolve(json(GAME));
    if (u.pathname === "/api/games/42/screenshots") {
      return Promise.resolve(
        json({
          results: [
            { id: 1, image: "https://img.test/shot-1.jpg", width: 1280, height: 720 },
            { id: 2, image: "https://img.test/shot-2.jpg", width: 1280, height: 720 },
          ],
        })
      );
    }
    return Promise.resolve(json({ detail: "Not found." }, 404));
  }
  if (target.startsWith("https://www.steamgriddb.com/")) {
    calls.push({ target, init });
    if (target.includes("/search/autocomplete/")) return Promise.resolve(json({ data: [{ id: 900, name: "Test Quest" }] }));
    if (target.includes("/grids/game/900")) {
      return Promise.resolve(json({ data: [{ id: 5, url: "https://img.test/grid.png", thumb: "https://img.test/grid.png", width: 1024, height: 1536 }] }));
    }
    if (target.includes("/heroes/game/900")) {
      return Promise.resolve(json({ data: [{ id: 6, url: "https://img.test/hero.png", width: 1920, height: 620 }] }));
    }
  }
  if (target.startsWith("https://img.test/")) {
    const buf = IMAGES[target];
    return Promise.resolve(buf ? new Response(buf, { status: 200 }) : new Response("", { status: 404 }));
  }
  if (target.startsWith("http://127.0.0.1:11434")) return Promise.reject(new Error("connect ECONNREFUSED"));
  return realFetch(input, init);
}

const saved = { RAWG_KEY: process.env.RAWG_KEY, SGDB_KEY: process.env.SGDB_KEY, LLM_PROVIDER: process.env.LLM_PROVIDER };
process.env.RAWG_KEY = "test-rawg-key";
delete process.env.SGDB_KEY;
globalThis.fetch = stubbedFetch;

const server = await boot();
server.app.db.prepare("UPDATE accounts SET plan = 'studio'").run();
const url = server.url;

after(async () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await server.stop();
});
before(() => { calls.length = 0; });

const rawgCalls = () => calls.filter((c) => c.target.startsWith("https://api.rawg.io/"));
const sgdbCalls = () => calls.filter((c) => c.target.startsWith("https://www.steamgriddb.com/"));

test("an empty search browses popular PS5 and PS4 games, paged", async () => {
  calls.length = 0;
  const { res, body } = await getJson(url, "/api/rawg/search?page=1");
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.games[0].name, "Test Quest");
  assert.equal(body.games[0].screenshotCount, 2, "RAWG's -1 pseudo-screenshot is not counted");
  assert.equal(body.games[0].year, 2024);
  assert.equal(body.next, true);
  const q = new URL(rawgCalls()[0].target).searchParams;
  assert.equal(q.get("ordering"), "-added");
  assert.equal(q.get("platforms"), "187,18");
  assert.equal(q.get("search"), null);
});

test("search filters reach RAWG, and a repeated page is served from cache", async () => {
  calls.length = 0;
  await getJson(url, "/api/rawg/search?q=quest&platform=PS4&genre=action&year=2024&ordering=-metacritic&page=2");
  const q = new URL(rawgCalls()[0].target).searchParams;
  assert.equal(q.get("search"), "quest");
  assert.equal(q.get("platforms"), "18");
  assert.equal(q.get("genres"), "action");
  assert.equal(q.get("dates"), "2024-01-01,2024-12-31");
  assert.equal(q.get("ordering"), "-metacritic");
  assert.equal(q.get("page"), "2");
  await getJson(url, "/api/rawg/search?q=quest&platform=PS4&genre=action&year=2024&ordering=-metacritic&page=2");
  assert.equal(rawgCalls().length, 1, "the second identical request costs no RAWG call");
});

test("game art without SGDB_KEY is RAWG-only, scored and best-first", async () => {
  calls.length = 0;
  const { res, body } = await getJson(url, "/api/games/42/art");
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(sgdbCalls().length, 0, "SteamGridDB is never called without a key");
  assert.equal(body.sgdb.enabled, false);
  assert.equal(body.counts.sgdb, 0);
  assert.equal(body.counts.rawg, 3);
  const bg = body.items.find((i) => i.kind === "background");
  assert.deepEqual([bg.width, bg.height], [1920, 1080], "the background is measured, not guessed");
  for (let i = 1; i < body.items.length; i++) assert.ok(body.items[i - 1].fit >= body.items[i].fit);
  assert.equal(body.best, body.items[0].id);
  assert.equal(body.panel.widthPx, 1512);
});

test("a game opened twice costs no further RAWG calls", async () => {
  calls.length = 0;
  await getJson(url, "/api/games/42");
  await getJson(url, "/api/games/42/art");
  assert.equal(rawgCalls().length, 0);
});

test("with SGDB_KEY set, portrait grids join the list with a Bearer key and win on fit", async () => {
  // A fresh boot so the RAWG-only cache from the earlier test does not apply to SGDB.
  process.env.SGDB_KEY = "test-sgdb-key";
  const other = await boot();
  try {
    calls.length = 0;
    const { body } = await getJson(other.url, "/api/games/42/art");
    assert.equal(body.sgdb.enabled, true);
    assert.equal(body.counts.sgdb, 2);
    assert.equal(sgdbCalls()[0].init.headers.Authorization, "Bearer test-sgdb-key");
    const top = body.items[0];
    assert.equal(top.source, "SteamGridDB");
    assert.equal(top.kind, "portrait grid");
    assert.ok(body.items.some((i) => i.kind === "hero banner"));
    assert.equal(JSON.stringify(body).includes("test-sgdb-key"), false);
  } finally {
    delete process.env.SGDB_KEY;
    await other.stop();
  }
});

test("game detail carries metadata and deterministic copy when no model answers", async () => {
  const { body } = await getJson(url, "/api/games/42");
  assert.equal(body.game.name, "Test Quest");
  assert.equal(body.game.developer, "Example Studio");
  assert.equal(body.game.year, 2024);
  assert.equal(body.copy.source, "rawg");
  assert.match(body.copy.blurb, /quiet kingdom/);

  const draft = await post(url, "/api/games/42/copy", {});
  assert.equal(draft.status, 200);
  assert.equal((await draft.json()).source, "rawg", "Ollama is unreachable in tests, so RAWG copy is used");
});

let coverId;

test("Run all steps creates a cover with the picked art, layout and edited copy", async () => {
  const art = (await getJson(url, "/api/games/42/art")).body;
  const pick = art.items.find((i) => i.kind === "screenshot");
  const res = await post(url, "/api/games/42/covers", {
    platform: "PS4",
    style: "minimal",
    artId: pick.id,
    copy: { tagline: "Carry the lantern", blurb: "Edited blurb ".repeat(10), features: ["One", "Two"] },
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.created, true);
  assert.equal(body.cover.platform, "PS4");
  assert.equal(body.cover.style, "minimal");
  assert.equal(body.cover.rawgId, 42);
  assert.equal(body.cover.status, "queued");
  coverId = body.cover.id;

  const run = (await getJson(url, `/api/covers/${coverId}/run`)).body;
  assert.equal(run.run.state, "queued");
  assert.equal(run.steps.length, 7);
  assert.deepEqual(run.run.steps.map((s) => s.state), Array(7).fill("pending"));
});

test("the worker reports all seven steps, and the run endpoint shows the render", async () => {
  await server.app.worker.drain();
  const { body } = await getJson(url, `/api/covers/${coverId}/run`);
  assert.equal(body.run.state, "done", JSON.stringify(body.run));
  assert.deepEqual(
    body.run.steps.map((s) => s.key),
    ["metadata", "collect", "pick", "copy", "render", "qc", "route"]
  );
  for (const s of body.run.steps.slice(0, 5)) assert.ok(["done", "skipped"].includes(s.state), `${s.key}: ${s.state}`);
  assert.match(body.run.steps[2].detail, /your pick/);
  assert.match(body.run.steps[3].detail, /Saved copy/);
  assert.ok(body.run.log.length >= 7);
  assert.ok(body.run.finishedAt);
  assert.ok(body.render.wrapUrl.endsWith("/wrap.png"));
  assert.ok(["auto_approved", "needs_review", "failed"].includes(body.cover.status));
  assert.equal(body.cover.front.kind, "screenshot");

  const cover = server.app.db.prepare("SELECT copy, overrides FROM covers WHERE id = ?").get(coverId);
  assert.equal(JSON.parse(cover.copy).tagline, "Carry the lantern");
  assert.equal(JSON.parse(cover.overrides).style, "minimal");
});

test("re-running the same game on the same shelf is free and reuses the cover", async () => {
  const before = (await getJson(url, "/api/me")).body.account.usage.used;
  const res = await post(url, "/api/games/42/covers", { platform: "PS5", style: "raw" });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.created, false);
  assert.equal(body.cover.id, coverId);
  assert.equal((await getJson(url, "/api/me")).body.account.usage.used, before);
  await server.app.worker.drain();
  const run = (await getJson(url, `/api/covers/${coverId}/run`)).body;
  assert.equal(run.cover.style, "raw");
  assert.match(run.run.steps[2].detail, /Keeping stored front art/, "a replay does not re-download art");
});

test("library cards learn the cover's status and the cached art summary", async () => {
  const { body } = await getJson(url, "/api/rawg/search?q=pill-check");
  const card = body.games.find((g) => g.id === 42);
  assert.equal(card.cover.id, coverId);
  assert.ok(card.art.rawg >= 3);
  assert.equal(typeof card.art.printReady, "boolean");
  assert.equal(body.games.find((g) => g.id === 7).art, null, "an unopened game has no summary and costs no call");
});

test("batch generation queues one cover per game and re-runs existing ones", async () => {
  const res = await post(url, "/api/covers/batch", {
    games: [
      { rawgId: 42, name: "Test Quest", platform: "PS5" },
      { rawgId: 7, name: "Other Game", platform: "PS4" },
      { rawgId: "nope", name: "" },
    ],
  });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.created.length, 1);
  assert.deepEqual(body.rerun, [coverId]);
  assert.match(body.message, /1 cover queued, 1 re-run/);

  const runs = (await getJson(url, "/api/runs")).body;
  assert.equal(runs.active, 2);
  assert.ok(runs.runs.some((r) => r.coverId === body.created[0] && r.title === "Other Game"));
});

test("a failed fetch leaves the cover failed with a message, and the failing step marked", async () => {
  await server.app.worker.drain();
  const other = (await getJson(url, "/api/covers")).body.covers.find((c) => c.title === "Other Game");
  const run = (await getJson(url, `/api/covers/${other.id}/run`)).body;
  assert.equal(run.cover.status, "failed");
  assert.ok(run.cover.error);
  assert.ok(run.run.steps.some((s) => s.state === "failed"));
});

test("RAWG requests are counted against the monthly free tier", async () => {
  const { body } = await getJson(url, "/api/me");
  assert.equal(body.account.usage.rawg.limit, 20000);
  assert.ok(body.account.usage.rawg.used >= 4, `counted ${body.account.usage.rawg.used}`);
});

test("covers list across shelves, and unknown ids are JSON 404s", async () => {
  const { body } = await getJson(url, "/api/covers");
  assert.ok(body.covers.length >= 2);
  assert.ok(body.covers.every((c) => c.projectName));
  assert.equal((await getJson(url, "/api/covers/not-a-cover/run")).res.status, 404);
  assert.equal((await getJson(url, "/api/games/abc")).res.status, 400);
});

test("the free plan's cover cap is a 402 on game covers", async () => {
  server.app.db.prepare("UPDATE accounts SET plan = 'free'").run();
  for (let i = 0; i < 10; i++) {
    server.app.db
      .prepare("INSERT INTO usage_events (id, account_id, kind, ref, created_at) VALUES (?, ?, 'cover.created', '', ?)")
      .run(`fill-${i}`, server.app.account.id, new Date().toISOString());
  }
  const projectId = (await (await post(url, "/api/projects", { name: "Second shelf" })).json()).project.id;
  const res = await post(url, "/api/games/42/covers", { projectId });
  assert.equal(res.status, 402);
  assert.match((await res.json()).error, /covers a month/);
  server.app.db.prepare("UPDATE accounts SET plan = 'studio'").run();
});
