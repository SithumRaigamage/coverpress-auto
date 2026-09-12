#!/usr/bin/env node
/* Coverpress automation.

  games.txt format:  Title | Platform | mode
    mode:  custom (recommended) — use art/<slug>/front.png; fall back to scraped art if missing
           auto              — use SteamGridDB / RAWG art only

  node pipeline.mjs build            fetch + compose + auto-check every game in games.txt
  node pipeline.mjs build --panels   write individual front/back/spine panels instead of wrap
  node pipeline.mjs build --platform PS4|PS5   override platform for every game
  node pipeline.mjs select           interactive game picker from RAWG search
  node pipeline.mjs prompts          write art prompts to art/<slug>/PROMPTS.md
  node pipeline.mjs review           open the manual review queue on :5173
  node pipeline.mjs print            build a print sheet of everything approved
  node pipeline.mjs models           list OpenRouter :free models and which take images
  node pipeline.mjs build --force    ignore the cache
*/

import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import { renderScene, renderPanel, renderRawPanel, DEFAULT_CFG, DPMM, CASE } from "./lib/render.mjs";
import { rawgLookup, sgdbCover, llmCopy, llmReview, llmArtPrompt, listFreeModels, fetchBuffer, searchGames } from "./lib/sources.mjs";
import { runChecks, mergeVision } from "./lib/qc.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "out");
const ART = path.join(ROOT, "art");
const CACHE = path.join(OUT, ".cache");
const MANIFEST = path.join(OUT, "manifest.json");

// auto = PS4 games get the PS4 look (accent band, black bottom block),
// PS5 games get the PS5 look (white band, white bottom block).
// ps4 / ps5 = force one look across every cover regardless of platform.
const LAYOUT = (process.env.COVER_LAYOUT || "auto").toLowerCase();

const ENV = {
  rawg: process.env.RAWG_KEY,
  sgdb: process.env.SGDB_KEY,
  key: process.env.OPENROUTER_KEY,
  textModel: process.env.OPENROUTER_TEXT_MODEL || "openrouter/free",
  visionModel: process.env.OPENROUTER_VISION_MODEL || "openrouter/free",
  // OpenRouter free tier: 20 req/min
  gap: 3200,
  vision: process.env.VISION_REVIEW !== "false",
  bleed: Number(process.env.BLEED_MM ?? 3),
  autoThreshold: Number(process.env.AUTO_THRESHOLD ?? 70),
};

const llmOpts = (which) => ({
  key: ENV.key,
  model: which === "vision" ? ENV.visionModel : ENV.textModel,
});

/**
 * Hand-made art in art/<slug>/ wins over anything fetched.
 * Layout:
 *   art/<slug>/front.{png,jpg,jpeg,webp}    <- required for custom mode
 *   art/<slug>/back.{png,jpg,jpeg,webp}     <- optional back panel background
 *   art/<slug>/shots/0..N.{png,jpg,...}     <- optional gameplay screenshots
 */
async function localArt(slug) {
  const found = { front: null, back: null, shots: [] };
  const artDir = path.join(ART, slug);

  // front.* / back.* — accept any image extension
  for (const key of ["front", "back"]) {
    let files = [];
    try {
      files = await fs.readdir(artDir);
    } catch {
      continue;
    }
    const match = files.find(
      (f) => new RegExp(`^${key}\\.(png|jpe?g|webp)$`, "i").test(f)
    );
    if (match) found[key] = path.join(artDir, match);
  }

  // shots/0..N.* — any image extension, sorted alphabetically
  try {
    const shotFiles = await fs.readdir(path.join(artDir, "shots"));
    const shots = shotFiles
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => path.join(artDir, "shots", f))
      .sort();
    found.shots = shots;
  } catch {}

  return found;
}

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function readManifest() {
  try {
    return JSON.parse(await fs.readFile(MANIFEST, "utf8"));
  } catch {
    return { generated: null, items: [] };
  }
}

/* ------------------------------------------------------------ rendering */

