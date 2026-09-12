/* Deterministic pre-print checks. These run with no API calls and decide
   whether a cover auto-approves or lands in the manual queue. */

import { DPMM } from "./render.mjs";

const NEED_W = Math.round(128 * DPMM); // 1512
const NEED_H = Math.round(148 * DPMM); // 1748

/** Strip year/parens/edition noise so (2023) and "Standard Edition" don't cause false mismatches. */
function normalizeForMatch(s) {
  return s
    .toLowerCase()
    .replace(/\(\d{4}\)/g, "")           // "(2023)"
    .replace(/\b(standard|deluxe|ultimate|remastered|remake|collection|edition)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** Mean luminance + spread of the region the title sits on, read off the rendered canvas. */
function samplePatch(ctx, x, y, w, h) {
  const d = ctx.getImageData(Math.round(x), Math.round(y), Math.round(w), Math.round(h)).data;
  let sum = 0,
    sumSq = 0,
    n = 0;
  for (let i = 0; i < d.length; i += 16) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    sum += l;
    sumSq += l * l;
    n++;
  }
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}

export function runChecks({ cfg, meta, art, ctx, pxPerMm, mode }) {
  const issues = [];
  const add = (level, code, msg) => issues.push({ level, code, msg });

  // For raw mode, only check what's meaningful: the image itself.
  if (mode === "raw") {
    if (!art.front) {
      add("fail", "no_art", "No front artwork was found from any source.");
    } else {
      const w = art.front.width, h = art.front.height;
      if (w < NEED_W * 0.85 || h < NEED_H * 0.85) {
        add("warn", "low_res", `Art is ${w}x${h}; the panel needs ${NEED_W}x${NEED_H} at 300 DPI. Print will be soft.`);
      }
      if (w / h > 1.2) {
        add("warn", "landscape", `Art is landscape (${(w / h).toFixed(2)}:1) cropped into a 0.86:1 panel — heavy crop.`);
      }
    }
    const fails = issues.filter((i) => i.level === "fail").length;
    const warns = issues.filter((i) => i.level === "warn").length;
    const score = Math.max(0, 100 - fails * 100 - warns * 14);
    return {
      issues,
      fails,
      warns,
      score,
      status: fails > 0 ? "failed" : warns === 0 ? "auto_approved" : "needs_review",
    };
  }

  // Template mode: full checks
  if (!meta?.exactMatch) {
    // Only warn if the names differ in ways that aren't just year/edition noise.
    // e.g. "Marvel's Spider-Man 2" vs "Marvel's Spider-Man 2 (2023)" — same game.
    const n1 = normalizeForMatch(meta?.query || "");
    const n2 = normalizeForMatch(meta?.name || "");
    if (n1 && n2 && n1 !== n2) {
      add("warn", "match", `RAWG matched "${meta?.name}" — confirm this is the right game.`);
    }
  }

  if (!art.front) {
    add("fail", "no_art", "No front artwork was found from any source.");
  } else {
    const w = art.front.width, h = art.front.height;
    if (w < NEED_W * 0.85 || h < NEED_H * 0.85) {
      add("warn", "low_res", `Art is ${w}x${h}; the panel needs ${NEED_W}x${NEED_H} at 300 DPI. Print will be soft.`);
    }
    if (w / h > 1.2) {
      add("warn", "landscape", `Art is landscape (${(w / h).toFixed(2)}:1) cropped into a 0.86:1 panel — heavy crop.`);
    }
  }

  if (!cfg.title?.trim()) add("fail", "no_title", "Title is empty.");
  if ((cfg.spineText || cfg.title || "").length > 46) {
    add("warn", "spine_long", "Spine text is long; it will be set very small.");
  }
  const blurbWords = (cfg.blurb || "").trim().split(/\s+/).filter(Boolean).length;
  if (blurbWords < 25) add("warn", "thin_blurb", `Back cover copy is only ${blurbWords} words.`);
  if (blurbWords > 130) add("warn", "long_blurb", `Back cover copy is ${blurbWords} words and will overflow.`);
  if (!(art.shots || []).length) add("warn", "no_shots", "No screenshots on the back panel.");

  // Contrast behind the title block, wherever the title is anchored.
  if (ctx && art.front) {
    const frontX = (cfg.panelW + cfg.spine) * pxPerMm;
    const titleY = cfg.titleAnchor === "bottom" ? cfg.panelH - 34 : 22;
    const patch = samplePatch(ctx, frontX + 8 * pxPerMm, titleY * pxPerMm, 100 * pxPerMm, 26 * pxPerMm);
    if (patch.mean > 150) {
      add("warn", "title_contrast", `Title sits on a bright area (luminance ${Math.round(patch.mean)}/255); white text will be hard to read.`);
    }
  }

  const fails = issues.filter((i) => i.level === "fail").length;
  const warns = issues.filter((i) => i.level === "warn").length;
  const score = Math.max(0, 100 - fails * 100 - warns * 14);

  return {
    issues,
    fails,
    warns,
    score,
    status: fails > 0 ? "failed" : warns === 0 ? "auto_approved" : "needs_review",
  };
}

export function mergeVision(qc, vision, threshold = 70) {
  if (!vision) return qc;
  const extra = [];
  if (vision.titleLegible === false) extra.push({ level: "fail", code: "v_legible", msg: "Vision check: the title is not legible." });
  if (vision.titleClipped) extra.push({ level: "warn", code: "v_clipped", msg: "Vision check: the title looks clipped at an edge." });
  if (vision.subjectCropped) extra.push({ level: "warn", code: "v_crop", msg: "Vision check: the main subject is badly cropped." });
  if (vision.lowContrast) extra.push({ level: "warn", code: "v_contrast", msg: "Vision check: low contrast between text and art." });
  (vision.issues || []).slice(0, 3).forEach((m) => extra.push({ level: "warn", code: "v_note", msg: `Vision check: ${m}` }));

  const issues = [...qc.issues, ...extra];
  const fails = issues.filter((i) => i.level === "fail").length;
  // "match" warnings are informational and don't block auto-approval.
  const warns = issues.filter((i) => i.level === "warn" && i.code !== "match").length;
  const score = Math.min(qc.score, vision.score ?? 100) - warns * 4;

  return {
    issues,
    fails,
    warns,
    score,
    visionScore: vision.score,
    status: fails > 0 ? "failed" : warns === 0 && score >= threshold ? "auto_approved" : "needs_review",
  };
}
