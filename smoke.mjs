#!/usr/bin/env node
/* Offline check: renders one cover from a synthetic image.
   No network, no API keys. Run this before touching any API.
     node smoke.mjs  ->  out/smoke.png */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { renderScene, DEFAULT_CFG, DPMM, CASE } from "./lib/render.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "out");
const BLEED = 3;

// A stand-in for cover art: 1512x1748, the exact size the panel wants at 300 DPI.
function fakeArt() {
  const c = createCanvas(1512, 1748);
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 1512, 1748);
  grad.addColorStop(0, "#1B3A93");
  grad.addColorStop(0.6, "#8C2B14");
  grad.addColorStop(1, "#0C1220");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1512, 1748);
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 3;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.arc(756, 700, 60 + i * 55, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}

const cfg = {
  ...DEFAULT_CFG,
  ...CASE,
  platform: "PS5",
  title: "Smoke Test",
  subtitle: "if you can read this, the renderer works",
  edition: "Standard Edition",
  spineText: "Smoke Test",
  blurb:
    "This cover was rendered with no network and no API keys. If the text below wraps cleanly, the fonts resolved. If the three grey boxes appear above, screenshot placement works. If the spine text runs down the middle band, the rotation transform is fine.",
  features: "Renderer OK\nFonts resolved\nBleed applied\nCrop marks drawn",
  publisher: "Coverpress",
  rating: "16",
};

const art = { front: fakeArt(), back: null, shots: [] };
const wrapW = cfg.panelW * 2 + cfg.spine;

const cv = createCanvas(
  Math.round((wrapW + BLEED * 2) * DPMM),
  Math.round((cfg.panelH + BLEED * 2) * DPMM)
);
const ctx = cv.getContext("2d");
ctx.setTransform(DPMM, 0, 0, DPMM, BLEED * DPMM, BLEED * DPMM);
renderScene(ctx, cfg, art, { bleed: BLEED, cropMarks: true });

// Does the condensed title font actually exist, or did it silently fall back?
ctx.font = `700 15px "Arial Narrow", sans-serif`;
const narrow = ctx.measureText("HHHHHHHHHH").width;
ctx.font = `700 15px sans-serif`;
const plain = ctx.measureText("HHHHHHHHHH").width;

await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, "smoke.png"), cv.toBuffer("image/png"));

console.log(`
  wrote     out/smoke.png
  canvas    ${cv.width} x ${cv.height} px
  expected  ${Math.round((wrapW + BLEED * 2) * DPMM)} x ${Math.round((cfg.panelH + BLEED * 2) * DPMM)} px
  trim      ${wrapW} x ${cfg.panelH} mm  (+${BLEED}mm bleed each side)
  fonts     condensed face ${narrow < plain * 0.95 ? "resolved" : "NOT found — titles will be wider than designed"}
`);