async function renderCover(cfg, imagePaths, { bleed = ENV.bleed } = {}) {
  const wrapW = cfg.panelW * 2 + cfg.spine;
  const cv = createCanvas(Math.round((wrapW + bleed * 2) * DPMM), Math.round((cfg.panelH + bleed * 2) * DPMM));
  const ctx = cv.getContext("2d");
  ctx.setTransform(DPMM, 0, 0, DPMM, bleed * DPMM, bleed * DPMM);

  const art = {
    front: imagePaths.front ? await loadImage(imagePaths.front) : null,
    back: imagePaths.back ? await loadImage(imagePaths.back) : null,
    shots: [],
  };
  for (const p of imagePaths.shots || []) {
    try {
      art.shots.push(await loadImage(p));
    } catch {}
  }

  renderScene(ctx, cfg, art, { bleed, cropMarks: bleed > 0 });
  return { canvas: cv, ctx, art };
}

/* --------------------------------------------------------- parseGamesTxt */

function parseGamesTxt(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((line) => {
      const [rawTitle, rawPlatform, rawMode] = line.split("|").map((s) => s.trim());
      const platform = rawPlatform || "PS5";
      const mode = rawMode === "auto" ? "auto" : rawMode === "raw" ? "raw" : "custom";
      return { title: rawTitle, platform, mode, line };
    });
}

/* --------------------------------------------------------------- build */

