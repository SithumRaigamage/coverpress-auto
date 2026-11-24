/* Versions and variants: "Run again" makes a new cover, every version is kept,
   any version can be approved, and duplicate covers fold into one. RAWG and the
   image host are stubbed; Ollama is unreachable (see helpers). */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { boot, png, getJson, post } from "./helpers.mjs";
import { nextUnused, rotateShots } from "../server/build.mjs";
import { mergeDuplicateCovers } from "../server/dedupe.mjs";
import { openDb } from "../server/db.mjs";

const realFetch = globalThis.fetch;
const IMAGES = {
  "https://img.test/grid.png": png(1024, 1536),
  "https://img.test/bg.jpg": png(1920, 1080),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`https://img.test/s${i}.jpg`, png(1280, 720)])),
};
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = (input, init) => {
  const t = String(input);
  if (t.startsWith("https://api.rawg.io/")) {
    const p = new URL(t).pathname;
    if (p === "/api/games/77/screenshots") {
      return Promise.resolve(json({ results: [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, image: `https://img.test/s${i}.jpg`, width: 1280, height: 720 })) }));
    }
    if (p === "/api/games/77") {
      return Promise.resolve(
        json({
          id: 77, slug: "variant-game", name: "Variant Game", released: "2023-01-01",
          description_raw: "A long road. " + "Words to fill the back panel nicely. ".repeat(6),
          genres: [{ name: "Action" }], tags: [], publishers: [{ name: "P" }],
          background_image: "https://img.test/bg.jpg", platforms: [{ platform: { name: "PlayStation 5" } }],
        })
      );
    }
  }
  if (t.startsWith("https://img.test/")) return Promise.resolve(IMAGES[t] ? new Response(IMAGES[t]) : new Response("", { status: 404 }));
  return realFetch(input, init);
};
process.env.RAWG_KEY = "k";
process.env.VISION_REVIEW = "false";

const server = await boot();
after(async () => {
  globalThis.fetch = realFetch;
  delete process.env.RAWG_KEY;
  delete process.env.VISION_REVIEW;
  await server.stop();
});
const url = server.url;
const drain = () => server.app.worker.drain();
let coverId;

test("helpers: next unused art, then cycling; shots rotate by seed", () => {
  const c = [{ url: "a" }, { url: "b" }, { url: "c" }];
  assert.equal(nextUnused(c, []).pick.url, "a");
  assert.equal(nextUnused(c, ["a"]).pick.url, "b");
  const all = nextUnused(c, ["b", "a", "c"]);
  assert.equal(all.cycled, true);
  assert.equal(all.pick.url, "b", "least recently used first");
  assert.deepEqual(rotateShots(["1", "2", "3", "4", "5", "6"], 1), ["4", "5", "6"]);
  assert.deepEqual(rotateShots(["1", "2"], 4), ["1", "2"]);
});

test("Run again makes a new variant: different art, shots and layout, as a new version", async () => {
  const created = await (await post(url, "/api/games/77/covers", { platform: "PS5" })).json();
  coverId = created.cover.id;
  await drain();

  const v1 = (await getJson(url, `/api/covers/${coverId}/versions`)).body.versions[0];
  assert.equal(v1.version, 1);

  const res = await post(url, `/api/covers/${coverId}/retry`, {});
  assert.equal(res.status, 202);
  assert.equal((await res.json()).mode, "variant");
  await drain();

  const { versions } = (await getJson(url, `/api/covers/${coverId}/versions`)).body;
  assert.equal(versions.length, 2, "v1 is kept");
  const [v2, first] = versions;
  assert.equal(v2.version, 2);
  assert.equal(v2.mode, "variant");
  assert.notDeepEqual(v2.front, first.front, "the front art rotated to the next-best candidate");

  const rows = server.app.db.prepare("SELECT meta FROM renders WHERE cover_id = ? ORDER BY version").all(coverId).map((r) => JSON.parse(r.meta));
  assert.notDeepEqual(rows[1].shots, rows[0].shots, "different back-panel screenshots");
  assert.ok(rows[1].layout.titleAnchor, "a layout seed was applied");
  assert.match(rows[1].layout.accent, /^#[0-9A-F]{6}$/, "band colour sampled from the art");

  const cover = server.app.db.prepare("SELECT source, overrides FROM covers WHERE id = ?").get(coverId);
  assert.equal(JSON.parse(cover.source).usedFront.length, 2, "used art is tracked per cover");
  assert.equal(JSON.parse(cover.overrides).titleAnchor, "bottom");
});

test("Run again with same art re-renders the stored inputs", async () => {
  const res = await post(url, `/api/covers/${coverId}/build`, { mode: "same" });
  assert.equal((await res.json()).mode, "same");
  await drain();
  const { versions } = (await getJson(url, `/api/covers/${coverId}/versions`)).body;
  assert.equal(versions.length, 3);
  assert.deepEqual(versions[0].front, versions[1].front, "same art as the version before");
  assert.equal(versions[0].mode, "same");
});

test("any version can be approved, and that version is what prints", async () => {
  const { versions } = (await getJson(url, `/api/covers/${coverId}/versions`)).body;
  const v1 = versions.find((v) => v.version === 1);
  const res = await post(url, `/api/covers/${coverId}/decision`, { decision: "approved", renderId: v1.id });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).approvedRenderId, v1.id);

  const projectId = server.app.db.prepare("SELECT project_id FROM covers WHERE id = ?").get(coverId).project_id;
  const print = (await getJson(url, `/api/projects/${projectId}/print`)).body;
  assert.equal(print.pages[0].version, 1);
  assert.match(print.pages[0].wrapUrl, new RegExp(v1.id));

  const list = (await getJson(url, "/api/covers")).body.covers.find((c) => c.id === coverId);
  assert.equal(list.versions.length, 3);
  assert.equal(list.versions.find((v) => v.approved).version, 1);

  const bad = await post(url, `/api/covers/${coverId}/decision`, { decision: "approved", renderId: "not-mine" });
  assert.equal(bad.status, 400);
});

