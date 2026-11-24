/* Test harness: boots the real API on an ephemeral port with a temp data dir.
   No network, no cookies: local mode has exactly one account. */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { createApp } from "../server/index.mjs";

// No test may reach a real Ollama: a locally running one would make builds slow
// and copy nondeterministic. Port 9 refuses connections immediately.
process.env.OLLAMA_HOST = process.env.COVERPRESS_TEST_OLLAMA || "http://127.0.0.1:9";

// Plan limits are under test; developer mode must be switched on explicitly.
delete process.env.DEV_MODE;

export async function boot(options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "coverpress-test-"));
  const app = createApp({
    dataDir,
    secret: "test-secret-0123456789",
    logger: { log() {}, error() {} },
    workerIntervalMs: 60_000,
    ...options,
  });
  const { url } = await app.start(0, "127.0.0.1");
  return {
    app,
    url,
    dataDir,
    async stop() {
      await app.close();
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** A portrait image at the panel's native 300 DPI size. */
export function png(width = 1512, height = 1748) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, "#1B3A93");
  grad.addColorStop(0.65, "#101728");
  grad.addColorStop(1, "#0C1220");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  for (let i = 0; i < 8; i++) ctx.fillRect(60, 120 + i * 110, width - 120, 5);
  return canvas.toBuffer("image/png");
}

/* ------------------------------------------------------------- requests */

export async function api(url, method, p, body, headers = {}) {
  const init = { method, headers: { ...headers }, redirect: "manual" };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return fetch(url + p, init);
}

export const get = (url, p, headers) => api(url, "GET", p, undefined, headers);
export const post = (url, p, body = {}, headers) => api(url, "POST", p, body, headers);
export const patch = (url, p, body = {}, headers) => api(url, "PATCH", p, body, headers);
export const put = (url, p, body = {}, headers) => api(url, "PUT", p, body, headers);
export const del = (url, p) => api(url, "DELETE", p);

export const getJson = async (url, p) => {
  const res = await get(url, p);
  return { res, body: await res.json() };
};

export async function upload(url, coverId, buffer, slot = "front", type = "image/png") {
  return fetch(`${url}/api/covers/${coverId}/art/${slot}`, {
    method: "PUT",
    headers: { "content-type": type },
    body: buffer,
  });
}

export async function createProject(url, name = "Shelf", platform = "PS5") {
  const res = await post(url, "/api/projects", { name, platform });
  const body = await res.json();
  if (res.status !== 201) throw new Error(`project not created: ${res.status} ${JSON.stringify(body)}`);
  return body.project.id;
}

export function importTitles(url, projectId, titles) {
  return post(url, `/api/projects/${projectId}/import`, { titles });
}

export const coverIdOf = (app, projectId, title) => {
  const row = app.db.prepare("SELECT id FROM covers WHERE project_id = ? AND title = ?").get(projectId, title);
  return row && row.id;
};