async function buildOne(line, force) {
  const { title: rawTitle, platform: rawPlatform, mode: rawMode } = parseGamesTxt(line)[0] || {};
  if (!rawTitle) return null; // skip empty lines
  const platform = platformOverride || rawPlatform.toUpperCase();
  const mode = rawMode;
  const slug = slugify(`${rawTitle}-${platform}`);
  const dir = path.join(OUT, slug);
  const cachePath = path.join(CACHE, `${slug}.json`);
  const artDir = path.join(ART, slug);
  const artShotsDir = path.join(artDir, "shots");

  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(CACHE, { recursive: true });
  await fs.mkdir(artDir, { recursive: true });
  await fs.mkdir(artShotsDir, { recursive: true });

  log(`  mode: ${mode}`);

  let cached = null;
  if (!force) cached = await fs.readFile(cachePath, "utf8").then(JSON.parse).catch(() => null);

  let meta, copy, imagePaths;

  // For raw mode, skip expensive RAWG/LLM calls — just need metadata and art paths.
  // Cache is still used to avoid re-fetching images on rebuilds.
  if (mode === "raw") {
    if (cached) {
      ({ meta, imagePaths } = cached);
      log(`  cache hit`);
    } else {
      meta = await rawgLookup(rawTitle, platform, ENV.rawg);
      if (!meta) throw new Error(`RAWG found nothing for "${rawTitle}" on ${platform}`);
      meta.query = rawTitle;
      log(`  matched ${meta.name}${meta.exactMatch ? "" : "  (inexact)"}`);
      imagePaths = { front: null, back: null, shots: [] };
      const grid = await sgdbCover(meta.name, ENV.sgdb).catch(() => null);
      if (grid) log(`  SteamGridDB grid ${grid.width}x${grid.height}`);
      const frontUrl = grid?.url || meta.heroUrl;
      if (frontUrl) {
        const p = path.join(dir, "front-src.png");
        await fs.writeFile(p, await fetchBuffer(frontUrl));
        imagePaths.front = p;
      }
      if (meta.heroUrl && grid) {
        const p = path.join(dir, "back-src.jpg");
        await fs.writeFile(p, await fetchBuffer(meta.heroUrl));
        imagePaths.back = p;
      }
      await fs.writeFile(cachePath, JSON.stringify({ meta, imagePaths }, null, 2));
    }
  } else {
    // auto / custom: full pipeline with copy and art prompts
    if (cached) {
      ({ meta, copy, imagePaths } = cached);
      log(`  cache hit`);
    } else {
      meta = await rawgLookup(rawTitle, platform, ENV.rawg);
      if (!meta) throw new Error(`RAWG found nothing for "${rawTitle}" on ${platform}`);
      meta.query = rawTitle;
      log(`  matched ${meta.name}${meta.exactMatch ? "" : "  (inexact)"}`);

      const grid = await sgdbCover(meta.name, ENV.sgdb).catch(() => null);
      if (grid) log(`  SteamGridDB grid ${grid.width}x${grid.height}`);

      imagePaths = { front: null, back: null, shots: [] };
      const frontUrl = grid?.url || meta.heroUrl;
      if (frontUrl) {
        const p = path.join(dir, "front-src.png");
        await fs.writeFile(p, await fetchBuffer(frontUrl));
        imagePaths.front = p;
      }
      if (meta.heroUrl && grid) {
        const p = path.join(dir, "back-src.jpg");
        await fs.writeFile(p, await fetchBuffer(meta.heroUrl));
        imagePaths.back = p;
      }
      for (const [i, url] of meta.shotUrls.entries()) {
        const p = path.join(dir, `shot-${i}.jpg`);
        await fs.writeFile(p, await fetchBuffer(url));
        imagePaths.shots.push(p);
        await sleep(150);
      }

      copy = await llmCopy(meta, llmOpts("text")).catch((e) => {
        log(`  LLM copy failed (${e.message}) — falling back to the RAWG description`);
        return null;
      });

      await fs.writeFile(cachePath, JSON.stringify({ meta, copy, imagePaths }, null, 2));
    }
  }

  // Generate art prompts for art/<slug>/PROMPTS.md — cached to out/<slug>/PROMPTS.json
  // so no extra LLM calls on rebuild. The PROMPTS.md is regenerated from the JSON.
  // Skip for raw mode (no template drawn, so prompts are wasted API budget).
  const promptsJsonPath = path.join(dir, "PROMPTS.json");
  const promptsMdPath = path.join(artDir, "PROMPTS.md");
  let artPrompts = null;
  if (mode !== "raw") {
    try {
      if (!force) {
        const existing = await fs.readFile(promptsJsonPath, "utf8");
        artPrompts = JSON.parse(existing);
      }
    } catch {}
    if (!artPrompts && ENV.key) {
      artPrompts = await llmArtPrompt(meta, llmOpts("text")).catch(() => null);
      if (artPrompts) {
        await fs.writeFile(promptsJsonPath, JSON.stringify(artPrompts, null, 2));
        await writePromptsMd(promptsMdPath, meta, platform, artPrompts);
        log(`  art prompts written  art/${slug}/PROMPTS.md`);
      }
      await sleep(ENV.gap);
    }
  }

  // art/<slug>/front.png overrides whatever was fetched, and is re-checked on every build.
  const custom = await localArt(slug);

  // In custom mode (recommended), missing custom art falls back to scraped art with a warning.
  // In auto mode, scraped art is always the default.
  const useFront = custom.front || (mode === "auto" || imagePaths.front ? imagePaths.front : null);
  const useBack  = custom.back  || (mode === "auto" || imagePaths.back  ? imagePaths.back  : null);
  const useShots = custom.shots.length ? custom.shots : imagePaths.shots;

  if (custom.front) {
    log(`  using custom art  art/${slug}/front.png`);
  } else if (mode === "custom") {
    log(`  custom mode: no art/${slug}/front.png — falling back to scraped art`);
  }

  const paths = { front: useFront, back: useBack, shots: useShots };

  // Raw mode: just the image, no template.
  if (mode === "raw") {
    const art = { front: null, back: null };
    if (paths.front) art.front = await loadImage(paths.front);
    if (paths.back) art.back = await loadImage(paths.back);

    let qc = runChecks({ cfg: {}, meta, art, ctx: null, pxPerMm: DPMM, mode: "raw" });

    const files = {};
    if (art.front) {
      const frontCv = renderRawPanel("front", art, { bleed: ENV.bleed });
      const frontPng = frontCv.toBuffer("image/png");
      await fs.writeFile(path.join(dir, "front.png"), frontPng);
      files.front = `${slug}/front.png`;
      files.wrap = `${slug}/front.png`; // Reuse front for review thumbnail.
    }
    if (art.back) {
      const backCv = renderRawPanel("back", art, { bleed: ENV.bleed });
      const backPng = backCv.toBuffer("image/png");
      await fs.writeFile(path.join(dir, "back.png"), backPng);
      files.back = `${slug}/back.png`;
    }

    log(`  raw mode rendered  front.png${art.back ? " back.png" : ""}`);

    return {
      slug,
      title: meta.name,
      query: rawTitle,
      platform,
      mode,
      cfg: {},
      imagePaths: paths,
      customArt: !!custom.front,
      files,
      qc,
      status: qc.status,
      decision: null,
      builtAt: new Date().toISOString(),
    };
  }

  // auto / custom: full template rendering
  // Every template slot gets a value even with no language model configured (or a failed
  // call), so the layout is identical for every game in games.txt regardless of copy status.
  const year = meta.released ? meta.released.slice(0, 4) : "";
  const fallbackTagline = [meta.genres.slice(0, 2).join(" · ").toUpperCase(), year].filter(Boolean).join(" · ");
  const fallbackFeatures = [
    ...meta.genres.slice(0, 3),
    year ? `Released ${year}` : null,
    meta.metacritic ? `Metacritic ${meta.metacritic}` : null,
  ].filter(Boolean).slice(0, 4);
  const fallbackBlurb =
    meta.description.split("\n").filter((l) => l.trim())[0]?.slice(0, 520) ||
    `${meta.name}${year ? `, released ${year}` : ""}. ${meta.genres.join(", ")}.`;

  const cfg = {
    ...DEFAULT_CFG,
    ...CASE,
    layout: LAYOUT === "auto" ? (platform === "PS4" ? "ps4" : "ps5") : LAYOUT,
    platform,
    title: meta.name,
    // The renderer only ever draws cfg.subtitle, never cfg.edition directly — wire it
    // here so the "Standard Edition" line under the title actually appears on covers.
    subtitle: process.env.COVER_EDITION || DEFAULT_CFG.edition,
    tagline: copy?.tagline || fallbackTagline,
    spineText: meta.name,
    blurb: copy?.blurb || fallbackBlurb,
    features: (copy?.features?.length ? copy.features : fallbackFeatures).slice(0, 4).join("\n"),
    publisher: meta.publisher,
    mark: process.env.COVER_MARK || "",
    address: process.env.COVER_ADDRESS || DEFAULT_CFG.address,
    accent: process.env.COVER_ACCENT || DEFAULT_CFG.accent,
    rating: meta.rating,
  };

  const { canvas, ctx, art } = await renderCover(cfg, paths);
  const png = canvas.toBuffer("image/png");

  if (panelsOnly) {
    // Write individual panels instead of the full wrap.
    const panelNames = ["front", "back", "spine"];
    for (const pn of panelNames) {
      const pCv = renderPanel(pn, cfg, art, { bleed: ENV.bleed });
      const pPng = pCv.toBuffer("image/png");
      await fs.writeFile(path.join(dir, `${pn}-panel.png`), pPng);
    }
    log(`  panels written  front-panel.png back-panel.png spine-panel.png`);
  } else {
    await fs.writeFile(path.join(dir, "wrap.png"), png);
  }

  // Front panel only, for the vision check and the review thumbnail.
  const fw = Math.round(cfg.panelW * DPMM);
  const fh = Math.round(cfg.panelH * DPMM);
  const front = createCanvas(600, Math.round((600 * fh) / fw));
  front
    .getContext("2d")
    .drawImage(canvas, Math.round((ENV.bleed + cfg.panelW + cfg.spine) * DPMM), Math.round(ENV.bleed * DPMM), fw, fh, 0, 0, front.width, front.height);
  const frontPng = front.toBuffer("image/png");
  await fs.writeFile(path.join(dir, "front.png"), frontPng);

  let qc = runChecks({ cfg, meta, art, ctx, pxPerMm: DPMM });

  if (ENV.vision && ENV.key && qc.fails === 0) {
    const vision = await llmReview(frontPng, meta.name, llmOpts("vision")).catch(() => null);
    qc = mergeVision(qc, vision, ENV.autoThreshold);
    await sleep(ENV.gap);
  }

  return {
    slug,
    title: meta.name,
    query: rawTitle,
    platform,
    mode,
    cfg,
    imagePaths: paths,
    customArt: !!custom.front,
    files: { wrap: `${slug}/wrap.png`, front: `${slug}/front.png` },
    qc,
    status: qc.status,
    decision: null,
    builtAt: new Date().toISOString(),
  };
}

