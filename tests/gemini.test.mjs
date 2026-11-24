/* AI-generated art (Gemini), fully stubbed: no key leaves the machine and no
   real image is generated. Checks the request, the panel fitting, the art grid,
   the error messages, and the optional pipeline step. */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadImage } from "@napi-rs/canvas";
import { boot, png, get, getJson, post, put } from "./helpers.mjs";
import { fitToPanel } from "../lib/gemini.mjs";

const realFetch = globalThis.fetch;
const gemini = [];
let geminiReply = () => ({
  status: 200,
  body: { candidates: [{ content: { parts: [{ text: "here you go" }, { inlineData: { mimeType: "image/png", data: png(864, 1184).toString("base64") } }] } }] },
});
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

globalThis.fetch = (input, init) => {
  const t = String(input);
  if (t.startsWith("https://generativelanguage.googleapis.com/")) {
    gemini.push({ url: t, init });
    const r = geminiReply();
    return Promise.resolve(json(r.body, r.status));
  }
  if (t.startsWith("https://api.rawg.io/")) {
    const p = new URL(t).pathname;
    if (p === "/api/games/55/screenshots") return Promise.resolve(json({ results: [{ id: 1, image: "https://img.test/s.jpg", width: 1280, height: 720 }] }));
    if (p === "/api/games/55") {
      return Promise.resolve(
        json({ id: 55, slug: "ai-game", name: "AI Game", released: "2024-01-01", description_raw: "A quiet harbour town at dusk. " + "More words. ".repeat(20), genres: [{ name: "Adventure" }], tags: [{ name: "Atmospheric" }], publishers: [{ name: "P" }], background_image: null, platforms: [] })
      );
    }
  }
  if (t === "https://img.test/s.jpg") return Promise.resolve(new Response(png(1280, 720)));
  return realFetch(input, init);
};

const saved = { RAWG_KEY: process.env.RAWG_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_GAP_MS: process.env.GEMINI_GAP_MS, VISION_REVIEW: process.env.VISION_REVIEW };
process.env.RAWG_KEY = "k";
process.env.GEMINI_GAP_MS = "0";
process.env.VISION_REVIEW = "false";
delete process.env.GEMINI_API_KEY;

const server = await boot();
const url = server.url;
after(async () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await server.stop();
});

test("without GEMINI_API_KEY, generating art is a clear 400 and nothing is called", async () => {
  const res = await post(url, "/api/games/55/ai-art", { prompt: "a harbour" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /GEMINI_API_KEY/);
  assert.equal(gemini.length, 0);
  const prompt = (await getJson(url, "/api/games/55/ai-prompt")).body;
  assert.equal(prompt.enabled, false);
  assert.equal(prompt.source, "rawg", "Ollama is down in tests, so the prompt is built from RAWG data");
  assert.match(prompt.prompt, /AI Game/);
});

test("the image is fitted to the 128 × 148 mm panel at 300 DPI", async () => {
  const fitted = await fitToPanel(png(864, 1184));
  assert.ok(fitted.width >= 1512 && fitted.height >= 1748, `${fitted.width}×${fitted.height}`);
  assert.ok(Math.abs(fitted.width / fitted.height - 128 / 148) < 0.002);
});

test("Generate art asks for 2 portrait images with the key in a header and the no-text/no-logo rules", async () => {
  process.env.GEMINI_API_KEY = "gem-key-secret";
  gemini.length = 0;
  const res = await post(url, "/api/games/55/ai-art", { prompt: "A lighthouse over a quiet harbour at dusk." });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  assert.equal(body.items.length, 2);
  assert.equal(gemini.length, 2);

  const call = gemini[0];
  assert.match(call.url, /models\/gemini-2\.5-flash-image:generateContent$/);
  assert.equal(call.url.includes("gem-key-secret"), false, "the key is never in the URL");
  assert.equal(call.init.headers["x-goog-api-key"], "gem-key-secret");
  const sent = JSON.parse(call.init.body);
  assert.equal(sent.generationConfig.imageConfig.aspectRatio, "3:4");
  const text = sent.contents[0].parts[0].text;
  assert.match(text, /lighthouse/);
  assert.match(text, /no text/i);
  assert.match(text, /logos/i);
  assert.match(text, /trademarks/i);

  const item = body.items[0];
  assert.equal(item.source, "AI");
  assert.ok(item.width >= 1512 && item.height >= 1748);
  assert.ok(item.fit >= 95, `fit ${item.fit}`);
  const img = await get(url, item.url);
  assert.equal(img.status, 200);
  assert.ok((await loadImage(Buffer.from(await img.arrayBuffer()))).width >= 1512);

  // The edit is saved as the game's prompt.
  assert.equal((await getJson(url, "/api/games/55/ai-prompt")).body.source, "user");
});

test("generated images join the Available art grid with an AI tag", async () => {
  const art = (await getJson(url, "/api/games/55/art")).body;
  assert.equal(art.counts.ai, 2);
  assert.equal(art.ai.enabled, true);
  assert.equal(art.items[0].source, "AI", "a print-size portrait ranks first");
  assert.equal(JSON.stringify(art).includes("gem-key-secret"), false);
});

test("a quota error is reported as such, and generated files cannot be path-traversed", async () => {
  geminiReply = () => ({ status: 429, body: { error: { message: "Resource exhausted" } } });
  const res = await post(url, "/api/games/55/ai-art", {});
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /quota/i);
  assert.equal((await get(url, "/api/generated/55/..%2F..%2Fcoverpress.sqlite")).status, 404);
  assert.equal((await get(url, "/api/generated/55/not-a-file.png")).status, 404);
});

test("with the Settings toggle on, the pipeline's AI step runs and can pick AI art", async () => {
  geminiReply = () => ({
    status: 200,
    body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png(864, 1184).toString("base64") } }] } }] },
  });
  assert.equal((await put(url, "/api/settings/pipeline", { aiArt: "yes" })).status, 400);
  const toggled = await put(url, "/api/settings/pipeline", { aiArt: true });
  assert.equal((await toggled.json()).pipeline.aiArt, true);
  assert.equal((await getJson(url, "/api/settings")).body.pipeline.aiArt, true);

  gemini.length = 0;
  const created = await (await post(url, "/api/games/55/covers", { platform: "PS5" })).json();
  await server.app.worker.drain();
  const run = (await getJson(url, `/api/covers/${created.cover.id}/run`)).body;
  const ai = run.run.steps.find((s) => s.key === "ai");
  assert.equal(ai.state, "done");
  assert.match(ai.detail, /cached AI image/, "images made on the game screen are reused, no new calls");
  assert.equal(gemini.length, 0);
  assert.equal(run.cover.front.source, "AI");

  // A variant asks Gemini for one fresh image.
  await post(url, `/api/covers/${created.cover.id}/retry`, {});
  await server.app.worker.drain();
  assert.equal(gemini.length, 1);
  await put(url, "/api/settings/pipeline", { aiArt: false });
});
