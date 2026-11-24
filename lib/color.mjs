/* Band colour sampled from cover art.

   A variant's top band takes its colour from the front art so each version
   looks like it belongs to its picture. The pick is the average of the most
   saturated pixels, then clamped to a mid-dark lightness: the PS4 layout prints
   white text on the band, so it must stay dark enough to read. */

import { createCanvas, loadImage } from "@napi-rs/canvas";

const SIZE = 32;

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

/** Accent hex for an image file or buffer; `fallback` when it cannot be read. */
export async function sampleAccent(source, fallback = "#1B3A93") {
  let img;
  try {
    img = await loadImage(source);
  } catch {
    return fallback;
  }
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const px = [];
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (l > 0.08 && l < 0.92) px.push({ h, s, l, r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  if (!px.length) return fallback;
  px.sort((a, b) => b.s - a.s);
  const top = px.slice(0, Math.max(8, Math.round(px.length * 0.15)));
  const avg = (k) => top.reduce((sum, p) => sum + p[k], 0) / top.length;
  const [h, s] = rgbToHsl(avg("r"), avg("g"), avg("b"));
  if (s < 0.12) return fallback; // a grey picture: keep the house accent
  return hslToHex(h, Math.min(0.75, Math.max(0.35, s)), 0.34);
}