async function build(force) {
  if (!ENV.rawg) throw new Error("RAWG_KEY is not set. Get a free key at https://rawg.io/apidocs");
  const gamesTxt = await fs.readFile(path.join(ROOT, "games.txt"), "utf8");
  const list = parseGamesTxt(gamesTxt).map((g) => g.line);

  const prev = await readManifest();
  const items = [];

  for (const [i, line] of list.entries()) {
    log(`[${i + 1}/${list.length}] ${line}`);
    try {
      const item = await buildOne(line, force);
      if (!item) continue; // skip empty lines
      // A cover already approved by hand keeps its decision through a rebuild.
      const old = prev.items.find((p) => p.slug === item.slug);
      if (old?.decision === "approved" && old.builtAt) item.decision = "approved";
      items.push(item);
      log(`  ${item.status}  score ${item.qc.score}  (${item.qc.issues.length} note${item.qc.issues.length === 1 ? "" : "s"})`);
    } catch (e) {
      log(`  failed: ${e.message}`);
      log(`  stack: ${e.stack.split("\n").slice(0, 5).join("\n  ")}`);
      items.push({ slug: slugify(line), title: line, status: "failed", error: e.message, qc: { issues: [{ level: "fail", msg: e.message }], score: 0 }, decision: null });
    }
    await sleep(400); // RAWG asks for roughly one request per second
  }

  await fs.writeFile(MANIFEST, JSON.stringify({ generated: new Date().toISOString(), items }, null, 2));

  const by = (s) => items.filter((i) => i.status === s).length;
  const withCustomArt = items.filter((i) => i.customArt);
  log(`\n${items.length} covers · ${by("auto_approved")} auto-approved · ${by("needs_review")} need review · ${by("failed")} failed`);
  if (withCustomArt.length) log(`  ${withCustomArt.length} cover(s) use your art from art/<slug>/`);
  log(`\nGenerate cover art:  npm run prompts   (writes art/<slug>/PROMPTS.md)`);
  log(`Review queue:         node pipeline.mjs review`);
}

