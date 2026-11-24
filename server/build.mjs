/* The build worker: fetch (or reuse) metadata and art, compose, check, store.

   Seven steps, each reported to the job row so the run screen can draw them
   (server/progress.mjs): fetch metadata, collect art, pick front art, write
   back-cover copy, render the wrap, quality checks, route the cover.

   Mirrors pipeline.mjs's single-cover path, but tenant-aware and cache-free at
   the account level: art and metadata are rows, so a rebuild costs no API calls.
   Manual covers (uploaded art only) never touch the network, which is what makes
   the test suite offline. */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { loadImage } from "@napi-rs/canvas";
import { composeCover } from "../lib/cover.mjs";
import { artFit } from "../lib/qc.mjs";
import { rawgLookup, llmCopy, fetchBuffer } from "../lib/sources.mjs";
import * as repo from "./repo.mjs";
import { providerKey } from "./auth.mjs";
import { llmConfig, llmAvailable, llmOpts } from "./llm.mjs";
import { safeJoin } from "./http.mjs";
import { nullReporter } from "./progress.mjs";

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
  return { width, height };
}

const extOf = (url) => (/\.png(\?|$)/i.test(url) ? "png" : /\.webp(\?|$)/i.test(url) ? "webp" : "jpg");

/**
 * Build one cover. Throws a `permanent` error for things the user must fix
 * (missing key, missing art, RAWG miss) so the queue does not burn retries.
 */
export async function buildCover({
  db,
  dataDir,
  secret,
  accountId,
  coverId,
  logger = console,
  bleed = 3,
  reporter = nullReporter,
  attempt = 1,
  catalog = null,
  onRawgCall,
}) {
  const cover = repo.getCover(db, accountId, coverId);
  if (!cover) throw permanent("That cover no longer exists.");

  repo.setCoverStatus(db, coverId, "processing");
  reporter.begin(attempt);
  try {
    return await buildOnce({ db, dataDir, secret, accountId, coverId, cover, logger, bleed, reporter, catalog, onRawgCall });
  } catch (error) {
    // Whatever went wrong, the cover must not stay stuck on "Building".
    // A retryable failure is moved back to queued by the worker.
    reporter.fail(error.message);
    repo.setCoverStatus(db, coverId, "failed", { error: error.message });
    throw error;
  }
}

