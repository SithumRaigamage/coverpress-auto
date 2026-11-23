/* Shared cover composition.

   Both entry points use this: pipeline.mjs (local batch CLI) and the SaaS build
   worker. Keeping the config construction in one place is what stops the two
   from drifting — the CLI used to be the only caller, so every new template slot
   was wired twice or (worse) once.

   Nothing here talks to a network. Callers pass already-fetched metadata, copy
   and image paths. */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderScene, DEFAULT_CFG, CASE, DPMM } from "./render.mjs";
import { runChecks } from "./qc.mjs";

/* Reviewers can nudge these. They are deliberately the only keys a client may
   override: panelW/spine/base are print geometry and pricing invariants, not
   preferences. A crafted request must not be able to produce a 0 mm spine. */
export const OVERRIDE_KEYS = new Set([
  "title",
  "titleSize",
  "titleAnchor",
  "titleAlign",
  "zoom",
  "offX",
  "offY",
  "ribbon",
  "subtitle",
]);

const NUMERIC_RANGES = {
  titleSize: [7, 26],
  zoom: [1, 2.5],
  offX: [-30, 30],
  offY: [-30, 30],
};

const FONTS_ALLOWED = new Set(["condensed", "grotesk", "serif", "slab"]);
const ANCHORS = new Set(["top", "bottom"]);
const ALIGNS = new Set(["left", "center"]);

/** Keep only known override keys and coerce/validate their values. */
export function sanitizeOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!OVERRIDE_KEYS.has(k)) continue;
    if (k in NUMERIC_RANGES) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      const [min, max] = NUMERIC_RANGES[k];
      out[k] = Math.min(max, Math.max(min, n));
      continue;
    }
    if (k === "titleAnchor") {
      if (ANCHORS.has(v)) out[k] = v;
      continue;
    }
    if (k === "titleAlign") {
      if (ALIGNS.has(v)) out[k] = v;
      continue;
    }
    if (k === "titleFont") {
      if (FONTS_ALLOWED.has(v)) out[k] = v;
      continue;
    }
    out[k] = String(v ?? "").slice(0, 200);
  }
  return out;
}

const firstLine = (text, max = 520) =>
  String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0]
    ?.slice(0, max) || "";

/**
 * Build a complete template config from metadata, optional LLM copy and a theme.
 * Every slot has a deterministic fallback derived from RAWG data, so the cover
 * looks the same whether or not a language model is configured.
 */
export function coverCfg({ meta: rawMeta = {}, copy = null, platform = "PS5", theme = {}, overrides = {}, title = "" } = {}) {
  // Manual covers have no RAWG record at all; null must behave like {}.
  const meta = rawMeta || {};
  const year = meta.released ? String(meta.released).slice(0, 4) : "";
  // The title the user typed is the fallback when there is no RAWG record.
  const resolvedTitle = meta.name || String(title || "").trim();
  const genres = Array.isArray(meta.genres) ? meta.genres : [];
  const layout = theme.layout === "ps4" || theme.layout === "ps5"
    ? theme.layout
    : platform === "PS4" ? "ps4" : "ps5";

  const fallbackTagline = [genres.slice(0, 2).join(" · ").toUpperCase(), year].filter(Boolean).join(" · ");
  const fallbackFeatures = [
    ...genres.slice(0, 3),
    year ? `Released ${year}` : null,
    meta.metacritic ? `Metacritic ${meta.metacritic}` : null,
  ].filter(Boolean).slice(0, 4);
  // A manual cover has nothing to summarise. An empty blurb is honest; inventing
  // "This game. ." would print nonsense on the back panel.
  const fallbackBlurb = firstLine(meta.description) ||
    (resolvedTitle
      ? `${resolvedTitle}${year ? `, released ${year}` : ""}. ${genres.join(", ")}`.trim()
      : "");

  const cfg = {
    ...DEFAULT_CFG,
    ...CASE,
    layout,
    platform,
    title: resolvedTitle,
    subtitle: theme.edition || DEFAULT_CFG.edition,
    tagline: copy?.tagline || fallbackTagline,
    spineText: resolvedTitle,
    blurb: copy?.blurb || fallbackBlurb,
    features: (copy?.features?.length ? copy.features : fallbackFeatures).slice(0, 4).join("\n"),
    publisher: meta.publisher || "",
    mark: theme.mark || "",
    address: theme.address || DEFAULT_CFG.address,
    accent: theme.accent || DEFAULT_CFG.accent,
    rating: meta.rating || DEFAULT_CFG.rating,
  };

  return { ...cfg, ...sanitizeOverrides(overrides) };
}

async function loadMaybe(file) {
  if (!file) return null;
  try {
    return await loadImage(file);
  } catch {
    return null;
  }
}

/** Front panel only, downscaled — review thumbnails and the vision check. */
export function cropFrontPanel(canvas, cfg, bleed, width = 600) {
  const fw = Math.round(cfg.panelW * DPMM);
  const fh = Math.round(cfg.panelH * DPMM);
  const front = createCanvas(width, Math.round((width * fh) / fw));
  front
    .getContext("2d")
    .drawImage(
      canvas,
      Math.round((bleed + cfg.panelW + cfg.spine) * DPMM),
      Math.round(bleed * DPMM),
      fw,
      fh,
      0,
      0,
      front.width,
      front.height
    );
  return front;
}

/**
 * Render a full wrap at 300 DPI and run the deterministic checks.
 * Returns the canvas too, so a caller can draw individual panels from it.
 */
export async function composeCover({ meta, copy, platform, theme, overrides, artPaths = {}, bleed = 3, title = "" } = {}) {
  const cfg = coverCfg({ meta, copy, platform, theme, overrides, title });

  const art = {
    front: await loadMaybe(artPaths.front),
    back: await loadMaybe(artPaths.back),
    shots: [],
  };
  for (const p of (artPaths.shots || []).slice(0, 3)) {
    const img = await loadMaybe(p);
    if (img) art.shots.push(img);
  }

  const wrapW = cfg.panelW * 2 + cfg.spine;
  const canvas = createCanvas(
    Math.round((wrapW + bleed * 2) * DPMM),
    Math.round((cfg.panelH + bleed * 2) * DPMM)
  );
  const ctx = canvas.getContext("2d");
  ctx.setTransform(DPMM, 0, 0, DPMM, bleed * DPMM, bleed * DPMM);

  renderScene(ctx, cfg, art, { bleed, cropMarks: bleed > 0 });

  // `bleed` matters: getImageData ignores the context transform, so the QC
  // sampler must be told where the trim origin actually sits in device pixels.
  const qc = runChecks({ cfg, meta, art, ctx, pxPerMm: DPMM, bleed });

  return {
    cfg,
    art,
    qc,
    canvas,
    ctx,
    width: canvas.width,
    height: canvas.height,
    wrapPng: canvas.toBuffer("image/png"),
    frontPng: cropFrontPanel(canvas, cfg, bleed).toBuffer("image/png"),
    frontCanvas: cropFrontPanel(canvas, cfg, bleed),
  };
}
