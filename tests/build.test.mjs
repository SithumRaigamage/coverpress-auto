/* Build path tests: upload → queue → render, overrides, decisions, failure text.
   Runs against the real API so the routes and the worker are exercised together. */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { boot, createProject, importTitles, coverIdOf, upload, png, get, post, getJson } from "./helpers.mjs";

const server = await boot();
after(() => server.stop());

const projectId = await createProject(server.url, "Build shelf");
await importTitles(server.url, projectId, "Test Game");
const coverId = coverIdOf(server.app, projectId, "Test Game");

const coverRow = (id = coverId) => server.app.db.prepare("SELECT * FROM covers WHERE id = ?").get(id);
const latestRender = (id = coverId) =>
  server.app.db.prepare("SELECT * FROM renders WHERE cover_id = ? ORDER BY version DESC LIMIT 1").get(id);

test("the wrap is millimetre-true at 300 DPI", async () => {
  await upload(server.url, coverId, png());
  await server.app.worker.drain();

  const render = latestRender();
  assert.ok(render, "a render row should exist");
  assert.equal(render.version, 1);

  const img = await loadImage(path.join(server.dataDir, render.wrap_path));
  assert.equal(img.width, 3260); // (270 + 3 + 3) mm
  assert.equal(img.height, 1819); // (148 + 3 + 3) mm

  const qc = JSON.parse(render.qc);
  assert.equal(qc.fails, 0, JSON.stringify(qc.issues));
  assert.equal(typeof qc.score, "number");

  const cfg = JSON.parse(render.cfg);
  assert.equal(cfg.panelW, 128);
  assert.equal(cfg.spine, 14);
  assert.equal(cfg.panelH, 148);
  assert.equal(cfg.title, "Test Game");
});

test("a build needs no network call once art and metadata exist", async () => {
  const before = server.app.db.prepare("SELECT COUNT(*) AS n FROM art WHERE cover_id = ?").get(coverId).n;
  await post(server.url, `/api/covers/${coverId}/build`, {});
  await server.app.worker.drain();
  const afterCount = server.app.db.prepare("SELECT COUNT(*) AS n FROM art WHERE cover_id = ?").get(coverId).n;
  assert.equal(afterCount, before);
  assert.equal(latestRender().version, 2);
});

test("a legacy render endpoint is not exposed", async () => {
  const render = latestRender();
  assert.equal((await get(server.url, `/renders/${render.id}/front.png`)).status, 404);
  const proper = await get(server.url, `/api/renders/${render.id}/front.png`);
  assert.equal(proper.status, 200);
  assert.equal(proper.headers.get("content-type"), "image/png");
});

test("cover detail exposes cfg, qc and overrides for an inspector UI", async () => {
  const { body } = await getJson(server.url, `/api/covers/${coverId}`);
  assert.equal(body.cover.title, "Test Game");
  assert.equal(body.cfg.panelW, 128);
  assert.equal(typeof body.qc.score, "number");
  assert.equal(typeof body.overrides, "object");
  assert.equal(body.cover.artUrl, `/api/covers/${coverId}/art/front`);
});

test("the project summary counts what the shelf screen needs", async () => {
  const { body } = await getJson(server.url, `/api/projects/${projectId}`);
  assert.equal(body.stats.total, 1);
  assert.ok(body.stats.counts.auto_approved !== undefined || body.stats.counts.needs_review !== undefined);
});

test("an auto cover without a RAWG key fails with guidance, not a ReferenceError", async () => {
  const autoProject = await createProject(server.url, "Auto shelf");
  await importTitles(server.url, autoProject, "Automatic Game | PS5 | auto");
  await server.app.worker.drain();
  const row = server.app.db
    .prepare("SELECT status, error FROM covers WHERE project_id = ?")
    .get(autoProject);
  assert.equal(row.status, "failed");
  assert.match(row.error, /RAWG API key/);
  assert.doesNotMatch(row.error, /not defined/);
});
