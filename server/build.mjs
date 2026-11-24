/* The build worker: fetch (or reuse) metadata and art, compose, check, store.

   Mirrors pipeline.mjs's single-cover path, but tenant-aware and cache-free at
   the account level: art and metadata are rows, so a rebuild costs no API calls.
   Manual covers (uploaded art only) never touch the network, which is what makes
   the free plan usable and the test suite offline. */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { loadImage } from "@napi-rs/canvas";
import { composeCover } from "../lib/cover.mjs";
import { rawgLookup, llmCopy, fetchBuffer } from "../lib/sources.mjs";
import * as repo from "./repo.mjs";
import { providerKey } from "./auth.mjs";
import { llmConfig, llmAvailable, llmOpts } from "./llm.mjs";
import { safeJoin } from "./http.mjs";

const permanent = (message) => Object.assign(new Error(message), { permanent: true });

/** Persist an already-downloaded image and record it as a fetched art row.
   Paths are stored relative to the data directory so every read can go through
   safeJoin — a database row can never point outside the deployment's storage. */
async function saveFetched(db, dataDir, coverId, slot, fileName, url, accountId) {
  const rel = `art/${accountId}/${coverId}/${fileName}`;
  const dest = safeJoin(dataDir, rel);
  if (!dest) throw permanent("Refusing to write outside the data directory.");
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const buf = await fetchBuffer(url);
  await fs.writeFile(dest, buf);
  let width = 0;
  let height = 0;
  try {
    const img = await loadImage(buf);
    width = img.width;
    height = img.height;
  } catch {
    /* dimensions are only used for reports */
  }
  repo.setArt(db, coverId, slot, rel, { width, height, bytes: buf.length, kind: "fetched" });
}

async function fetchRemoteArt({ db, cover, meta, dataDir, secret, accountId }) {
  // Any front art row — uploaded or fetched on an earlier attempt — wins over
  // the network. This is what makes a rebuild free and stops a background
  // build from overwriting artwork the user uploaded.
  if (repo.artFor(db, cover.id, "front")) return;

  const uploaded = new Set(repo.listArt(db, cover.id).map((r) => r.slot));

  // Portrait front art is normally the customer's: SteamGridDB's terms limit access
  // to personal, non-commercial use (the CLI still uses it, this service does not),
  // and RAWG's hero image is 16:9 so a 0.87:1 panel crop destroys it.
  // In fully-automatic import we fall back to RAWG's hero image as front art so the
  // pipeline never stalls on a missing upload; review then flags the heavy crop.
  if (!uploaded.has("front")) {
    if (meta.heroUrl) {
      await saveFetched(db, dataDir, cover.id, "front", "front-fetched.jpg", meta.heroUrl, accountId).catch(
        () => {}
      );
    }
    if (!repo.artFor(db, cover.id, "front")) {
      throw permanent(
        "No front art could be fetched. Upload a 3:4 portrait image (at least 1512 × 1748 px), or check your RAWG key."
      );
    }
  }

  if (!uploaded.has("back") && meta.heroUrl) {
    await saveFetched(db, dataDir, cover.id, "back", "back-fetched.jpg", meta.heroUrl, accountId).catch(() => {});
  }

  for (let i = 0; i < Math.min(3, (meta.shotUrls || []).length); i++) {
    if (uploaded.has(`shot${i}`)) continue;
    await saveFetched(db, dataDir, cover.id, `shot${i}`, `shot${i}.jpg`, meta.shotUrls[i], accountId).catch(() => {});
  }
}

/**
 * Build one cover. Throws a `permanent` error for things the user must fix
 * (missing key, missing art, RAWG miss) so the queue does not burn retries.
 */