test("a same-art re-render keeps the approval; a variant goes back to review", async () => {
  await post(url, `/api/covers/${coverId}/build`, { mode: "same" });
  await drain();
  let row = server.app.db.prepare("SELECT status, approved_render_id FROM covers WHERE id = ?").get(coverId);
  assert.equal(row.status, "approved");
  assert.ok(row.approved_render_id);

  await post(url, `/api/covers/${coverId}/retry`, {});
  await drain();
  row = server.app.db.prepare("SELECT status, approved_render_id FROM covers WHERE id = ?").get(coverId);
  assert.notEqual(row.status, "approved");
  assert.equal(row.approved_render_id, "");
});

test("generating the same game + platform again never makes a second cover", async () => {
  const batch = await (await post(url, "/api/covers/batch", { games: [{ rawgId: 77, name: "Variant Game", platform: "PS5" }] })).json();
  assert.deepEqual(batch.created, []);
  assert.deepEqual(batch.rerun, [coverId]);
  const again = await post(url, "/api/games/77/covers", { platform: "PS5" });
  assert.equal(again.status, 200);
  const count = server.app.db.prepare("SELECT COUNT(*) AS n FROM covers").get().n;
  assert.equal(Number(count), 1);
  await drain();
});

test("the migration folds duplicate covers into one, keeping every render as a version", () => {
  const db = openDb(":memory:");
  const now = (n) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
  db.prepare("INSERT INTO accounts (id, email, password_hash, created_at) VALUES ('a', 'a@x', '-', ?)").run(now(0));
  db.prepare("INSERT INTO projects (id, account_id, name, created_at) VALUES ('p1', 'a', 'One', ?), ('p2', 'a', 'Two', ?)").run(now(0), now(0));
  const cover = (id, project, title, platform, status, source, minute) =>
    db
      .prepare("INSERT INTO covers (id, project_id, title, query, platform, mode, status, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'auto', ?, ?, ?, ?)")
      .run(id, project, title, title, platform, status, source, now(minute), now(minute));
  const render = (cover, version, minute) =>
    db
      .prepare("INSERT INTO renders (id, cover_id, version, wrap_path, front_path, created_at) VALUES (?, ?, ?, 'w', 'f', ?)")
      .run(crypto.randomUUID(), cover, version, now(minute));

  // GTA V five times on PS5 (rawg id and title spellings mixed), once on PS4, plus an unrelated game.
  cover("g1", "p1", "Grand Theft Auto V", "PS5", "needs_review", JSON.stringify({ rawgId: 3498 }), 1);
  cover("g2", "p1", "Grand Theft Auto V", "PS5", "approved", JSON.stringify({ rawgId: 3498 }), 2);
  cover("g3", "p2", "Grand Theft Auto V", "PS5", "failed", JSON.stringify({ rawgId: 3498 }), 3);
  cover("g4", "p1", "grand theft auto v", "PS5", "needs_review", "", 4);
  cover("g5", "p1", "Grand Theft Auto V (2013)", "PS5", "needs_review", "", 5);
  cover("g6", "p1", "Grand Theft Auto V", "PS4", "needs_review", JSON.stringify({ rawgId: 3498 }), 6);
  cover("x1", "p1", "Other", "PS5", "needs_review", "", 7);
  render("g1", 1, 10);
  render("g2", 1, 11);
  render("g2", 2, 12);
  render("g3", 1, 13);
  render("g4", 1, 14);

  const result = mergeDuplicateCovers(db, { log() {} });
  // rawg:3498 PS5 (g1,g2,g3) and title PS5 (g4,g5) are two groups: a title-only
  // cover has no RAWG id to prove it is the same game.
  assert.equal(result.removed, 3);
  const left = db.prepare("SELECT id, status, approved_render_id FROM covers ORDER BY id").all();
  // g4 has the newest render of the title-only pair, so it is kept over g5.
  assert.deepEqual(left.map((c) => c.id).sort(), ["g3", "g4", "g6", "x1"]);
  const canon = left.find((c) => c.id === "g3");
  assert.equal(canon.status, "approved", "an approval in the group survives");
  assert.ok(canon.approved_render_id);
  const versions = db.prepare("SELECT version FROM renders WHERE cover_id = 'g3' ORDER BY version").all().map((r) => r.version);
  assert.deepEqual(versions, [1, 2, 3, 4], "all four renders kept, renumbered by age");

  assert.deepEqual(mergeDuplicateCovers(db, { log() {} }), { groups: 0, removed: 0 }, "idempotent");
  db.close();
});