/* -------------------------------------------------------------- review */

async function review() {
  const reviewHtml = await fs.readFile(path.join(ROOT, "review", "index.html"));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(reviewHtml);
    }

    if (url.pathname === "/api/manifest") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(await readManifest()));
    }

    if (url.pathname === "/api/decide" && req.method === "POST") {
      const body = JSON.parse(await new Promise((r) => {
        let b = "";
        req.on("data", (c) => (b += c));
        req.on("end", () => r(b || "{}"));
      }));
      const m = await readManifest();
      const item = m.items.find((i) => i.slug === body.slug);
      if (item) {
        item.decision = body.decision;
        if (body.cfg) {
          item.cfg = { ...item.cfg, ...body.cfg };
          const { canvas } = await renderCover(item.cfg, item.imagePaths);
          await fs.writeFile(path.join(OUT, item.slug, "wrap.png"), canvas.toBuffer("image/png"));
        }
        await fs.writeFile(MANIFEST, JSON.stringify(m, null, 2));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: !!item }));
    }

    // static files out of out/
    try {
      const file = path.join(OUT, decodeURIComponent(url.pathname));
      if (!file.startsWith(OUT)) throw new Error("nope");
      const buf = await fs.readFile(file);
      const ext = path.extname(file);
      res.writeHead(200, { "Content-Type": ext === ".png" ? "image/png" : ext === ".json" ? "application/json" : "application/octet-stream" });
      return res.end(buf);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });

  server.listen(5173, () => log("Review queue on http://localhost:5173"));
}

/* --------------------------------------------------------------- print */

