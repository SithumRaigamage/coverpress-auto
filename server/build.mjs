/* The build worker: fetch (or reuse) metadata and art, compose, check, store.

   Steps, each reported to the job row so the run screen can draw them
   (server/progress.mjs): fetch metadata, collect art, generate AI art
   (optional), pick front art, write back-cover copy, render the wrap,
   quality checks, route the cover.

   Two job kinds (server/jobs.mjs):
     build    re-render from the stored inputs — same art, same copy. Free.
     variant  a new version: the next-best front art not used by an earlier
              version, other back-panel screenshots, freshly seeded copy, and
              a new layout seed (title position, band colour from the art).
   Every run adds a version; versions are never pruned.

   Manual covers (uploaded art only) never touch the network, which is what keeps
   most of the test suite offline. */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { loadImage } from "@napi-rs/canvas";
import { composeCover } from "../lib/cover.mjs";
import { artFit, mergeVision } from "../lib/qc.mjs";
import { sampleAccent } from "../lib/color.mjs";
import { rawgLookup, llmCopy, llmReview, fetchBuffer } from "../lib/sources.mjs";
import * as repo from "./repo.mjs";
import { providerKey } from "./auth.mjs";
import { llmConfig, llmOpts } from "./llm.mjs";
import { safeJoin } from "./http.mjs";
import { nullReporter } from "./progress.mjs";

const permanent = (message) => Object.assign(new Error(message), { permanent: true });

const AUTO_THRESHOLD = () => Number(process.env.AUTO_THRESHOLD ?? 70);

/** Persist an image and record it as a fetched art row. Local art (AI images
   under data/art/generated) is read from disk; anything else is downloaded.
   Paths are stored relative to the data directory so every read goes through
   safeJoin — a database row can never point outside the deployment's storage. */
async function saveArt({ db, dataDir, coverId, slot, fileName, url, accountId, localFile }) {
  const rel = `art/${accountId}/${coverId}/${fileName}`;
  const dest = safeJoin(dataDir, rel);
  if (!dest) throw permanent("Refusing to write outside the data directory.");
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const local = localFile?.(url);
  const buf = local ? await fs.readFile(local) : await fetchBuffer(url);
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
  return { width, height, file: dest };
}

const extOf = (url) => (/\.png(\?|$)/i.test(url) ? "png" : /\.webp(\?|$)/i.test(url) ? "webp" : "jpg");

/** Next candidate for a variant: best fit not used before; when all are used, the least recently used. */
export function nextUnused(candidates, used = []) {
  const fresh = candidates.find((c) => !used.includes(c.url));
  if (fresh) return { pick: fresh, cycled: false };
  const byAge = [...candidates].sort((a, b) => used.indexOf(a.url) - used.indexOf(b.url));
  return { pick: byAge[0] || null, cycled: true };
}

/** Three screenshots for the back panel, rotated by the variant seed. */
export function rotateShots(urls, seed) {
  if (urls.length <= 3) return urls;
  const start = (seed * 3) % urls.length;
  return [0, 1, 2].map((i) => urls[(start + i) % urls.length]);
}

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
  kind = "build",
  catalog = null,
  aiArt = null,
  onRawgCall,
}) {
  const cover = repo.getCover(db, accountId, coverId);
  if (!cover) throw permanent("That cover no longer exists.");

  repo.setCoverStatus(db, coverId, "processing");
  reporter.begin(attempt);
  try {
    return await buildOnce({ db, dataDir, secret, accountId, coverId, cover, logger, bleed, reporter, kind, catalog, aiArt, onRawgCall });
  } catch (error) {
    // Whatever went wrong, the cover must not stay stuck on "Building".
    // A retryable failure is moved back to queued by the worker.
    reporter.fail(error.message);
    repo.setCoverStatus(db, coverId, "failed", { error: error.message });
    throw error;
  }
}

