/* LLM provider checks. Ollama is local, so no real model is needed: the HTTP
   boundary is stubbed and the settings routes are exercised against the API. */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { llmCopy, llmReview, listOllamaModels } from "../lib/sources.mjs";
import { boot, getJson, put } from "./helpers.mjs";

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

const stub = (payload) => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  return calls;
};

test("llmCopy talks to Ollama's chat endpoint in JSON mode", async () => {
  const calls = stub({ message: { content: JSON.stringify({ blurb: "A blurb", features: ["One"], tagline: "Tag" }) } });
  const copy = await llmCopy(
    { name: "Elden Ring", genres: ["RPG"], released: "2022-02-25", description: "An open world." },
    { provider: "ollama", host: "http://ollama.test:11434/", model: "llama3.2" }
  );
  assert.equal(copy.tagline, "Tag");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://ollama.test:11434/api/chat");

  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.model, "llama3.2");
  assert.equal(body.stream, false);
  assert.equal(body.format, "json");
  assert.match(body.messages[0].content, /Elden Ring/);
});

test("vision review sends base64 images to Ollama", async () => {
  const calls = stub({ message: { content: '{"titleLegible":true,"score":91,"issues":[]}' } });
  const review = await llmReview(Buffer.from([1, 2, 3]), "Test Game", {
    provider: "ollama", host: "http://ollama.test:11434", model: "llava",
  });
  assert.equal(review.score, 91);
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body.messages[0].images, ["AQID"]);
  assert.match(body.messages[0].content, /Test Game/);
});

test("installed Ollama models are parsed from /api/tags", async () => {
  stub({ models: [{ name: "llama3.2:latest" }, { name: "llava:latest" }] });
  const models = await listOllamaModels("http://ollama.test:11434");
  assert.deepEqual(models.map((m) => m.id), ["llama3.2:latest", "llava:latest"]);
  assert.equal(models[0].vision, false);
  assert.equal(models[1].vision, true);
});

/* ------------------------------------------------- settings routes (real API) */

globalThis.fetch = realFetch;
const server = await boot();
after(() => server.stop());
const url = server.url;

test("settings expose Ollama defaults without leaking a key", async () => {
  await put(url, "/api/settings/keys", { name: "openrouter", value: "sk-should-never-appear" });
  const { res, body } = await getJson(url, "/api/settings/llm");
  assert.equal(res.status, 200);
  assert.equal(body.provider, "ollama");
  assert.match(body.ollama.host, /11434/);
  assert.equal(body.openrouter.configured, true);
  assert.equal(JSON.stringify(body).includes("sk-should-never-appear"), false);
});

test("LLM settings are validated, scoped and persisted", async () => {
  const good = await put(url, "/api/settings/llm", {
    provider: "ollama",
    ollama: { host: "http://127.0.0.1:11434", textModel: "qwen2.5", visionModel: "llava" },
  });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).ollama.textModel, "qwen2.5");

  const bad = await put(url, "/api/settings/llm", { provider: "sgdb" });
  assert.equal(bad.status, 400);

  const badHost = await put(url, "/api/settings/llm", { ollama: { host: "file:///etc/passwd" } });
  assert.equal(badHost.status, 400);

  const row = server.app.db.prepare("SELECT value FROM settings WHERE key = 'ollamaTextModel'").get();
  assert.equal(row.value, "qwen2.5");
});