async function printSheet() {
  const m = await readManifest();
  const ready = m.items.filter((i) => (i.decision === "approved" || (i.status === "auto_approved" && i.decision !== "rejected")) && i.mode !== "raw");
  if (!ready.length) return log("Nothing approved yet.");

  const wrapW = CASE.panelW * 2 + CASE.spine + ENV.bleed * 2;
  const pages = ready
    .map(
      (i) => `<section><img src="${i.files.wrap}" style="width:${wrapW}mm">
      <p>${i.title} — ${i.platform} — print at 100%, actual size</p></section>`
    )
    .join("\n");

  const html = `<!doctype html><meta charset="utf-8"><title>Coverpress print sheet</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  body { margin:0; font:11px/1.4 Helvetica,Arial,sans-serif; }
  section { page-break-after: always; display:flex; flex-direction:column; align-items:center; justify-content:center; height:194mm; }
  img { display:block; }
  p { color:#666; margin-top:4mm; }
  @media print { p { color:#999; } }
</style>
${pages}`;

  await fs.writeFile(path.join(OUT, "print.html"), html);
  log(`out/print.html — ${ready.length} cover(s). Open it, print at 100% / Actual size, or save as PDF.`);
}

/* ------------------------------------------------------------- prompts */

/** Write a per-game PROMPTS.md into art/<slug>/ so the user can paste prompts into Google Flow. */
async function writePromptsMd(outPath, meta, platform, p) {
  const shotBlock = (i, label) => `## ${label}
16:9 · 128×72mm · 721×406 px at 300 DPI
In-game scene. No UI, no text, no watermarks. Vary framing: shot ${i} should be a different composition from the others.

\`\`\`
${p.shots[i] || ""}
\`\`\`
`;

  const frontPalette = p.front.palette ? `\nPalette: ${p.front.palette}` : "";
  const frontAccent = p.front.accentHex ? `  ·  accent ${p.front.accentHex}` : "";
  const backPalette = p.back.palette ? `\nPalette: ${p.back.palette}` : "";
  const backAccent = p.back.accentHex ? `  ·  accent ${p.back.accentHex}` : "";

  const doc = `# ${meta.name} (${platform}) — cover art prompts

Generate each prompt in Google Flow, Gemini, or your preferred image generator, then save
the image into the same \`art/${slugify(meta.name + " " + platform)}/\` folder under the
filename shown. The pipeline picks them up automatically on the next \`npm run build\`.

## Front cover (required)
Portrait 3:4 · 128×148mm · 1512×1748 px at 300 DPI
Save as \`front.png\`. Subject fills the upper 2/3; the bottom 1/3 must stay calm and
dark — the game title and platform logo print on top of it.

\`\`\`
${p.front.prompt}
\`\`\`${frontPalette}${frontAccent}

---

## Back panel background (optional)
Portrait 3:4 · 128×148mm · 1512×1748 px at 300 DPI
Save as \`back.png\`. Dark, moody, low-detail — 80% of this panel is overlaid with text,
screenshots, a rating box, and a barcode.

\`\`\`
${p.back.prompt}
\`\`\`${backPalette}${backAccent}

---

${shotBlock(0, "Screenshot 1 of 3 (required)")}

---

${shotBlock(1, "Screenshot 2 of 3 (required)")}

---

${shotBlock(2, "Screenshot 3 of 3 (required)")}

---

## Files to produce

| Slot | File | Required? |
|---|---|---|
| Front | \`front.png\` | **yes** |
| Back | \`back.png\` | optional |
| Shot 1 | \`shots/0.jpg\` | recommended |
| Shot 2 | \`shots/1.jpg\` | recommended |
| Shot 3 | \`shots/2.jpg\` | recommended |

Missing slots fall back to scraped art. Run \`npm run build\` after dropping images in.
`;

  await fs.writeFile(outPath, doc);
}

