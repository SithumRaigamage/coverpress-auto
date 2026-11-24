import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  boot,
  createProject,
  importTitles,
  coverIdOf,
  upload,
  png,
  get,
  post,
  patch,
  put,
  del,
  getJson,
} from "./helpers.mjs";

const server = await boot();
after(() => server.stop());

const db = () => server.app.db;

test("the root describes a JSON API and no page is served", async () => {
  const root = await getJson(server.url, "/");
  assert.equal(root.res.status, 200);
  assert.match(root.res.headers.get("content-type"), /application\/json/);
  assert.equal(root.body.mode, "local");
  assert.ok(root.body.endpoints.includes("GET /api/projects"));

  for (const path of ["/login", "/signup", "/app", "/legal", "/static/app.css", "/projects/x"]) {
    const res = await get(server.url, path);
    assert.equal(res.status, 404, `${path} should not exist`);
    assert.match(res.headers.get("content-type"), /application\/json/);
    assert.equal((await res.json()).error.startsWith("No route for"), true);
  }
});

test("local mode answers as one account, without a session", async () => {
  const { res, body } = await getJson(server.url, "/api/me");
  assert.equal(res.status, 200);
  assert.equal(body.account.email, "local@coverpress.local");
  assert.equal(body.account.local, true);
  assert.equal(body.account.plan.name, "free");
  assert.deepEqual(body.account.usage, { used: 0, limit: 10, projects: 0, projectLimit: 2, rawg: { used: 0, limit: 20000 } });
  assert.equal(res.headers.get("set-cookie"), null);
});

test("projects are created and listed as JSON", async () => {
  // This file exercises many projects; lift the free plan's project cap.
  db().prepare("UPDATE accounts SET plan = 'studio'").run();
  const id = await createProject(server.url, "Shelf 2026", "PS4");
  const one = await getJson(server.url, `/api/projects/${id}`);
  assert.equal(one.res.status, 200);
  assert.equal(one.body.project.name, "Shelf 2026");
  assert.equal(one.body.project.platform, "PS4");
  assert.deepEqual(one.body.covers, []);
  assert.equal(one.body.stats.total, 0);

  const list = await getJson(server.url, "/api/projects");
  assert.equal(list.body.projects.length, 1);
  assert.equal(list.body.projects[0].coverCount, 0);
  assert.equal(list.body.usage.projects, 1);
});

test("a project needs a name", async () => {
  const res = await post(server.url, "/api/projects", { name: "  " });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /needs a name/);
});

let projectId;
let coverId;

test("importing titles returns what it created", async () => {
  projectId = await createProject(server.url, "Import shelf");
  coverId = null;
  const res = await importTitles(server.url, projectId, "Test Game|PS5|manual\nSecond Game");
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.created.length, 2);
  assert.equal(body.created[0].title, "Test Game");
  assert.equal(body.skipped, 0);
  assert.match(body.message, /2 covers added/);
  coverId = coverIdOf(server.app, projectId, "Test Game");
  assert.ok(coverId);
});

test("titles that are only comments are ignored", async () => {
  const res = await importTitles(server.url, projectId, "# note only\n\n");
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.created.length, 0);
  assert.match(body.message, /No titles/);
});

test("unknown art slots are rejected", async () => {
  const res = await upload(server.url, coverId, png(), "poster");
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Unknown art slot/);
});

test("non-image uploads are rejected by magic bytes, not by extension", async () => {
  const res = await upload(server.url, coverId, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "front");
  assert.equal(res.status, 415);
  assert.match((await res.json()).error, /PNG, JPEG or WebP/);
});

test("tiny images are rejected before they reach the renderer", async () => {
  const res = await upload(server.url, coverId, png(64, 64));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /at least 400×400/);
});

test("uploading front art queues a build and reports the job", async () => {
  const res = await upload(server.url, coverId, png());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.width, 1512);
  assert.equal(body.height, 1748);
  assert.match(body.artUrl, /\/api\/covers\/.+\/art\/front/);
  assert.ok(body.jobId);
  assert.equal(db().prepare("SELECT status FROM covers WHERE id = ?").get(coverId).status, "queued");
});

