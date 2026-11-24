/* Deleting: covers (one and many), single versions, runs, shelves, AI drafts and
   everything at once. No renders are made here: render rows and their files are
   written directly, so these tests need no network, no model and no canvas work. */

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { boot, createProject, importTitles, coverIdOf, del, post, getJson } from "./helpers.mjs";

let server;
const db = () => server.app.db;
const now = () => new Date().toISOString();
const exists = (rel) => fs.access(path.join(server.dataDir, rel)).then(() => true, () => false);

before(async () => {
  // Many shelves and covers below; plan limits have their own tests.
  process.env.DEV_MODE = "true";
  server = await boot();
});
after(async () => {
  delete process.env.DEV_MODE;
  await server.stop();
});

async function makeCover(projectId, title, { status = "needs_review", versions = 0 } = {}) {
  await importTitles(server.url, projectId, `${title} | PS5 | manual`);
  const id = coverIdOf(server.app, projectId, title);
  db().prepare("UPDATE covers SET status = ? WHERE id = ?").run(status, id);
  const renders = [];
  for (let v = 1; v <= versions; v++) renders.push(await addRender(id, v, status === "auto_approved" ? "auto_approved" : "needs_review"));
  // One art file, the way a build stores it.
  const rel = `art/${server.app.account.id}/${id}/front.png`;
  await fs.mkdir(path.dirname(path.join(server.dataDir, rel)), { recursive: true });
  await fs.writeFile(path.join(server.dataDir, rel), "x");
  db().prepare("INSERT INTO art (cover_id, slot, path, kind, created_at) VALUES (?, 'front', ?, 'fetched', ?)").run(id, rel, now());
  return { id, renders };
}

async function addRender(coverId, version, qcStatus = "needs_review") {
  const id = crypto.randomUUID();
  const dir = path.join(server.dataDir, "renders", id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "wrap.png"), "w");
  await fs.writeFile(path.join(dir, "front.png"), "f");
  db()
    .prepare("INSERT INTO renders (id, cover_id, version, wrap_path, front_path, qc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, coverId, version, `renders/${id}/wrap.png`, `renders/${id}/front.png`, JSON.stringify({ status: qcStatus, score: 80 + version }), now());
  return id;
}

function addJob(coverId, state) {
  const id = crypto.randomUUID();
  db()
    .prepare(
      `INSERT INTO jobs (id, account_id, kind, cover_id, state, attempts, max_attempts, run_after, created_at, updated_at)
       VALUES (?, ?, 'build', ?, ?, 0, 3, ?, ?, ?)`
    )
    .run(id, server.app.account.id, coverId, state, now(), now(), now());
  return id;
}

const coverRow = (id) => db().prepare("SELECT * FROM covers WHERE id = ?").get(id);

test("deleting a cover removes every version folder and its art folder", async () => {
  const shelf = await createProject(server.url, "Delete one");
  const { id, renders } = await makeCover(shelf, "One Cover", { versions: 2 });
  const res = await del(server.url, `/api/covers/${id}`);
  assert.equal(res.status, 200);
  assert.equal(coverRow(id), undefined);
  for (const r of renders) assert.equal(await exists(`renders/${r}`), false);
  assert.equal(await exists(`art/${server.app.account.id}/${id}`), false);
  assert.equal((await del(server.url, `/api/covers/${id}`)).status, 404);
});

test("a cover that is building can't be deleted; a bulk delete skips it", async () => {
  const shelf = await createProject(server.url, "Delete many");
  const busy = await makeCover(shelf, "Busy Cover", { status: "processing", versions: 1 });
  addJob(busy.id, "running");
  const a = await makeCover(shelf, "Column A", { status: "failed" });
  const b = await makeCover(shelf, "Column B", { status: "failed", versions: 1 });

  assert.equal((await del(server.url, `/api/covers/${busy.id}`)).status, 409);

  // A running build also blocks "delete everything".
  assert.equal((await post(server.url, "/api/reset", { confirm: "DELETE" })).status, 409);

  const res = await post(server.url, "/api/covers/delete", { ids: [busy.id, a.id, b.id, "nope"] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.deleted.sort(), [a.id, b.id].sort());
  assert.deepEqual(
    body.skipped.map((s) => s.reason).sort(),
    ["building", "not_found"]
  );
  assert.ok(coverRow(busy.id));
  assert.equal(await exists(`renders/${b.renders[0]}`), false);

  assert.equal((await post(server.url, "/api/covers/delete", { ids: [] })).status, 400);

  // Once the build is no longer running, the cover can go.
  db().prepare("UPDATE jobs SET state = 'done' WHERE cover_id = ?").run(busy.id);
  assert.equal((await del(server.url, `/api/covers/${busy.id}`)).status, 200);
});

test("deleting a version keeps the others; deleting the approved one sends the cover back to review", async () => {
  const shelf = await createProject(server.url, "Versions");
  const { id, renders } = await makeCover(shelf, "Versioned", { versions: 3 });
  const [v1, v2, v3] = renders;
  db().prepare("UPDATE covers SET status = 'approved', approved_render_id = ?, decided_at = ? WHERE id = ?").run(v2, now(), id);

  let res = await del(server.url, `/api/covers/${id}/versions/${v1}`);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.approvalCleared, false);
  assert.equal(coverRow(id).status, "approved");
  assert.equal(await exists(`renders/${v1}`), false);
  assert.equal(await exists(`renders/${v3}`), true);

  res = await del(server.url, `/api/covers/${id}/versions/${v2}`);
  body = await res.json();
  assert.equal(body.approvalCleared, true);
  assert.equal(coverRow(id).status, "needs_review");
  assert.equal(coverRow(id).approved_render_id, "");

  // The last version can't go; the cover has to be deleted instead.
  assert.equal((await del(server.url, `/api/covers/${id}/versions/${v3}`)).status, 409);
  assert.equal((await del(server.url, `/api/covers/${id}/versions/not-a-render`)).status, 404);

  const { body: versions } = await getJson(server.url, `/api/covers/${id}/versions`);
  assert.deepEqual(versions.versions.map((v) => v.id), [v3]);
});