async function prompts(onlyMissing) {
  const m = await readManifest();
  if (!m.items.length) throw new Error("Run `npm run build` first.");

  const targets = m.items.filter((i) => {
    if (i.status === "failed" || !i.cfg) return false;
    if (!onlyMissing) return true;
    return !i.customArt;
  });

  if (!ENV.key) {
    log("No OPENROUTER_KEY — cannot generate prompts. Set the key in .env and retry.");
    return;
  }

  let written = 0;
  for (const [n, item] of targets.entries()) {
    const artDir = path.join(ART, item.slug);
    const shotsDir = path.join(artDir, "shots");
    const promptsJsonPath = path.join(OUT, item.slug, "PROMPTS.json");
    const promptsMdPath = path.join(artDir, "PROMPTS.md");

    await fs.mkdir(artDir, { recursive: true });
    await fs.mkdir(shotsDir, { recursive: true });

    let artPrompts = null;
    try {
      artPrompts = JSON.parse(await fs.readFile(promptsJsonPath, "utf8"));
    } catch {}

    if (!artPrompts) {
      const cached = await fs
        .readFile(path.join(CACHE, `${item.slug}.json`), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (!cached?.meta) continue;

      log(`[${n + 1}/${targets.length}] ${item.title}`);
      artPrompts = await llmArtPrompt(cached.meta, llmOpts("text")).catch(() => null);
      if (artPrompts) {
        await fs.writeFile(promptsJsonPath, JSON.stringify(artPrompts, null, 2));
      }
      await sleep(ENV.gap);
    }

    if (artPrompts) {
      // We don't have meta here directly — recover it from cache.
      const cached = await fs
        .readFile(path.join(CACHE, `${item.slug}.json`), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (cached?.meta) {
        await writePromptsMd(promptsMdPath, cached.meta, item.platform, artPrompts);
        written++;
        log(`  art/${item.slug}/PROMPTS.md`);
      }
    }
  }

  log(`\n${written} prompt file(s) written into art/<slug>/PROMPTS.md`);
  log(`Generate the images in Google Flow, drop them into the matching art/<slug>/ folder, then run \`npm run build\`.`);
}

/* -------------------------------------------------------------- models */

async function models() {
  const list = await listFreeModels(process.env.OPENROUTER_KEY);
  const vision = list.filter((m) => m.vision);
  log(`\n${vision.length} free model(s) that accept images — use one for OPENROUTER_VISION_MODEL:`);
  vision.slice(0, 12).forEach((m) => log(`  ${m.id.padEnd(52)} ${m.name}`));
  log(`\nText-only free models — use one for OPENROUTER_TEXT_MODEL:`);
  list.filter((m) => !m.vision).slice(0, 12).forEach((m) => log(`  ${m.id.padEnd(52)} ${m.name}`));
  log(`\nThe free list rotates, so re-run this if a model starts 404ing.`);
}

/* --------------------------------------------------------------- pick */

/** Web-based game picker: search RAWG, edit games.txt visually. */
async function pick() {
  if (!ENV.rawg) throw new Error("RAWG_KEY is not set. Get a free key at https://rawg.io/apidocs");

  const pickerHtml = await fs.readFile(path.join(ROOT, "picker", "index.html"));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(pickerHtml);
    }

    if (url.pathname === "/api/search") {
      const q = url.searchParams.get("q");
      if (!q) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Missing q parameter" }));
      }
      try {
        const hits = await searchGames(q, ENV.rawg);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ hits }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    if (url.pathname === "/api/games" && req.method === "GET") {
      try {
        const txt = await fs.readFile(path.join(ROOT, "games.txt"), "utf8");
        const games = parseGamesTxt(txt);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ games }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    if (url.pathname === "/api/games" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { games } = JSON.parse(body || "{}");
          if (!Array.isArray(games)) throw new Error("games must be an array");
          const lines = games.map((g) => `${g.title} | ${g.platform} | ${g.mode}`);
          await fs.writeFile(path.join(ROOT, "games.txt"), lines.join("\n") + "\n");
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: e.message }));
        }
      });
    }

    res.writeHead(404);
    res.end("not found");
  });

  server.listen(5174, () => log("Game picker on http://localhost:5174"));
}

/* ---------------------------------------------------------------- main */

const cmd = process.argv[2] || "build";
const force = process.argv.includes("--force");
const platformOverride = process.argv.includes("--platform") ? (process.argv[process.argv.indexOf("--platform") + 1] || "").toUpperCase() : "";
const panelsOnly = process.argv.includes("--panels");

try {
  if (cmd === "build") await build(force);
  else if (cmd === "review") await review();
  else if (cmd === "print") await printSheet();
  else if (cmd === "prompts") await prompts(process.argv.includes("--missing"));
  else if (cmd === "models") await models();
  else if (cmd === "select") await pick();
  else log("Commands: build | review | print | prompts | models | select");
} catch (e) {
  console.error(`\n${e.message}`);
  process.exit(1);
}