test("the queue renders a 300 DPI wrap, and status polling reports it", async () => {
  await server.app.worker.drain();

  const { body } = await getJson(server.url, `/api/projects/${projectId}/status`);
  const row = body.covers.find((c) => c.id === coverId);
  assert.ok(["needs_review", "auto_approved"].includes(row.status), `unexpected ${row.status}`);
  assert.equal(typeof row.score, "number");
  assert.ok(row.renderId);
  assert.equal(body.pending, 0);
});

test("the wrap and the uploaded art are served as images", async () => {
  const { body } = await getJson(server.url, `/api/covers/${coverId}`);
  assert.ok(body.cover.wrapUrl);

  const wrap = await get(server.url, body.cover.wrapUrl);
  assert.equal(wrap.status, 200);
  assert.equal(wrap.headers.get("content-type"), "image/png");
  assert.equal(wrap.headers.get("cache-control"), "private, max-age=60");

  const art = await get(server.url, `/api/covers/${coverId}/art/front`);
  assert.equal(art.status, 200);
  assert.equal(art.headers.get("content-type"), "image/png");
});

test("a rendered image cannot be fetched through a path that escapes storage", async () => {
  for (const attempt of [
    "/api/renders/..%2F..%2Fsecret/wrap.png",
    "/api/renders/x/../../secret.key",
    "/api/renders/x/wrap.png%00.png",
    "/api/covers/x/art/../../secret.key",
  ]) {
    const res = await get(server.url, attempt);
    assert.ok(res.status === 404 || res.status === 400, `${attempt} returned ${res.status}`);
  }
});

test("project theme is patched, and geometry is not a client concern", async () => {
  const res = await patch(server.url, `/api/projects/${projectId}`, {
    accent: "#8C2B14",
    mark: "SR",
    edition: "Deluxe Edition",
    layout: "ps4",
    platform: "PS4",
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.project.accent, "#8C2B14");
  assert.equal(body.project.mark, "SR");
  assert.equal(body.project.layout, "ps4");
  assert.equal(body.project.platform, "PS4");
});

test("re-rendering stores only whitelisted overrides and bumps the version", async () => {
  const before = await getJson(server.url, `/api/covers/${coverId}`);
  const res = await post(server.url, `/api/covers/${coverId}/render`, {
    overrides: { titleSize: 18, zoom: 1.4, panelW: 999, spine: 0, colour: "red" },
  });
  assert.equal(res.status, 202);
  await server.app.worker.drain();

  const after = await getJson(server.url, `/api/covers/${coverId}`);
  assert.notEqual(after.body.cover.renderId, before.body.cover.renderId);
  assert.equal(after.body.cover.renderVersion, 2);
  assert.equal(after.body.cfg.titleSize, 18);
  assert.equal(after.body.cfg.zoom, 1.4);
  assert.equal(after.body.cfg.panelW, 128, "panel width is geometry, not a preference");
  assert.equal(after.body.cfg.spine, 14, "a request must not produce a 0 mm spine");
  assert.equal(after.body.cfg.colour, undefined);
});

test("a decision is validated", async () => {
  const bad = await post(server.url, `/api/covers/${coverId}/decision`, { decision: "maybe" });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /approved or rejected/);

  const good = await post(server.url, `/api/covers/${coverId}/decision`, { decision: "approved" });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).status, "approved");
});

test("the print plan is JSON in millimetres, not an HTML sheet", async () => {
  const { res, body } = await getJson(server.url, `/api/projects/${projectId}/print`);
  assert.equal(res.status, 200);
  assert.equal(body.pageWidthMm, 276);
  assert.equal(body.pageHeightMm, 154);
  assert.equal(body.trimMm.width, 270);
  assert.equal(body.trimMm.height, 148);
  assert.deepEqual(body.panelsMm, { back: 128, spine: 14, front: 128 }, "the Blu-ray keepcase, PS4 and PS5 alike");
  assert.equal(body.bleedMm, 3);
  assert.equal(body.paper.orientation, "landscape");
  assert.equal(body.paper.scale, 100);
  assert.equal(body.pages.length, 1);
  assert.equal(body.pages[0].title, "Test Game");
  assert.equal(body.pages[0].widthMm, 276);
  assert.match(body.pages[0].wrapUrl, /^\/api\/renders\/.+\/wrap\.png$/);
  assert.match(body.instructions, /100%/);
  assert.match(body.instructions, /do not fit to page/);
});

