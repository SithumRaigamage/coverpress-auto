/* Cover renderer. All drawing is in millimetres; the caller scales the context.
   Works with any Canvas 2D context (@napi-rs/canvas in Node, HTMLCanvas in a browser). */

export const DPMM = 300 / 25.4; // 11.811 px per mm at 300 DPI

export const CASE = { panelW: 128, panelH: 148, spine: 14 };

export const FONTS = {
  condensed: '"Arial Narrow", "Liberation Sans Narrow", Impact, sans-serif',
  grotesk: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif',
  serif: 'Georgia, "Liberation Serif", "Times New Roman", serif',
  slab: '"Courier New", "Liberation Mono", monospace',
};

const dim = (img) => ({
  w: img.naturalWidth || img.width,
  h: img.naturalHeight || img.height,
});

export function drawCover(ctx, img, x, y, w, h, zoom = 1, offX = 0, offY = 0) {
  if (!img) return;
  const { w: iw, h: ih } = dim(img);
  const ir = iw / ih;
  let dw, dh;
  if (ir > w / h) {
    dh = h * zoom;
    dw = dh * ir;
  } else {
    dw = w * zoom;
    dh = dw / ir;
  }
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
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = word;
      } else line = test;
    });
    if (line) out.push(line);
  });
  return out;
}

function fitText(ctx, text, maxW, maxLines, startSize, family, minSize = 5) {
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
  for (let i = 0; i < (str || "x").length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function drawBarcode(ctx, x, y, w, h, seedStr) {
  let seed = hash(seedStr);
  const rnd = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507)) >>> 9) / 8388608;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#000000";
  let cx = x + 1.2;
  while (cx < x + w - 1.2) {
    const bw = 0.22 + rnd() * 0.42;
    if (rnd() > 0.38) ctx.fillRect(cx, y + 1, bw, h - 3.4);
    cx += bw + 0.24;
  }
  ctx.font = `1.8px ${FONTS.slab}`;
  ctx.textAlign = "center";
  ctx.fillText(String(hash(seedStr)).padStart(10, "0").slice(0, 10), x + w / 2, y + h - 0.6);
  ctx.textAlign = "left";
}

/* --- panels -------------------------------------------------------- */