export async function buildCover({ db, dataDir, secret, accountId, coverId, logger = console, bleed = 3 }) {
  const cover = repo.getCover(db, accountId, coverId);
  if (!cover) throw permanent("That cover no longer exists.");

  repo.setCoverStatus(db, coverId, "processing");
  try {
    return await buildOnce({ db, dataDir, secret, accountId, coverId, cover, logger, bleed });
  } catch (error) {
    // Whatever went wrong, the cover must not stay stuck on "Building".
    // A retryable failure is moved back to queued by the worker.
    repo.setCoverStatus(db, coverId, "failed", { error: error.message });
    throw error;
  }
}

async function buildOnce({ db, dataDir, secret, accountId, coverId, cover, logger = console, bleed = 3 }) {
  let meta = repo.coverMeta(cover);
  let copy = repo.coverCopy(cover);

  if (cover.mode === "auto") {
    const rawgKey = providerKey(db, accountId, "rawg", secret);
    if (!rawgKey) {
      throw permanent("Add a RAWG API key in Settings to fetch metadata, or upload art and use manual mode.");
    }
    if (!meta) {
      meta = await rawgLookup(cover.query, cover.platform, rawgKey);
      if (!meta) throw permanent(`RAWG found nothing for "${cover.query}" on ${cover.platform}.`);
      meta.query = cover.query;
      repo.setCoverMeta(db, coverId, { meta });
    }
    await fetchRemoteArt({ db, cover, meta, dataDir, secret, accountId });

    if (!copy) {
      // Ollama is local and needs no key, so "configured" means "selected".
      // A dead local server is not fatal: deterministic fallbacks fill the slots.
      const llm = llmConfig(db, accountId, secret);
      if (llmAvailable(llm)) {
        copy = await llmCopy(meta, llmOpts(llm, "text")).catch(() => null);
        if (copy) repo.setCoverMeta(db, coverId, { copy });
      }
    }
  }

  const stored = repo.artPaths(db, coverId);
  const resolve = (rel) => (rel ? safeJoin(dataDir, rel) : null);
  const paths = {
    front: resolve(stored.front),
    back: resolve(stored.back),
    shots: stored.shots.map(resolve).filter(Boolean),
  };
  if (!paths.front) {
    throw permanent(
      cover.mode === "auto"
        ? "No front art could be fetched. Upload front art, or check your SteamGridDB key."
        : "Upload front art for this cover before building."
    );
  }

  const theme = {
    layout: cover.layout,
    accent: cover.accent,
    mark: cover.mark,
    address: cover.address,
    edition: cover.edition,
  };

  const out = await composeCover({
    meta,
    copy,
    platform: cover.platform,
    title: cover.title,
    theme,
    overrides: repo.coverOverrides(cover),
    artPaths: paths,
    bleed,
  });

  const renderId = crypto.randomUUID();
  const dir = path.join(dataDir, "renders", renderId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "wrap.png"), out.wrapPng);
  await fs.writeFile(path.join(dir, "front.png"), out.frontPng);

  repo.addRender(db, coverId, {
    id: renderId,
    wrapPath: `renders/${renderId}/wrap.png`,
    frontPath: `renders/${renderId}/front.png`,
    qc: out.qc,
    cfg: out.cfg,
  });

  repo.setCoverStatus(db, coverId, out.qc.status, { qc: out.qc });

  // A cover already signed off by hand keeps that decision through a rebuild —
  // the project's stated convention. QC still runs and is stored, so the review
  // page shows what changed; the reviewer can reject it explicitly.
  if (cover.status === "approved") {
    repo.setCoverStatus(db, coverId, "approved", { qc: out.qc });
  }

  // Drop old versions from disk as well as the table, newest 5 kept.
  for (const [wrap, front] of repo.pruneRenders(db, coverId, 5)) {
    for (const rel of [wrap, front]) {
      if (!rel) continue;
      await fs.unlink(path.join(dataDir, rel)).catch(() => {});
    }
  }

  logger.log?.(`built ${cover.title} (${cover.platform}) → ${out.qc.status}`);
  return { renderId, qc: out.qc };
}
