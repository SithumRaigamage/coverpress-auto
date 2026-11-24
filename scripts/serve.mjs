#!/usr/bin/env node
/* Production static host for the built frontend.

   The API stays JSON-only (see AGENTS.md). This process serves frontend/dist
   and forwards /api to the API process, so the browser has a single origin:

     APP_ORIGIN=http://127.0.0.1:8080 node server/index.mjs   # :3000
     npm run serve                                            # :8080

   Start the API with APP_ORIGIN pointing at this host, or cross-origin mutations
   will be refused. */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "frontend", "dist");
const PORT = Number(process.env.PORT || 8080);
const API = String(process.env.API_ORIGIN || "http://127.0.0.1:3000").replace(/\/+$/, "");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const send = (res, status, body, type) =>
  res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff" }).end(body);

async function proxy(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (["host", "content-length", "connection"].includes(key)) continue;
    headers[key] = value;
  }
  try {
    const upstream = await fetch(`${API}${req.url}`, {
      method: req.method,
      headers,
      body: chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined,
      redirect: "manual",
    });
    const outHeaders = {};
    for (const [key, value] of upstream.headers) {
      if (["content-encoding", "transfer-encoding", "connection"].includes(key)) continue;
      outHeaders[key] = value;
    }
    res.writeHead(upstream.status, outHeaders);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    send(res, 502, JSON.stringify({ error: `API unavailable: ${err.message}` }), "application/json");
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith("/api")) return proxy(req, res);

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) return send(res, 403, "Forbidden", "text/plain");
  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) file = path.join(file, "index.html");
    const body = await fs.readFile(file);
    return send(res, 200, body, MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  } catch {
    // SPA fallback: client-side routes such as /shelves/:id have no file.
    try {
      const body = await fs.readFile(path.join(DIST, "index.html"));
      return send(res, 200, body, MIME[".html"]);
    } catch {
      return send(res, 404, "Build the frontend first: npm --prefix frontend run build", "text/plain");
    }
  }
});

server.listen(PORT, process.env.HOST || "127.0.0.1", () => {
  console.log(`Coverpress web on http://127.0.0.1:${PORT} (API ${API})`);
});
