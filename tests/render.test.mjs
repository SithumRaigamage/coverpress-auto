import { test } from "node:test";
import assert from "node:assert/strict";
import { coverCfg, sanitizeOverrides } from "../lib/cover.mjs";
import { DEFAULT_CFG } from "../lib/render.mjs";

const meta = {
  name: "Elden Ring",
  released: "2022-02-25",
  genres: ["RPG", "Action"],
  description: "An open world RPG.\nSecond paragraph.",
  publisher: "FromSoftware",
  rating: "18",
  metacritic: 96,
};

test("metadata alone is enough to fill every template slot", () => {
  const cfg = coverCfg({ meta, platform: "PS5" });
  assert.equal(cfg.title, "Elden Ring");
  assert.equal(cfg.layout, "ps5");
  assert.match(cfg.tagline, /RPG/);
  assert.match(cfg.features, /Released 2022/);
  assert.match(cfg.blurb, /open world/);
  assert.doesNotMatch(cfg.blurb, /Second paragraph/);
  assert.equal(cfg.publisher, "FromSoftware");
  assert.equal(cfg.panelW, 128);
  assert.equal(cfg.spine, 14);
});

test("copy from the language model wins over the fallbacks", () => {
  const cfg = coverCfg({
    meta,
    copy: { tagline: "Rise, Tarnished", blurb: "A blurb.", features: ["One", "Two"] },
    platform: "PS5",
  });
  assert.equal(cfg.tagline, "Rise, Tarnished");
  assert.equal(cfg.features, "One\nTwo");
});

test("PS4 gets the PS4 look unless the theme forces one", () => {
  assert.equal(coverCfg({ meta, platform: "PS4" }).layout, "ps4");
  assert.equal(coverCfg({ meta, platform: "PS4", theme: { layout: "ps5" } }).layout, "ps5");
  assert.equal(coverCfg({ meta, platform: "PS5", theme: { layout: "auto" } }).layout, "ps5");
});

test("theme values land in the config, and edition reaches the drawn subtitle", () => {
  const cfg = coverCfg({
    meta,
    platform: "PS5",
    theme: { accent: "#8C2B14", mark: "SR", address: "Archive", edition: "Deluxe Edition" },
  });
  assert.equal(cfg.accent, "#8C2B14");
  assert.equal(cfg.mark, "SR");
  assert.equal(cfg.address, "Archive");
  assert.equal(cfg.subtitle, "Deluxe Edition");
});

test("null metadata behaves like an empty record (manual covers)", () => {
  const cfg = coverCfg({ meta: null, platform: "PS5" });
  assert.equal(cfg.title, "");
  assert.equal(cfg.rating, DEFAULT_CFG.rating);
});

test("overrides are clamped and cannot touch print geometry", () => {
  const cleaned = sanitizeOverrides({
    zoom: 99,
    offX: -999,
    titleSize: "not a number",
    panelW: 1,
    spine: 0,
    base: "#fff",
    titleAnchor: "sideways",
    title: "A".repeat(400),
  });
  assert.equal(cleaned.zoom, 2.5);
  assert.equal(cleaned.offX, -30);
  assert.equal(cleaned.titleSize, undefined);
  assert.equal(cleaned.panelW, undefined);
  assert.equal(cleaned.spine, undefined);
  assert.equal(cleaned.base, undefined);
  assert.equal(cleaned.titleAnchor, undefined);
  assert.equal(cleaned.title.length, 200);

  const cfg = coverCfg({ meta, platform: "PS5", overrides: { spine: 0, panelW: 20, zoom: 1.2 } });
  assert.equal(cfg.spine, 14);
  assert.equal(cfg.panelW, 128);
  assert.equal(cfg.zoom, 1.2);
});

test("style is a whitelisted override: minimal drops the decoration, junk is ignored", () => {
  const meta = { name: "Style Test", genres: ["Action"], released: "2020-01-01", description: "A game." };
  const minimal = coverCfg({ meta, theme: { edition: "Deluxe" }, overrides: { style: "minimal", ribbon: "Bonus" } });
  assert.equal(minimal.style, "minimal");
  assert.equal(minimal.subtitle, "");
  assert.equal(minimal.ribbon, "");
  assert.equal(minimal.tagline, "");
  assert.equal(minimal.features, "");
  assert.ok(minimal.blurb, "the blurb stays");
  assert.equal(coverCfg({ meta, overrides: { style: "neon" } }).style, "standard");
});

test("art fit ranks a print-size portrait over a 16:9 screenshot", async () => {
  const { artFit } = await import("../lib/qc.mjs");
  assert.equal(artFit(1512, 1748).score, 100);
  assert.equal(artFit(1512, 1748).printReady, true);
  assert.ok(artFit(1024, 1536).score > artFit(1920, 1080).score);
  assert.equal(artFit(1920, 1080).printReady, false, "landscape is a heavy crop, as runChecks warns");
  assert.equal(artFit(0, 0).score, 0);
});

test("a bottom-anchored title never crosses the rating box", async () => {
  const { renderPanel, DPMM } = await import("../lib/render.mjs");
  // Render the front with and without the title. Wherever they differ is title
  // ink (title + edition line). The rating box is drawn on top, so it would hide
  // an overlap — compare the ink's bounding box to the box's rectangle instead.
  for (const subtitle of ["", "Standard Edition"]) {
    const base = coverCfg({ meta: { name: "Paper Comet", genres: [] }, overrides: { titleAnchor: "bottom", titleSize: 18 } });
    base.subtitle = subtitle;
    const panel = (cfg) => renderPanel("front", cfg, { front: null, shots: [] }).getContext("2d");
    const w = Math.round(128 * DPMM);
    const h = Math.round(148 * DPMM);
    const a = panel(base).getImageData(0, 0, w, h).data;
    const b = panel({ ...base, title: " ", subtitle: "" }).getImageData(0, 0, w, h).data;
    let maxY = -1;
    let minX = Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) {
          if (y > maxY) maxY = y;
          if (x < minX) minX = x;
        }
      }
    }
    const boxTop = (148 - 9 - 14) * DPMM; // rating box: PAD 9 mm from the foot, 14 mm tall
    assert.ok(minX < 20 * DPMM, "the title starts at the left margin, over the rating box column");
    assert.ok(maxY < boxTop, `title ink reaches ${(maxY / DPMM).toFixed(1)} mm; the rating box starts at ${boxTop / DPMM} mm (subtitle: "${subtitle}")`);
  }
});