test("approving the latest implicitly, then deleting it, clears the approval too", async () => {
  const shelf = await createProject(server.url, "Implicit");
  const { id, renders } = await makeCover(shelf, "Implicit Approval", { versions: 2 });
  db().prepare("UPDATE covers SET status = 'approved', approved_render_id = '' WHERE id = ?").run(id);
  const body = await (await del(server.url, `/api/covers/${id}/versions/${renders[1]}`)).json();
  assert.equal(body.approvalCleared, true);
  assert.equal(coverRow(id).status, "needs_review");
});

test("runs: a queued run is cancelled, a running one is refused, finished ones can be cleared", async () => {
  const shelf = await createProject(server.url, "Runs");
  const fresh = await makeCover(shelf, "Never Rendered", { status: "queued" });
  const queued = addJob(fresh.id, "queued");
  let res = await del(server.url, `/api/runs/${queued}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).cancelled, true);
  assert.equal(coverRow(fresh.id).status, "failed");
  assert.match(coverRow(fresh.id).error, /cancelled/i);

  const rendered = await makeCover(shelf, "Has Versions", { status: "queued", versions: 1 });
  await del(server.url, `/api/runs/${addJob(rendered.id, "queued")}`);
  assert.equal(coverRow(rendered.id).status, "needs_review");

  const running = addJob(rendered.id, "running");
  assert.equal((await del(server.url, `/api/runs/${running}`)).status, 409);

  const done = addJob(rendered.id, "done");
  const failed = addJob(fresh.id, "failed");
  res = await del(server.url, "/api/runs");
  assert.equal(res.status, 200);
  assert.ok((await res.json()).deleted >= 2);
  const left = db().prepare("SELECT id FROM jobs WHERE id IN (?, ?, ?)").all(done, failed, running).map((r) => r.id);
  assert.deepEqual(left, [running]);
  db().prepare("DELETE FROM jobs WHERE id = ?").run(running);
  assert.equal((await del(server.url, "/api/runs/unknown")).status, 404);
});

test("deleting a shelf deletes its covers and their files", async () => {
  const shelf = await createProject(server.url, "Whole Shelf");
  const { id, renders } = await makeCover(shelf, "On The Shelf", { versions: 1 });
  const res = await del(server.url, `/api/projects/${shelf}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).covers, 1);
  assert.equal(coverRow(id), undefined);
  assert.equal(await exists(`renders/${renders[0]}`), false);
  assert.equal((await del(server.url, `/api/projects/${shelf}`)).status, 404);
});

async function writeAiImages(rawgId, n) {
  const dir = path.join(server.dataDir, "art/generated", String(rawgId));
  await fs.mkdir(dir, { recursive: true });
  const items = [];
  for (let i = 0; i < n; i++) {
    const uid = crypto.randomUUID();
    await fs.writeFile(path.join(dir, `${uid}.png`), "png");
    items.push({ id: uid, file: `${uid}.png`, width: 1512, height: 1748, createdAt: now() });
  }
  await fs.writeFile(path.join(dir, "index.json"), JSON.stringify({ items }));
  await fs.writeFile(path.join(dir, "prompt.json"), JSON.stringify({ prompt: "keep me", source: "user" }));
  return items;
}

test("AI drafts: delete one image, then clear the rest; the prompt stays", async () => {
  const items = await writeAiImages(4242, 3);
  let res = await del(server.url, `/api/generated/4242/${items[0].file}`);
  assert.equal(res.status, 200);
  assert.equal(await exists(`art/generated/4242/${items[0].file}`), false);
  assert.equal((await del(server.url, `/api/generated/4242/${items[0].file}`)).status, 404);
  assert.equal((await del(server.url, "/api/generated/4242/..%2Findex.json")).status, 404);

  res = await del(server.url, "/api/games/4242/ai-art");
  assert.equal((await res.json()).deleted, 2);
  assert.equal(await exists(`art/generated/4242/${items[1].file}`), false);
  assert.equal(await exists("art/generated/4242/prompt.json"), true);
  assert.equal((await del(server.url, "/api/games/abc/ai-art")).status, 400);
});

test("delete everything needs DELETE typed, keeps AI art unless asked", async () => {
  const shelf = await createProject(server.url, "Reset");
  const { id } = await makeCover(shelf, "Reset Me", { versions: 1 });
  await writeAiImages(99, 1);

  assert.equal((await post(server.url, "/api/reset", { confirm: "yes" })).status, 400);

  let res = await post(server.url, "/api/reset", { confirm: "DELETE" });
  assert.equal(res.status, 200);
  assert.equal(coverRow(id), undefined);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM projects WHERE account_id = ?").get(server.app.account.id).n, 0);
  assert.equal(await exists("art/generated/99/index.json"), true);

  res = await post(server.url, "/api/reset", { confirm: "DELETE", aiArt: true });
  assert.equal((await res.json()).aiArt, true);
  assert.equal(await exists("art/generated"), false);
});