test("an approved cover survives a rebuild", async () => {
  const res = await post(server.url, `/api/covers/${coverId}/build`, {});
  assert.equal(res.status, 202);
  await server.app.worker.drain();
  assert.equal(db().prepare("SELECT status FROM covers WHERE id = ?").get(coverId).status, "approved");
});

test("a cover without art fails with an actionable message", async () => {
  const id = coverIdOf(server.app, projectId, "Second Game");
  const res = await post(server.url, `/api/covers/${id}/build`, {});
  assert.equal(res.status, 202);
  await server.app.worker.drain();

  const { body } = await getJson(server.url, `/api/projects/${projectId}/status`);
  const row = body.covers.find((c) => c.id === id);
  assert.equal(row.status, "failed");
  assert.match(row.error, /Upload front art/i);
});

test("deleting a cover removes its files and its URLs", async () => {
  const { body } = await getJson(server.url, `/api/covers/${coverId}`);
  const wrapUrl = body.cover.wrapUrl;

  const res = await del(server.url, `/api/covers/${coverId}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).deleted, coverId);
  assert.equal(db().prepare("SELECT id FROM covers WHERE id = ?").get(coverId), undefined);
  assert.equal((await get(server.url, wrapUrl)).status, 404);
});

test("provider keys come from .env only and are never returned", async () => {
  // The browser has no way to write a key: the old key-entry route is gone.
  const set = await put(server.url, "/api/settings/keys", { name: "rawg", value: "rawg-key-123456" });
  assert.equal(set.status, 404);

  const saved = process.env.RAWG_KEY;
  process.env.RAWG_KEY = "rawg-key-123456";
  try {
    const settings = await getJson(server.url, "/api/settings");
    assert.equal(settings.body.keys.rawg, true);
    assert.equal(JSON.stringify(settings.body).includes("rawg-key-123456"), false);
  } finally {
    if (saved === undefined) delete process.env.RAWG_KEY;
    else process.env.RAWG_KEY = saved;
  }
  assert.equal((await getJson(server.url, "/api/settings")).body.keys.rawg, false);
});

test("SteamGridDB is off unless SGDB_KEY is set, and its restriction is stated", async () => {
  const { body } = await getJson(server.url, "/api/settings");
  assert.equal(body.keys.sgdb, false);
  const rule = body.restrictions.find((r) => r.name === "sgdb");
  assert.match(rule.reason, /personal, non-commercial/);
});

test("acceptable use is structured data the frontend can render", async () => {
  const { body } = await getJson(server.url, "/api/legal");
  assert.match(body.title, /Acceptable use/);
  assert.ok(body.sections.length >= 4);
  assert.ok(body.sections.some((s) => s.bullets?.some((b) => /personal-use/i.test(b) || /Sell/i.test(b))));
  assert.doesNotMatch(JSON.stringify(body), /<[a-z][\s\S]*>/i);
});

test("cross-origin mutations are refused", async () => {
  const res = await post(server.url, "/api/projects", { name: "Hijack" }, { origin: "https://evil.example" });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /Cross-origin/);

  const sameOrigin = await post(server.url, "/api/projects", { name: "Same origin" }, { origin: server.url });
  assert.equal(sameOrigin.status, 201);
});

test("malformed JSON is a 400, not a crash", async () => {
  const res = await fetch(`${server.url}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Malformed JSON/);

  const notObject = await post(server.url, "/api/projects", [1, 2, 3]);
  assert.equal(notObject.status, 400);
});

test("an unknown project id is a JSON 404", async () => {
  const res = await get(server.url, "/api/projects/does-not-exist");
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "Project not found.");
});
