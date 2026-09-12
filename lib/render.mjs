/* Cover renderer. All drawing is in millimetres; the caller scales the context.
   Works with any Canvas 2D context (@napi-rs/canvas in Node, HTMLCanvas in a browser).

   Layout follows retail case anatomy: full-width top band, front art panel,
   vertical spine, and a back panel with tagline, screenshot column, feature
   bullets and a dense spec/legal block along the bottom.

   All marks are generic and drawn here as vectors. No platform logos, rating
   board shields, disc-format marks or publisher logos are reproduced. */

import { createCanvas } from "@napi-rs/canvas";

export const DPMM = 300 / 25.4;
export const CASE = { panelW: 128, panelH: 148, spine: 14 };

export const FONTS = {
  condensed: '"Arial Narrow", "Liberation Sans Narrow", "Helvetica Neue Condensed", Impact, sans-serif',
  grotesk: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif',
  serif: 'Georgia, "Liberation Serif", "Times New Roman", serif',
  slab: '"Courier New", "Liberation Mono", monospace',
};

/* Band geometry, shared by all three panels. */
const BAND_H = 12;
const BLOCK_Y = 108; // top of the back panel's spec/legal block
const PAD = 9;

const dim = (img) => ({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });

export function drawCover(ctx, img, x, y, w, h, zoom = 1, offX = 0, offY = 0) {
  if (!img) return;
  const { w: iw, h: ih } = dim(img);
  const ir = iw / ih;
  let dw, dh;
  if (ir > w / h) { dh = h * zoom; dw = dh * ir; }
  else { dw = w * zoom; dh = dw / ir; }
  const dx = x + (w - dw) / 2 + (offX / 100) * w;
  const dy = y + (h - dh) / 2 + (offY / 100) * h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

export function wrapLines(ctx, text, maxW) {
  const out = [];
  (text || "").split("\n").forEach((para) => {
    if (!para.trim()) return out.push("");
    let line = "";
    para.split(/\s+/).forEach((word) => {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; }
      else line = test;
    });
    if (line) out.push(line);
  });
  return out;
}

function fitText(ctx, text, maxW, maxLines, startSize, family, minSize = 4) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `700 ${size}px ${family}`;
    const lines = wrapLines(ctx, text, maxW);
    if (lines.length <= maxLines) return { size, lines };
    size -= 0.4;
  }
  ctx.font = `700 ${minSize}px ${family}`;
  return { size: minSize, lines: wrapLines(ctx, text, maxW).slice(0, maxLines) };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < (str || "x").length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBarcode(ctx, x, y, w, h, seedStr, dark) {
  let seed = hash(seedStr);
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507)) >>> 9) / 8388608;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#000000";
  let cx = x + 1.2;
  while (cx < x + w - 1.2) {
    const bw = 0.22 + rnd() * 0.42;
    if (rnd() > 0.38) ctx.fillRect(cx, y + 0.8, bw, h - 3.2);
    cx += bw + 0.24;
  }
  ctx.font = `1.7px ${FONTS.slab}`;
  ctx.textAlign = "center";
  ctx.fillText(String(hash(seedStr)).padStart(12, "0").slice(0, 12), x + w / 2, y + h - 0.5);
  ctx.textAlign = "left";
}

/* ------------------------------------------------- generic spec glyphs */