function drawFront(ctx, cfg, art, r, bleed) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x - bleed, -bleed, r.w + bleed * 2, r.h + bleed * 2);
  ctx.clip();

  if (art.front) {
    drawCover(ctx, art.front, r.x - bleed, -bleed, r.w + bleed * 2, r.h + bleed * 2, cfg.zoom, cfg.offX, cfg.offY);
  } else {
    ctx.fillStyle = cfg.base;
    ctx.fillRect(r.x - bleed, -bleed, r.w + bleed * 2, r.h + bleed * 2);
  }

  const pad = 8;
  const g = ctx.createLinearGradient(0, r.h - 62, 0, r.h + bleed);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.55, "rgba(0,0,0,0.62)");
  g.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = g;
  ctx.fillRect(r.x - bleed, r.h - 62, r.w + bleed * 2, 62 + bleed);

  if (cfg.style === "plate") {
    ctx.fillStyle = cfg.accent;
    ctx.fillRect(r.x - bleed, r.h - 30, r.w + bleed * 2, 30 + bleed);
  }

  if (cfg.style === "retail") {
    ctx.fillStyle = cfg.accent;
    ctx.fillRect(r.x - bleed, -bleed, r.w + bleed * 2, 11 + bleed);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 5.4px ${FONTS.grotesk}`;
    ctx.textBaseline = "middle";
    ctx.fillText(cfg.platform, r.x + pad, 5.8);
    ctx.font = `400 3px ${FONTS.grotesk}`;
    ctx.textAlign = "right";
    ctx.fillText(cfg.edition || "", r.x + r.w - pad, 5.9);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  const fam = FONTS[cfg.titleFont] || FONTS.condensed;
  const baseY = cfg.style === "plate" ? r.h - 12 : r.h - 16;
  const fit = fitText(ctx, cfg.title || "Untitled", r.w - pad * 2, 3, cfg.titleSize, fam);
  ctx.fillStyle = "#FFFFFF";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 2;
  fit.lines.forEach((ln, i) => {
    ctx.font = `700 ${fit.size}px ${fam}`;
    ctx.fillText(ln, r.x + pad, baseY - (fit.lines.length - 1 - i) * fit.size * 1.02);
  });
  ctx.shadowBlur = 0;

  if (cfg.subtitle) {
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.font = `400 3.4px ${FONTS.grotesk}`;
    ctx.fillText(cfg.subtitle, r.x + pad, baseY + 5.4);
  }
  ctx.restore();
}

function drawSpine(ctx, cfg, r) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, -0.01, r.w, r.h);
  ctx.clip();
  ctx.fillStyle = cfg.accent;
  ctx.fillRect(r.x, -4, r.w, r.h + 8);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(r.x, 0, r.w, 16);

  ctx.save();
  ctx.translate(r.x + r.w / 2, 8);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 3.4px ${FONTS.grotesk}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(cfg.platform, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(r.x + r.w / 2, 22);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const text = cfg.spineText || cfg.title || "";
  const fam = FONTS[cfg.titleFont] || FONTS.condensed;
  let ss = 5;
  ctx.font = `700 ${ss}px ${fam}`;
  while (ctx.measureText(text).width > r.h - 30 && ss > 2.2) {
    ss -= 0.2;
    ctx.font = `700 ${ss}px ${fam}`;
  }
  ctx.fillText(text, 0, 0);
  ctx.restore();
  ctx.restore();
}

function drawBack(ctx, cfg, art, r, bleed) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-bleed, -bleed, r.w + bleed, r.h + bleed * 2);
  ctx.clip();

  const src = art.back || art.front;
  if (src) {
    drawCover(ctx, src, -bleed, -bleed, r.w + bleed * 2, r.h + bleed * 2, 1.1);
    ctx.fillStyle = "rgba(8,10,16,0.80)";
    ctx.fillRect(-bleed, -bleed, r.w + bleed * 2, r.h + bleed * 2);
  } else {
    ctx.fillStyle = cfg.base;
    ctx.fillRect(-bleed, -bleed, r.w + bleed * 2, r.h + bleed * 2);
  }

  const pad = 9;
  const innerW = r.w - pad * 2;
  const shots = (art.shots || []).filter(Boolean).slice(0, 3);
  let y = 12;

  if (shots.length) {
    const gap = 2;
    const sw = (innerW - gap * (shots.length - 1)) / shots.length;
    const sh = sw * 0.5625;
    shots.forEach((s, i) => {
      const x = pad + i * (sw + gap);
      drawCover(ctx, s, x, y, sw, sh);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 0.25;
      ctx.strokeRect(x, y, sw, sh);
    });
    y += sh + 8;
  } else y = 16;

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `400 3.1px ${FONTS.grotesk}`;
  const lines = wrapLines(ctx, cfg.blurb, innerW).slice(0, 13);
  lines.forEach((ln, i) => ctx.fillText(ln, pad, y + i * 4.3));
  y += lines.length * 4.3 + 6;

  (cfg.features || "")
    .split("\n")
    .filter((f) => f.trim())
    .slice(0, 4)
    .forEach((f, i) => {
      const fy = y + i * 4.6;
      ctx.fillStyle = cfg.accent;
      ctx.fillRect(pad, fy - 2.2, 1.4, 2.6);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = `700 3.1px ${FONTS.grotesk}`;
      ctx.fillText(f.trim(), pad + 3.4, fy);
    });

  const barH = 30;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(-bleed, r.h - barH, r.w + bleed, barH + bleed);

  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 0.4;
  ctx.strokeRect(pad, r.h - barH + 5, 13, 17);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 6px ${FONTS.grotesk}`;
  ctx.textAlign = "center";
  ctx.fillText(cfg.rating || "—", pad + 6.5, r.h - barH + 15);
  ctx.font = `400 2px ${FONTS.grotesk}`;
  ctx.fillText("RATING", pad + 6.5, r.h - barH + 20);
  ctx.textAlign = "left";

  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = `400 2.6px ${FONTS.grotesk}`;
  ctx.fillText(cfg.publisher || "", pad + 17, r.h - barH + 10);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = `400 2.1px ${FONTS.grotesk}`;
  ctx.fillText("Custom cover · personal collection · not for resale", pad + 17, r.h - barH + 15);
  ctx.fillText("Game data by RAWG.io", pad + 17, r.h - barH + 19);

  drawBarcode(ctx, r.w - pad - 30, r.h - barH + 5, 30, 17, cfg.title + cfg.platform);
  ctx.restore();
}

function drawCropMarks(ctx, w, h, bleed) {
  ctx.save();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 0.2;
  const L = bleed * 0.8;
  [
    [0, 0, -1, -1],
    [w, 0, 1, -1],
    [0, h, -1, 1],
    [w, h, 1, 1],
  ].forEach(([x, y, sx, sy]) => {
    ctx.beginPath();
    ctx.moveTo(x + sx * (bleed - L), y);
    ctx.lineTo(x + sx * bleed, y);
    ctx.moveTo(x, y + sy * (bleed - L));
    ctx.lineTo(x, y + sy * bleed);
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

export const DEFAULT_CFG = {
  ...CASE,
  platform: "PS5",
  title: "",
  subtitle: "",
  edition: "Standard Edition",
  spineText: "",
  blurb: "",
  features: "",
  publisher: "",
  rating: "16",
  style: "retail",
  titleFont: "condensed",
  titleSize: 15,
  base: "#0C1220",
  accent: "#1B3A93",
  zoom: 1,
  offX: 0,
  offY: 0,
};
