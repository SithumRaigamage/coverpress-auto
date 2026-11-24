/* RAWG catalog browser checks. The HTTP boundary is stubbed so the search
   route can be exercised without a real key or network access. */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { boot, getJson, put } from "./helpers.mjs";

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

const server = await boot();
after(() => server.stop());
const url = server.url;

/** Intercept only RAWG traffic; let the harness's own API calls through. */
const stubRawg = (payload) => {
  const calls = [];
  globalThis.fetch = (input, init) => {
    const target = String(input);
    if (target.startsWith("https://api.rawg.io/")) {
      calls.push({ target, init });
      return Promise.resolve(
        new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
      );
    }
    return realFetch(input, init);
  };
  return calls;
};

test("RAWG search rejects a missing query", async () => {
  const { res, body } = await getJson(url, "/api/rawg/search");
  assert.equal(res.status, 400);
  assert.match(body.error, /required/i);
});

test("RAWG search without a key explains how to configure one", async () => {
  const { res, body } = await getJson(url, "/api/rawg/search?q=elden%20ring");
  assert.equal(res.status, 400);
  assert.match(body.error, /RAWG API key/);
});

test("RAWG search returns simplified games using the stored key and platform filter", async () => {
  await put(url, "/api/settings/keys", { name: "rawg", value: "test-rawg-key" });

  const calls = stubRawg({
    results: [
      {
        id: 1,
        slug: "elden-ring",
        name: "Elden Ring",
        released: "2022-02-25",
        esrb_rating: { name: "Mature" },
        metacritic: 96,
        background_image: "https://images.test/elden.jpg",
        platforms: [{ platform: { name: "PlayStation 5" } }, { platform: { name: "PC" } }],
      },
      {
        id: 2,
        slug: "celeste",
        name: "Celeste",
        released: "2018-01-25",
        esrb_rating: { name: "Everyone" },
        metacritic: 92,
        background_image: null,
        platforms: [{ platform: { name: "PlayStation 4" } }],
      },
    ],
  });

  const { res, body } = await getJson(url, "/api/rawg/search?q=elden&platform=PS5");
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.count, 2);
  assert.equal(body.games[0].name, "Elden Ring");
  assert.equal(body.games[0].rating, "18");
  assert.equal(body.games[0].backgroundImage, "https://images.test/elden.jpg");
  assert.deepEqual(body.games[0].platforms, ["PlayStation 5", "PC"]);
  assert.equal(body.games[1].backgroundImage, null);

  assert.equal(calls.length, 1, "one catalog request per search");
  const called = new URL(calls[0].target);
  assert.equal(called.searchParams.get("search"), "elden");
  assert.equal(called.searchParams.get("platforms"), "187");
  assert.equal(called.searchParams.get("key"), "test-rawg-key");
});