async function buildOnce({ db, dataDir, secret, accountId, coverId, cover, logger, bleed, reporter, catalog, onRawgCall }) {
  let meta = repo.coverMeta(cover);
  let copy = repo.coverCopy(cover);
  const source = repo.coverSource(cover);
  const auto = cover.mode === "auto";
  // A pick made on the game screen that has not been downloaded yet. Once the
  // build stores it, `applied` flips and replays reuse the stored file.
  const repick = Boolean(source.front?.url && source.front.applied === false);

  /* 1 — metadata */
  reporter.step("metadata", auto ? "Looking up RAWG" : "Manual cover");
  if (!auto) {
    reporter.skip("metadata", "Manual cover — no lookup.");
  } else if (meta) {
    reporter.done("metadata", `Cached · ${meta.name}${meta.released ? ` (${String(meta.released).slice(0, 4)})` : ""}`);
  } else {
    const rawgKey = providerKey(db, accountId, "rawg", secret);
    if (!rawgKey) {
      throw permanent("Add a RAWG API key (RAWG_KEY in .env) to fetch metadata, then restart the server.");
    }
    if (source.rawgId && catalog) {
      meta = { ...(await catalog.game(source.rawgId)).meta };
    } else {
      meta = await rawgLookup(cover.query, cover.platform, rawgKey, { onCall: onRawgCall });
    }
    if (!meta) throw permanent(`RAWG found nothing for "${cover.query}" on ${cover.platform}.`);
    meta.query = source.rawgId ? meta.name : cover.query;
    repo.setCoverMeta(db, coverId, { meta });
    reporter.done("metadata", `RAWG #${meta.id} · ${meta.name} · ${meta.genres.slice(0, 2).join(", ") || "no genre"}`);
  }

  /* 2 — collect art candidates */
  reporter.step("collect");
  const existing = new Map(repo.listArt(db, coverId).map((r) => [r.slot, r]));
  let candidates = [];
  if (!auto) {
    reporter.skip("collect", existing.has("front") ? "Using uploaded art." : "No uploaded art.");
  } else if (existing.has("front") && !repick) {
    reporter.done("collect", `Front art already stored (${existing.get("front").kind}).`);
  } else {
    if (source.rawgId && catalog) {
      const art = await catalog.art(source.rawgId);
      candidates = art.items;
      reporter.done(
        "collect",
        `${art.counts.rawg} from RAWG · ${art.sgdb.enabled ? `${art.counts.sgdb} from SteamGridDB` : "SteamGridDB off"}`
      );
    } else {
      // Title-only covers (pasted lists, the CLI-style import) know RAWG's hero image only.
      if (meta?.heroUrl) {
        candidates.push({ id: "rawg:hero", source: "RAWG", kind: "background", url: meta.heroUrl, width: 0, height: 0, fit: 0 });
      }
      reporter.done("collect", candidates.length ? "RAWG hero image" : "No candidates");
    }
  }

  /* 3 — pick front art */
  reporter.step("pick");
  if (!auto) {
    reporter.skip("pick", existing.has("front") ? "Uploaded front art." : "Nothing to pick.");
  } else if (existing.has("front") && !repick) {
    const f = existing.get("front");
    reporter.done("pick", `Keeping stored front art · ${f.width}×${f.height}`);
  } else {
    const wanted = source.front?.url ? candidates.find((c) => c.url === source.front.url) || source.front : null;
    const ranked = wanted ? [wanted, ...candidates.filter((c) => c.url !== wanted.url)] : candidates;
    let picked = null;
    for (const c of ranked) {
      try {
        const size = await saveFetched(db, dataDir, coverId, "front", `front-fetched.${extOf(c.url)}`, c.url, accountId);
        picked = { ...c, ...size };
        break;
      } catch (err) {
        reporter.log(`Could not download ${c.source} ${c.kind}: ${err.message}`, "warn");
      }
    }
    if (!picked) {
      throw permanent("No front art could be fetched for this game. Check RAWG_KEY, or set SGDB_KEY for portrait art.");
    }
    const fit = artFit(picked.width, picked.height);
    repo.setCoverSource(db, coverId, { ...source, front: { url: picked.url, source: picked.source, kind: picked.kind, width: picked.width, height: picked.height, fit: fit.score, applied: true } });
    reporter.done("pick", `${picked.source} ${picked.kind} · ${picked.width}×${picked.height} · fit ${fit.score}${wanted ? " (your pick)" : ""}`);

    // Back panel and screenshots: RAWG's landscape images, which suit those slots.
    const shots = candidates.filter((c) => c.source === "RAWG" && c.kind === "screenshot" && c.url !== picked.url);
    const shotUrls = shots.length ? shots.map((s) => s.url) : meta?.shotUrls || [];
    const backUrl = meta?.heroUrl && meta.heroUrl !== picked.url ? meta.heroUrl : shotUrls[0];
    if (!existing.has("back") && backUrl) {
      await saveFetched(db, dataDir, coverId, "back", `back-fetched.${extOf(backUrl)}`, backUrl, accountId).catch(() => {});
    }
    let saved = 0;
    for (let i = 0; i < 3 && i < shotUrls.length; i++) {
      if (existing.get(`shot${i}`)?.kind === "upload") continue;
      if (await saveFetched(db, dataDir, coverId, `shot${i}`, `shot${i}.${extOf(shotUrls[i])}`, shotUrls[i], accountId).then(() => true, () => false)) saved++;
    }
    reporter.log(`Back panel: ${backUrl ? "RAWG background" : "flat colour"} · ${saved} screenshot${saved === 1 ? "" : "s"}.`);
  }

  /* 4 — back-cover copy */
  reporter.step("copy");
  if (copy) {
    reporter.done("copy", `Saved copy · ${wordCount(copy.blurb)} words`);
  } else if (auto && meta) {
    // Ollama is local and needs no key, so "configured" means "selected".
    // A dead local server is not fatal: deterministic fallbacks fill the slots.
    const llm = llmConfig(db, accountId, secret);
    if (llmAvailable(llm)) {
      copy = await llmCopy(meta, llmOpts(llm, "text")).catch(() => null);
      if (copy) repo.setCoverMeta(db, coverId, { copy });
    }
    reporter.done("copy", copy ? `${llm.provider} · ${wordCount(copy.blurb)} words` : "Language model unavailable — RAWG description used.");
  } else {
    reporter.skip("copy", "No metadata — the back panel uses defaults.");
  }

  /* 5 — render */
  reporter.step("render", "300 DPI · 3 mm bleed");
  const stored = repo.artPaths(db, coverId);
  const resolve = (rel) => (rel ? safeJoin(dataDir, rel) : null);
  const paths = {
    front: resolve(stored.front),
    back: resolve(stored.back),
    shots: stored.shots.map(resolve).filter(Boolean),
  };
  if (!paths.front) {
    throw permanent(
      auto
        ? "No front art could be fetched for this game. Check RAWG_KEY, or set SGDB_KEY for portrait art."
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

  const render = repo.addRender(db, coverId, {
    id: renderId,
    wrapPath: `renders/${renderId}/wrap.png`,
    frontPath: `renders/${renderId}/front.png`,
    qc: out.qc,
    cfg: out.cfg,
  });
  reporter.done("render", `v${render.version} · ${out.width} × ${out.height} px`);

  /* 6 — quality checks (run inside composeCover; reported here) */
  reporter.step("qc");
  for (const issue of out.qc.issues) reporter.log(`QC ${issue.level}: ${issue.msg}`, issue.level === "fail" ? "error" : "warn");
  reporter.done(
    "qc",
    `Score ${out.qc.score} · ${out.qc.fails} fail${out.qc.fails === 1 ? "" : "s"} · ${out.qc.warns} warning${out.qc.warns === 1 ? "" : "s"}`,
    out.qc.fails ? "failed" : "done"
  );

  /* 7 — route */
  reporter.step("route");
  repo.setCoverStatus(db, coverId, out.qc.status, { qc: out.qc });

  // A cover already signed off by hand keeps that decision through a rebuild —
  // the project's stated convention. QC still runs and is stored, so the review
  // page shows what changed; the reviewer can reject it explicitly.
  let routed = out.qc.status;
  if (cover.status === "approved") {
    repo.setCoverStatus(db, coverId, "approved", { qc: out.qc });
    routed = "approved";
  }
  if (out.qc.status === "failed") {
    // Not thrown: the render exists and is reviewable. The cover's error says why.
    repo.setCoverStatus(db, coverId, routed, { qc: out.qc, error: out.qc.issues.find((i) => i.level === "fail")?.msg || "" });
  }
  const ROUTE_LABEL = {
    auto_approved: "Auto-approved — ready to print",
    needs_review: "Sent to the review queue",
    approved: "Kept your approval",
    failed: "Failed quality checks — sent to review as failed",
  };
  reporter.done("route", ROUTE_LABEL[routed] || routed, routed === "failed" ? "failed" : "done");

  // Drop old versions from disk as well as the table, newest 5 kept.
  for (const [wrap, front] of repo.pruneRenders(db, coverId, 5)) {
    for (const rel of [wrap, front]) {
      if (!rel) continue;
      await fs.unlink(path.join(dataDir, rel)).catch(() => {});
    }
  }

  logger.log?.(`built ${cover.title} (${cover.platform}) → ${routed}`);
  return { renderId, qc: out.qc };
}

const wordCount = (text) => String(text || "").trim().split(/\s+/).filter(Boolean).length;
