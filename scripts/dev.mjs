#!/usr/bin/env node
/* One command, no terminal juggling.
   Starts the JSON API on :3000, waits for /api/health, starts Vite on :5173
   with a proxy to the API, then opens the browser. Ctrl-C stops both. */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = path.join(ROOT, "frontend");
const API_PORT = Number(process.env.PORT || 3000);
const UI_PORT = Number(process.env.UI_PORT || 5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const UI_URL = `http://127.0.0.1:${UI_PORT}`;

try {
  process.loadEnvFile?.(path.join(ROOT, ".env"));
} catch {
  /* .env is optional in local mode */
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await pause(250);
  }
  throw new Error(`${label} did not start at ${url}`);
}

if (!fs.existsSync(path.join(FRONTEND, "node_modules", "vite", "bin", "vite.js"))) {
  console.log("Installing frontend dependencies (first run only)…\n");
  const install = spawnSync("npm", ["install"], { cwd: FRONTEND, stdio: "inherit", shell: process.platform === "win32" });
  if (install.status !== 0) process.exit(install.status || 1);
}

const children = [];
const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });

const api = spawn(process.execPath, ["server/index.mjs"], {
  cwd: ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(API_PORT),
    HOST: "127.0.0.1",
    // The browser comes from Vite, so mutations must be allowed from that origin.
    APP_ORIGIN: process.env.APP_ORIGIN || UI_URL,
  },
});
children.push(api);
api.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`\nAPI stopped with code ${code}.`);
    stop();
  }
});

try {
  await waitFor(`${API_URL}/api/health`, "API");
  console.log(`API ready at ${API_URL}`);
} catch (err) {
  console.error(err.message);
  stop();
  process.exit(1);
}

const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(UI_PORT), "--strictPort"], {
  cwd: FRONTEND,
  stdio: "inherit",
  env: { ...process.env, API_PORT: String(API_PORT) },
});
children.push(vite);
vite.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`\nVite stopped with code ${code}.`);
    stop();
  }
});

try {
  await waitFor(UI_URL, "Frontend");
} catch (err) {
  console.error(err.message);
  stop();
  process.exit(1);
}

console.log(`\nCoverpress is ready → ${UI_URL}\n`);
if (process.env.NO_OPEN !== "1") {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", UI_URL] : [UI_URL];
  spawn(opener, args, { stdio: "ignore", detached: true }).on("error", () => {});
}