async function buildOnce({ db, dataDir, secret, accountId, coverId, cover, logger, bleed, reporter, kind, catalog, aiArt, onRawgCall }) {
  let meta = repo.coverMeta(cover);
  let copy = repo.coverCopy(cover);
  let source = repo.coverSource(cover);
  const auto = cover.mode === "auto";
  const variant = kind === "variant" && auto;
  // The version this run will produce, zero-based: the variant seed.
  const seed = repo.nextRenderVersion(db, coverId) - 1;
  // A pick made on the game screen that has not been downloaded yet. Once the
  // build stores it, `applied` flips and later same-input runs reuse the file.
  const repick = Boolean(source.front?.url && source.front.applied === false);
  const llm = llmConfig();
  const versionMeta = { mode: variant ? "variant" : "same", seed };

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
  // Title-only covers learn their RAWG id from the lookup, which is enough to browse art.
  const rawgId = source.rawgId || (Number.isInteger(meta?.id) ? meta.id : null);

  /* 2 — collect art candidates */
  reporter.step("collect");
  const existing = new Map(repo.listArt(db, coverId).map((r) => [r.slot, r]));
  const keepStored = existing.has("front") && !repick && !variant;
  let candidates = [];
  if (!auto) {
    reporter.skip("collect", existing.has("front") ? "Using uploaded art." : "No uploaded art.");
  } else if (keepStored) {
    reporter.done("collect", `Front art already stored (${existing.get("front").kind}) — same-art run.`);
  } else if (rawgId && catalog) {
    const art = await catalog.art(rawgId);
    candidates = art.items;
    reporter.done(
      "collect",
      `${art.counts.rawg} from RAWG · ${art.sgdb.enabled ? `${art.counts.sgdb} from SteamGridDB` : "SteamGridDB off"}` +
        (art.counts.ai ? ` · ${art.counts.ai} AI generated` : "")
    );
  } else {
    if (meta?.heroUrl) {
      candidates.push({ id: "rawg:hero", source: "RAWG", kind: "background", url: meta.heroUrl, width: 0, height: 0, fit: 0 });
    }
    reporter.done("collect", candidates.length ? "RAWG hero image" : "No candidates");
  }

  /* 3 — generate AI art (optional; enabled in Settings) */
  reporter.step("ai");
  if (!auto || keepStored) {
    reporter.skip("ai", "Not needed for a same-art run.");
  } else if (!aiArt) {
    reporter.skip("ai", "Off in Settings.");
  } else if (!rawgId || !meta) {
    reporter.skip("ai", "No game metadata to prompt from.");
  } else {
    const result = await aiArt({ rawgId, meta, variant, candidates });
    if (result.items?.length) {
      // Fresh images join the pool and are re-ranked with everything else.
      candidates = [...result.items, ...candidates].sort((a, b) => b.fit - a.fit);
    }
    if (result.skipped) reporter.skip("ai", result.detail);
    else reporter.done("ai", result.detail, result.failed ? "failed" : "done");
  }

  /* 4 — pick front art */
  reporter.step("pick");
  let front = null;
  if (!auto) {
    const f = existing.get("front");
    reporter.skip("pick", f ? "Uploaded front art." : "Nothing to pick.");
  } else if (keepStored) {
    const f = existing.get("front");
    reporter.done("pick", `Keeping stored front art · ${f.width}×${f.height}`);
    front = source.front || null;
  } else {
    const used = source.usedFront || [];
    let ranked;
    let note = "";
    if (repick && !variant) {
      const wanted = candidates.find((c) => c.url === source.front.url) || source.front;
      ranked = [wanted, ...candidates.filter((c) => c.url !== wanted.url)];
      note = " (your pick)";
    } else if (variant) {
      const { pick, cycled } = nextUnused(candidates, used);
      ranked = pick ? [pick, ...candidates.filter((c) => c.url !== pick.url)] : candidates;
      note = cycled ? " (every candidate used — cycling)" : used.length ? ` (next best, ${used.length} used before)` : "";
    } else {
      ranked = candidates;
    }
    for (const c of ranked) {
      try {
        const saved = await saveArt({ db, dataDir, coverId, slot: "front", fileName: `front-fetched.${extOf(c.url)}`, url: c.url, accountId, localFile: catalog?.localFile });
        front = { ...c, width: saved.width, height: saved.height, file: saved.file };
        break;
      } catch (err) {
        reporter.log(`Could not download ${c.source} ${c.kind}: ${err.message}`, "warn");
      }
    }
    if (!front) {
      throw permanent("No front art could be fetched for this game. Check RAWG_KEY, set SGDB_KEY, or generate AI art.");
    }
    const fit = artFit(front.width, front.height);
    source = {
      ...source,
      ...(rawgId ? { rawgId } : {}),
      front: { url: front.url, source: front.source, kind: front.kind, width: front.width, height: front.height, fit: fit.score, applied: true },
      usedFront: [...used.filter((u) => u !== front.url), front.url].slice(-50),
    };
    repo.setCoverSource(db, coverId, source);
    reporter.done("pick", `${front.source} ${front.kind} · ${front.width}×${front.height} · fit ${fit.score}${note}`);

    // Back panel and screenshots: RAWG's landscape images suit those slots. A
    // variant rotates which three appear, and which image fills the back.
    const shotPool = candidates.filter((c) => c.source === "RAWG" && c.kind === "screenshot" && c.url !== front.url).map((c) => c.url);
    const pool = shotPool.length ? shotPool : (meta?.shotUrls || []).filter((u) => u !== front.url);
    const shots = variant ? rotateShots(pool, seed) : pool.slice(0, 3);
    const backChoices = [meta?.heroUrl, ...pool.filter((u) => !shots.includes(u))].filter((u) => u && u !== front.url);
    const backUrl = variant ? backChoices[seed % Math.max(1, backChoices.length)] : backChoices[0] || shots[0];
    if (backUrl && (variant || !existing.has("back"))) {
      await saveArt({ db, dataDir, coverId, slot: "back", fileName: `back-fetched.${extOf(backUrl)}`, url: backUrl, accountId }).catch(() => {});
    }
    let saved = 0;
    for (let i = 0; i < 3 && i < shots.length; i++) {
      if (!variant && existing.get(`shot${i}`)?.kind === "upload") continue;
      const ok = await saveArt({ db, dataDir, coverId, slot: `shot${i}`, fileName: `shot${i}.${extOf(shots[i])}`, url: shots[i], accountId }).then(
        () => true,
        () => false
      );
      if (ok) saved++;
    }
    versionMeta.shots = shots.slice(0, 3);
    reporter.log(`Back panel: ${backUrl ? "RAWG image" : "flat colour"} · ${saved} screenshot${saved === 1 ? "" : "s"}${variant ? ` (rotation ${seed})` : ""}.`);
  }
  if (front) versionMeta.front = { url: front.url, source: front.source, kind: front.kind, width: front.width, height: front.height };

  /* 5 — back-cover copy */
  reporter.step("copy");
  if (variant && meta) {
    const fresh = await llmCopy(meta, llmOpts(llm, "text", { seed })).catch(() => null);
    if (fresh?.blurb) {
      copy = fresh;
      repo.setCoverMeta(db, coverId, { copy });
      versionMeta.copy = "ollama";
      reporter.done("copy", `Ollama · seed ${seed} · ${wordCount(copy.blurb)} words`);
    } else {
      versionMeta.copy = copy ? "kept" : "rawg";
      reporter.done("copy", `Ollama unavailable — ${copy ? "previous copy kept" : "RAWG description used"}.`);
    }
  } else if (copy) {
    versionMeta.copy = "stored";
    reporter.done("copy", `Saved copy · ${wordCount(copy.blurb)} words`);
  } else if (auto && meta) {
    // A dead local Ollama is not fatal: deterministic RAWG fallbacks fill the slots.
    copy = await llmCopy(meta, llmOpts(llm, "text")).catch(() => null);
    if (copy) repo.setCoverMeta(db, coverId, { copy });
    versionMeta.copy = copy ? "ollama" : "rawg";
    reporter.done("copy", copy ? `Ollama · ${wordCount(copy.blurb)} words` : "Ollama unavailable — RAWG description used.");
  } else {
    reporter.skip("copy", "No metadata — the back panel uses defaults.");
  }

  /* Layout seed: a variant moves the title and takes its band colour from the art.
     Nudges tuned for the previous art (zoom, offsets) do not carry over. */
  if (variant) {
    const overrides = repo.coverOverrides(cover);
    const accent = front?.file ? await sampleAccent(front.file, cover.accent || undefined) : overrides.accent;
    const layout = {
      titleAnchor: seed % 2 === 0 ? "top" : "bottom",
      titleAlign: seed % 4 < 2 ? "left" : "center",
      ...(accent ? { accent } : {}),
    };
    const { zoom, offX, offY, ...rest } = overrides;
    repo.setCoverOverrides(db, coverId, { ...rest, ...layout });
    versionMeta.layout = layout;
    reporter.log(`Layout seed ${seed}: title ${layout.titleAnchor}/${layout.titleAlign}${accent ? `, band ${accent} sampled from the art` : ""}.`);
  }

  /* 6 — render */
  const version = seed + 1;
  reporter.step("render", `v${version} · 300 DPI · 3 mm bleed`);
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
        ? "No front art could be fetched for this game. Check RAWG_KEY, set SGDB_KEY, or generate AI art."
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

  const fresh = repo.getCover(db, accountId, coverId);
  const out = await composeCover({
    meta,
    copy,
    platform: cover.platform,
    title: cover.title,
    theme,
    overrides: repo.coverOverrides(fresh),
    artPaths: paths,
    bleed,
  });

  const renderId = crypto.randomUUID();
  const dir = path.join(dataDir, "renders", renderId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "wrap.png"), out.wrapPng);
  await fs.writeFile(path.join(dir, "front.png"), out.frontPng);
  reporter.done("render", `v${version} · ${out.width} × ${out.height} px`);

  /* 7 — quality checks: deterministic checks ran in composeCover; llava looks at the front. */
  reporter.step("qc", llm.vision ? `Deterministic checks + ${llm.ollama.visionModel}` : "Deterministic checks");
  let qc = out.qc;
  if (llm.vision && qc.fails === 0) {
    const vision = await llmReview(out.frontPng, out.cfg.title, llmOpts(llm, "vision")).catch(() => null);
    if (vision) {
      qc = mergeVision(qc, vision, AUTO_THRESHOLD());
      reporter.log(`Vision review (${llm.ollama.visionModel}): score ${vision.score ?? "—"}.`);
    } else {
      reporter.log("Vision review skipped — Ollama did not answer.", "warn");
    }
  }
  const render = repo.addRender(db, coverId, {
    id: renderId,
    wrapPath: `renders/${renderId}/wrap.png`,
    frontPath: `renders/${renderId}/front.png`,
    qc,
    cfg: out.cfg,
    meta: versionMeta,
  });
  for (const issue of qc.issues) reporter.log(`QC ${issue.level}: ${issue.msg}`, issue.level === "fail" ? "error" : "warn");
  reporter.done(
    "qc",
    `Score ${qc.score} · ${qc.fails} fail${qc.fails === 1 ? "" : "s"} · ${qc.warns} warning${qc.warns === 1 ? "" : "s"}`,
    qc.fails ? "failed" : "done"
  );

  /* 8 — route */
  reporter.step("route");
  let routed = qc.status;
  // A hand approval survives a same-inputs re-render: what was approved is what
  // prints (approved_render_id), and QC is still stored for the record. A
  // variant is new, unreviewed work, so it is routed on its own QC.
  if (cover.status === "approved" && !variant) {
    routed = "approved";
    if (!cover.approved_render_id) {
      const previous = repo.listVersions(db, accountId, coverId).find((v) => v.id !== render.id);
      if (previous) repo.setApprovedRender(db, coverId, previous.id);
    }
  } else {
    repo.setApprovedRender(db, coverId, "");
  }
  const error = routed === "failed" ? qc.issues.find((i) => i.level === "fail")?.msg || "" : "";
  repo.setCoverStatus(db, coverId, routed, { qc, error });
  const ROUTE_LABEL = {
    auto_approved: "Auto-approved — ready to print",
    needs_review: "Sent to the review queue",
    approved: "Kept your approval (the approved version still prints)",
    failed: "Failed quality checks — sent to review as failed",
  };
  reporter.done("route", `v${render.version} · ${ROUTE_LABEL[routed] || routed}`, routed === "failed" ? "failed" : "done");

  logger.log?.(`built ${cover.title} (${cover.platform}) v${render.version} → ${routed}`);
  return { renderId, version: render.version, qc };
}

const wordCount = (text) => String(text || "").trim().split(/\s+/).filter(Boolean).length;