function glyph(ctx, kind, x, y, s, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.09;
  const u = s;
  switch (kind) {
    case "player":
      ctx.beginPath(); ctx.arc(u * 0.5, u * 0.3, u * 0.19, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(u * 0.18, u * 0.85);
      ctx.quadraticCurveTo(u * 0.5, u * 0.45, u * 0.82, u * 0.85);
      ctx.lineTo(u * 0.18, u * 0.85); ctx.fill();
      break;
    case "disc":
      ctx.beginPath(); ctx.arc(u * 0.5, u * 0.5, u * 0.4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(u * 0.5, u * 0.5, u * 0.11, 0, Math.PI * 2); ctx.fill();
      break;
    case "pad":
      roundRect(ctx, u * 0.08, u * 0.3, u * 0.84, u * 0.42, u * 0.16); ctx.stroke();
      ctx.beginPath(); ctx.arc(u * 0.3, u * 0.51, u * 0.07, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(u * 0.7, u * 0.51, u * 0.07, 0, Math.PI * 2); ctx.fill();
      break;
    case "download":
      ctx.beginPath(); ctx.moveTo(u * 0.5, u * 0.12); ctx.lineTo(u * 0.5, u * 0.58); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(u * 0.3, u * 0.4); ctx.lineTo(u * 0.5, u * 0.62);
      ctx.lineTo(u * 0.7, u * 0.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(u * 0.15, u * 0.82); ctx.lineTo(u * 0.85, u * 0.82); ctx.stroke();
      break;
    case "hd":
      roundRect(ctx, u * 0.06, u * 0.24, u * 0.88, u * 0.52, u * 0.08); ctx.stroke();
      ctx.font = `700 ${u * 0.34}px ${FONTS.grotesk}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("HD", u * 0.5, u * 0.51);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      break;
    default:
      roundRect(ctx, u * 0.15, u * 0.15, u * 0.7, u * 0.7, u * 0.12); ctx.stroke();
  }
  ctx.restore();
}

function specChips(ctx, cfg, x, y, maxW, dark) {
  const fg = dark ? "#FFFFFF" : "#111111";
  const chipBg = dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.07)";
  const h = 7;
  let cx = x;
  ctx.font = `700 2.2px ${FONTS.grotesk}`;
  for (const spec of (cfg.specs || []).slice(0, 5)) {
    const label = String(spec.label || "").toUpperCase();
    const w = 6.5 + ctx.measureText(label).width + 3;
    if (cx + w > x + maxW) break;
    ctx.fillStyle = chipBg;
    roundRect(ctx, cx, y, w, h, 1.6);
    ctx.fill();
    glyph(ctx, spec.icon, cx + 1.6, y + 1.4, 4.2, fg);
    ctx.fillStyle = fg;
    ctx.font = `700 2.2px ${FONTS.grotesk}`;
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx + 6.6, y + h / 2 + 0.1);
    ctx.textBaseline = "alphabetic";
    cx += w + 1.6;
  }
}

/* ------------------------------------------------------------- panels */

function drawBand(ctx, cfg, x, w, bleedTop, bleedX) {
  const light = cfg.layout === "ps5";
  ctx.fillStyle = light ? "#FFFFFF" : cfg.accent;
  ctx.fillRect(x - bleedX, -bleedTop, w + bleedX * 2, BAND_H + bleedTop);
  if (light) {
    ctx.fillStyle = cfg.accent;
    ctx.fillRect(x - bleedX, BAND_H - 0.6, w + bleedX * 2, 0.6);
  }
  return light ? "#111111" : "#FFFFFF";
}

function drawFront(ctx, cfg, art, r, bleed) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, -bleed, r.w + bleed, r.h + bleed * 2);
  ctx.clip();

  if (art.front) {
    drawCover(ctx, art.front, r.x, BAND_H, r.w + bleed, r.h - BAND_H + bleed, cfg.zoom, cfg.offX, cfg.offY);
  } else {
    ctx.fillStyle = cfg.base;
    ctx.fillRect(r.x, BAND_H, r.w + bleed, r.h - BAND_H + bleed);
  }

  const top = cfg.titleAnchor !== "bottom";

  // Scrim so the title survives whatever the art is doing underneath.
  const g = top
    ? ctx.createLinearGradient(0, BAND_H, 0, BAND_H + 58)
    : ctx.createLinearGradient(0, r.h - 62, 0, r.h + bleed);
  g.addColorStop(0, top ? "rgba(0,0,0,0.62)" : "rgba(0,0,0,0)");
  g.addColorStop(1, top ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.88)");
  ctx.fillStyle = g;
  ctx.fillRect(r.x, top ? BAND_H : r.h - 62, r.w + bleed, top ? 58 : 62 + bleed);

  const fam = FONTS[cfg.titleFont] || FONTS.condensed;
  const maxW = r.w - PAD * 2;
  const fit = fitText(ctx, (cfg.title || "Untitled").toUpperCase(), maxW, 3, cfg.titleSize, fam);
  const lh = fit.size * 1.02;
  const startY = top ? BAND_H + 12 + fit.size : r.h - 18 - (fit.lines.length - 1) * lh;

  ctx.fillStyle = "#FFFFFF";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 2.4;
  ctx.textAlign = cfg.titleAlign || "left";
  const tx = cfg.titleAlign === "center" ? r.x + r.w / 2 : r.x + PAD;
  fit.lines.forEach((ln, i) => {
    ctx.font = `700 ${fit.size}px ${fam}`;
    ctx.fillText(ln, tx, startY + i * lh);
  });
  ctx.shadowBlur = 0;

  if (cfg.subtitle) {
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `400 3.4px ${FONTS.grotesk}`;
    ctx.fillText(cfg.subtitle, tx, startY + fit.lines.length * lh + 1.5);
  }
  ctx.textAlign = "left";

  // Ribbon, the "includes bonus mission" strip.
  if (cfg.ribbon) {
    const ry = top ? startY + fit.lines.length * lh + 8 : r.h - 46;
    ctx.font = `700 3px ${FONTS.grotesk}`;
    const w = ctx.measureText(cfg.ribbon.toUpperCase()).width + 8;
    ctx.fillStyle = cfg.accent;
    roundRect(ctx, r.x + PAD, ry, w, 7, 1);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textBaseline = "middle";
    ctx.fillText(cfg.ribbon.toUpperCase(), r.x + PAD + 4, ry + 3.6);
    ctx.textBaseline = "alphabetic";
  }

  // Rating box, bottom left. Generic — not a rating board's mark.
  ratingBox(ctx, cfg, r.x + PAD, r.h - PAD - 14, 11, 14, true);

  // Your mark, bottom right.
  if (cfg.mark) {
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `700 3.4px ${FONTS.grotesk}`;
    ctx.textAlign = "right";
    ctx.fillText(cfg.mark.toUpperCase(), r.x + r.w - PAD, r.h - PAD - 1);
    ctx.textAlign = "left";
  }

  const fg = drawBand(ctx, cfg, r.x, r.w + bleed, bleed, 0);
  ctx.fillStyle = fg;
  ctx.font = `700 7px ${FONTS.grotesk}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillText(cfg.platform, r.x + r.w - PAD, BAND_H / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

function ratingBox(ctx, cfg, x, y, w, h, onArt) {
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 0.35;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.font = `700 ${h * 0.5}px ${FONTS.grotesk}`;
  ctx.fillText(String(cfg.rating || "—"), x + w / 2, y + h * 0.62);
  ctx.fillRect(x, y + h * 0.72, w, 0.3);
  ctx.font = `700 1.7px ${FONTS.grotesk}`;
  ctx.fillText("RATING", x + w / 2, y + h * 0.9);
  ctx.textAlign = "left";
  ctx.restore();
}

function drawSpine(ctx, cfg, r) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, -0.01, r.w, r.h);
  ctx.clip();

  ctx.fillStyle = cfg.spineColor || cfg.base;
  ctx.fillRect(r.x, 0, r.w, r.h);

  const fam = FONTS[cfg.titleFont] || FONTS.condensed;
  const text = (cfg.spineText || cfg.title || "").toUpperCase();
  ctx.save();
  ctx.translate(r.x + r.w / 2, BAND_H + 8);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let ss = 5;
  ctx.font = `700 ${ss}px ${fam}`;
  while (ctx.measureText(text).width > r.h - BAND_H - 26 && ss > 2.2) {
    ss -= 0.2;
    ctx.font = `700 ${ss}px ${fam}`;
  }
  ctx.fillText(text, 0, 0);
  ctx.restore();

  if (cfg.mark) {
    ctx.save();
    ctx.translate(r.x + r.w / 2, r.h - 6);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = `700 2.6px ${FONTS.grotesk}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cfg.mark.toUpperCase(), 0, 0);
    ctx.restore();
  }

  const fg = drawBand(ctx, cfg, r.x, r.w, 0, 0);
  ctx.fillStyle = fg;
  ctx.font = `700 3.6px ${FONTS.grotesk}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(cfg.platform, r.x + r.w / 2, BAND_H / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

function drawBack(ctx, cfg, art, r, bleed) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-bleed, -bleed, r.w + bleed, r.h + bleed * 2);
  ctx.clip();

  // Background: darkened key art, or flat base.
  const src = art.back || art.front;
  ctx.fillStyle = cfg.base;
  ctx.fillRect(-bleed, -bleed, r.w + bleed, r.h + bleed * 2);
  if (src && cfg.backArt !== false) {
    drawCover(ctx, src, -bleed, -bleed, r.w + bleed, r.h + bleed * 2, 1.15);
    ctx.fillStyle = cfg.backScrim || "rgba(10,12,20,0.86)";
    ctx.fillRect(-bleed, -bleed, r.w + bleed, r.h + bleed * 2);
  }

  // Tagline.
  if (cfg.tagline) {
    ctx.fillStyle = "#FFFFFF";
    const t = fitText(ctx, cfg.tagline.toUpperCase(), 54, 3, 7, FONTS[cfg.titleFont] || FONTS.condensed, 3.4);
    t.lines.forEach((ln, i) => {
      ctx.font = `700 ${t.size}px ${FONTS[cfg.titleFont] || FONTS.condensed}`;
      ctx.fillText(ln, PAD, 20 + i * t.size * 1.12);
    });
  }

  // Screenshot column, right side.
  const shots = (art.shots || []).filter(Boolean).slice(0, 3);
  const colW = 44;
  const colX = r.w - PAD - colW;
  if (shots.length) {
    const sh = colW * 0.5625;
    const gap = 1.6;
    const totalH = shots.length * sh + (shots.length - 1) * gap;
    let sy = 30 + Math.max(0, (74 - totalH) / 2);
    shots.forEach((s) => {
      drawCover(ctx, s, colX, sy, colW, sh);
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 0.25;
      ctx.strokeRect(colX, sy, colW, sh);
      sy += sh + gap;
    });
  }

  // Feature bullets, left column.
  const bulletW = (shots.length ? colX - 2 : r.w - PAD) - PAD;
  let by = 40;
  const bullets = (cfg.features || "").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, 4);
  bullets.forEach((f) => {
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 3px ${FONTS.grotesk}`;
    const lines = wrapLines(ctx, f.toUpperCase(), bulletW - 3.5);
    ctx.fillStyle = cfg.accent;
    ctx.fillRect(PAD, by - 2.4, 1.3, 2.8);
    lines.slice(0, 3).forEach((ln, i) => {
      ctx.fillStyle = "rgba(255,255,255,0.93)";
      ctx.fillText(ln, PAD + 3.5, by + i * 3.9);
    });
    by += lines.slice(0, 3).length * 3.9 + 4.2;
  });

  // Fall back to prose if there are no bullets.
  if (!bullets.length && cfg.blurb) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `400 3px ${FONTS.grotesk}`;
    wrapLines(ctx, cfg.blurb, bulletW)
      .slice(0, 16)
      .forEach((ln, i) => ctx.fillText(ln, PAD, 40 + i * 4.2));
  }

  /* ---- bottom block ---- */
  const dark = cfg.layout !== "ps5";
  const blockH = r.h - BLOCK_Y;
  ctx.fillStyle = dark ? "#0A0A0A" : "#FFFFFF";
  ctx.fillRect(-bleed, BLOCK_Y, r.w + bleed, blockH + bleed);
  const fg = dark ? "#FFFFFF" : "#111111";
  const faint = dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)";

  specChips(ctx, cfg, PAD, BLOCK_Y + 3, r.w - PAD * 2, dark);

  // Studio / your own credit line.
  ctx.fillStyle = fg;
  ctx.font = `700 2.6px ${FONTS.grotesk}`;
  ctx.fillText((cfg.publisher || "").toUpperCase(), PAD, BLOCK_Y + 16);
  if (cfg.mark) {
    ctx.textAlign = "right";
    ctx.fillText(cfg.mark.toUpperCase(), r.w - PAD, BLOCK_Y + 16);
    ctx.textAlign = "left";
  }

  // Legal small print. Capped to whatever fits above the rating/address/barcode
  // row below — a hardcoded line count here would let long legal text run into it.
  const legalTop = BLOCK_Y + 18;
  const legalLineH = 2.2;
  const rowY = r.h - PAD - 9;
  const legalMaxLines = Math.max(0, Math.floor((rowY - 1 - legalTop) / legalLineH) + 1);
  ctx.fillStyle = faint;
  ctx.font = `400 1.85px ${FONTS.grotesk}`;
  wrapLines(ctx, cfg.legal || "", r.w - PAD * 2)
    .slice(0, legalMaxLines)
    .forEach((ln, i) => ctx.fillText(ln, PAD, legalTop + i * legalLineH));

  // Bottom row: rating, address, barcode.
  ratingBox(ctx, cfg, PAD, rowY, 11, 9.5);

  ctx.fillStyle = faint;
  ctx.font = `400 1.9px ${FONTS.grotesk}`;
  (cfg.address || "").split("\n").slice(0, 3).forEach((ln, i) => ctx.fillText(ln, PAD + 14, rowY + 3 + i * 2.4));

  drawBarcode(ctx, r.w - PAD - 28, rowY, 28, 9.5, cfg.title + cfg.platform, dark);

  const bandFg = drawBand(ctx, cfg, 0, r.w, bleed, bleed);
  ctx.fillStyle = bandFg;
  ctx.font = `700 3.6px ${FONTS.grotesk}`;
  ctx.textBaseline = "middle";
  ctx.fillText(cfg.platform, PAD, BAND_H / 2);
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

function drawCropMarks(ctx, w, h, bleed) {
  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 0.2;
  const L = bleed * 0.8;
  [[0, 0, -1, -1], [w, 0, 1, -1], [0, h, -1, 1], [w, h, 1, 1]].forEach(([x, y, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x + sx * (bleed - L), y); ctx.lineTo(x + sx * bleed, y);
    ctx.moveTo(x, y + sy * (bleed - L)); ctx.lineTo(x, y + sy * bleed);
    ctx.stroke();
  });
  ctx.restore();
}

/** Draw the full wrap. Origin (0,0) is the top-left trim corner. */
export function renderScene(ctx, cfg, art, { bleed = 0, cropMarks = false } = {}) {
  const pw = cfg.panelW ?? CASE.panelW;
  const ph = cfg.panelH ?? CASE.panelH;
  const sp = cfg.spine ?? CASE.spine;
  const wrapW = pw * 2 + sp;

  ctx.fillStyle = cfg.base;
  ctx.fillRect(-bleed, -bleed, wrapW + bleed * 2, ph + bleed * 2);
  drawBack(ctx, cfg, art, { x: 0, y: 0, w: pw, h: ph }, bleed);
  drawSpine(ctx, cfg, { x: pw, y: 0, w: sp, h: ph });
  drawFront(ctx, cfg, art, { x: pw + sp, y: 0, w: pw, h: ph }, bleed);
  if (cropMarks && bleed > 0) drawCropMarks(ctx, wrapW, ph, bleed);
}

/** Render a single panel without the wrap template. */
export function renderPanel(panelName, cfg, art, { bleed = 0 } = {}) {
  const pw = Math.round(cfg.panelW * DPMM);
  const ph = Math.round(cfg.panelH * DPMM);
  const cv = createCanvas(pw, ph);
  const ctx = cv.getContext("2d");
  ctx.setTransform(DPMM, 0, 0, DPMM, 0, 0);
  if (panelName === "back") drawBack(ctx, cfg, art, { x: 0, y: 0, w: cfg.panelW, h: cfg.panelH }, bleed);
  if (panelName === "spine") drawSpine(ctx, cfg, { x: 0, y: 0, w: cfg.spine, h: cfg.panelH });
  if (panelName === "front") drawFront(ctx, cfg, art, { x: 0, y: 0, w: cfg.panelW, h: cfg.panelH }, bleed);
  return cv;
}

/** Render raw panel art with zero template decoration — just the image fitted to the panel. */
export function renderRawPanel(panelName, art, { bleed = 0 } = {}) {
  const pw = Math.round(CASE.panelW * DPMM);
  const ph = Math.round(CASE.panelH * DPMM);
  const cv = createCanvas(pw, ph);
  const ctx = cv.getContext("2d");
  ctx.setTransform(DPMM, 0, 0, DPMM, 0, 0);
  const img = art[panelName];
  if (img) drawCover(ctx, img, 0, 0, CASE.panelW + bleed, CASE.panelH + bleed, 1, 0, 0);
  return cv;
}

export const DEFAULT_SPECS = [
  { icon: "player", label: "1 Player" },
  { icon: "download", label: "Digital" },
  { icon: "pad", label: "Controller" },
  { icon: "hd", label: "4K HDR" },
];

export const DEFAULT_CFG = {
  ...CASE,
  layout: "ps5",          // ps5 = white band + white bottom block, ps4 = accent band + black block
  platform: "PS5",
  title: "",
  subtitle: "",
  tagline: "",
  ribbon: "",
  edition: "Standard Edition",
  spineText: "",
  blurb: "",
  features: "",
  specs: DEFAULT_SPECS,
  publisher: "",
  mark: "",               // your monogram, printed on spine, front and back
  legal:
    "Custom cover produced for personal use. Not an official product and not for sale. " +
    "All trademarks and artwork are the property of their respective owners. Game data by RAWG.io.",
  address: "Personal archive copy\nPrinted at home",
  rating: "16",
  titleFont: "condensed",
  titleSize: 15,
  titleAnchor: "top",
  titleAlign: "left",
  base: "#0C1220",
  accent: "#1B3A93",
  spineColor: "#12172A",
  zoom: 1,
  offX: 0,
  offY: 0,
};
