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
