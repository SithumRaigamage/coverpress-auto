/* HTTP helpers for a JSON API.

   No HTML, no cookies, no templating. Bodies are JSON (or a raw image on the
   upload route), responses are JSON (or an image on the asset routes). */

import fs from "node:fs/promises";
import path from "node:path";

export const MAX_JSON = 256 * 1024;
export const MAX_UPLOAD = 12 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function readBody(req, limit) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared && declared > limit) throw new HttpError(413, "That request is too large.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "That request is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** JSON body. An empty body is `{}`; malformed JSON is a 400, never a 500. */
export async function readJson(req, limit = MAX_JSON) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    const value = JSON.parse(buf.toString("utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new HttpError(400, "Send a JSON object.");
    }
    return value;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "Malformed JSON body.");
  }
}

export function send(res, status, headers, body) {
  res.writeHead(status, {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    ...headers,
  });
  res.end(body);
}

export const sendJson = (res, status, value) =>
  send(
    res,
    status,
    { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    JSON.stringify(value)
  );

export const sendText = (res, status, text) =>
  send(res, status, { "Content-Type": "text/plain; charset=utf-8" }, text);

export const sendError = (res, status, message) => sendJson(res, status, { error: message });

/** Mutations must come from our own origin. Local mode does not rely on this. */
export function sameOrigin(req, allowedOrigin = "") {
  const origin = req.headers.origin;
  const site = req.headers["sec-fetch-site"];
  if (site === "cross-site") return false;
  if (!origin) return true; // curl, server-to-server, or a proxied dev client
  try {
    const host = new URL(origin).host;
    if (allowedOrigin) {
      try {
        if (new URL(allowedOrigin).host === host) return true;
      } catch {
        /* fall through to Host comparison */
      }
    }
    return host === req.headers.host;
  } catch {
    return false;
  }
}

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export const mimeFor = (file) => MIME[path.extname(String(file)).toLowerCase()] || "application/octet-stream";

/** Resolve `rel` under `root`, refusing anything that escapes it. */
export function safeJoin(root, rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, String(rel));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

export async function serveFile(res, file, { cache = "private, max-age=60" } = {}) {
  try {
    const buf = await fs.readFile(file);
    send(res, 200, { "Content-Type": mimeFor(file), "Cache-Control": cache }, buf);
    return true;
  } catch {
    return false;
  }
}

/** Sniff magic bytes: only raster formats, never SVG or HTML in disguise. */
export function imageType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: "png", mime: "image/png" };
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}
