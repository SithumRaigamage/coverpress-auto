/* Data sources.

   RAWG        - 20k requests/month, key as a query param, attribution required.
   SteamGridDB - free key, portrait 600x900 grids.
   LLM         - either OpenRouter (:free models, 20 req/min, 50/day unfunded or
                 1000/day after a one-time $10 purchase) or Gemini's free Flash tier.
                 Text and vision only. Neither provider generates images here:
                 Gemini's image API has no free tier, and Nano Banana 2 via AI Plus
                 is app-only. Custom art comes in through the art/ folder instead. */

const RAWG = "https://api.rawg.io/api";
const SGDB = "https://www.steamgriddb.com/api/v2";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER = "https://openrouter.ai/api/v1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsonFetch(url, opts = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, opts);
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * (i + 1));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText} - ${url.split("?")[0]} ${body.slice(0, 160)}`);
    }
    return res.json();
  }
  throw new Error(`gave up after ${tries} tries - ${url.split("?")[0]}`);
}

const parseJson = (text) => {
  try {
    return JSON.parse(String(text).replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
};

/* ---------------------------------------------------------------- RAWG */

const PLATFORM_IDS = { PS4: 18, PS5: 187 };

export async function rawgLookup(title, platform, key) {
  const q = new URLSearchParams({
    key,
    search: title,
    search_precise: "true",
    page_size: "5",
    platforms: String(PLATFORM_IDS[platform] ?? PLATFORM_IDS.PS5),
  });
  const list = await jsonFetch(`${RAWG}/games?${q}`);
  if (!list.results?.length) return null;

  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hit = list.results.find((g) => norm(g.name) === norm(title)) || list.results[0];

  const detail = await jsonFetch(`${RAWG}/games/${hit.id}?key=${key}`);
  const shots = await jsonFetch(`${RAWG}/games/${hit.id}/screenshots?key=${key}`).catch(() => ({ results: [] }));

  return {
    id: hit.id,
    name: detail.name,
    slug: detail.slug,
    exactMatch: norm(detail.name) === norm(title),
    released: detail.released,
    description: (detail.description_raw || "").trim(),
    publisher: detail.publishers?.[0]?.name || detail.developers?.[0]?.name || "",
    genres: (detail.genres || []).map((g) => g.name),
    tags: (detail.tags || []).slice(0, 8).map((t) => t.name),
    rating: mapEsrb(detail.esrb_rating?.name),
    metacritic: detail.metacritic,
    heroUrl: detail.background_image_additional || detail.background_image || null,
    shotUrls: (shots.results || []).slice(0, 3).map((s) => s.image),
  };
}

function mapEsrb(name) {
  return { "Everyone": "E", "Everyone 10+": "10", "Teen": "13", "Mature": "18", "Adults Only": "18" }[name] || "16";
}

/* --------------------------------------------------------- SteamGridDB */

export async function sgdbCover(title, key) {
  if (!key) return null;
  const h = { headers: { Authorization: `Bearer ${key}` } };
  const search = await jsonFetch(`${SGDB}/search/autocomplete/${encodeURIComponent(title)}`, h).catch(() => null);
  const game = search?.data?.[0];
  if (!game) return null;
  const grids = await jsonFetch(
    `${SGDB}/grids/game/${game.id}?dimensions=600x900,660x930&types=static&limit=5`,
    h
  ).catch(() => null);
  const best = grids?.data?.sort((a, b) => b.width - a.width)[0];
  return best ? { url: best.url, width: best.width, height: best.height } : null;
}

/* ------------------------------------------------- LLM provider layer */

/** parts: [{text}] and/or [{image: Buffer}]. Returns raw text. */
async function chat(parts, { provider, model, key, temperature = 0.6 }) {
  if (!key) return null;

  if (provider === "openrouter") {
    const content = parts.map((p) =>
      p.image
        ? { type: "image_url", image_url: { url: `data:image/png;base64,${p.image.toString("base64")}` } }
        : { type: "text", text: p.text }
    );
    const out = await jsonFetch(`${OPENROUTER}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localhost/coverpress",
        "X-Title": "Coverpress",
      },
      body: JSON.stringify({ model, temperature, messages: [{ role: "user", content }] }),
    });
    return out.choices?.[0]?.message?.content || "";
  }

  const gParts = parts.map((p) =>
    p.image ? { inline_data: { mime_type: "image/png", data: p.image.toString("base64") } } : { text: p.text }
  );
  const out = await jsonFetch(`${GEMINI}/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: gParts }],
      generationConfig: { temperature, responseMimeType: "application/json" },
    }),
  });
  return out.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
}

/** Which :free models exist right now, and which take images. The free list rotates. */
export async function listFreeModels(key) {
  const out = await jsonFetch(`${OPENROUTER}/models`, key ? { headers: { Authorization: `Bearer ${key}` } } : {});
  return (out.data || [])
    .filter((m) => m.id.endsWith(":free"))
    .map((m) => ({
      id: m.id,
      name: m.name,
      vision: (m.architecture?.input_modalities || []).includes("image"),
      context: m.context_length,
    }))
    .sort((a, b) => Number(b.vision) - Number(a.vision) || (b.context || 0) - (a.context || 0));
}

/* --------------------------------------------------------- LLM tasks */

export async function llmCopy(meta, opts) {
  const text = await chat(
    [
      {
        text: `Write back-cover copy for a game case insert.

Game: ${meta.name}
Genres: ${meta.genres.join(", ") || "unknown"}
Released: ${meta.released || "unknown"}
Source description: ${(meta.description || "").slice(0, 1200)}

Return ONLY minified JSON, no markdown fences:
{"blurb":"70-90 words, present tense, second person, no marketing superlatives","features":["4 short lines, max 6 words each"],"tagline":"under 8 words"}`,
      },
    ],
    { ...opts, temperature: 0.7 }
  );
  return parseJson(text);
}

export async function llmReview(pngBuffer, title, opts) {
  const text = await chat(
    [
      { image: pngBuffer },
      {
        text: `This is a printed game case front cover for "${title}".
Judge only what you can see. Return ONLY minified JSON:
{"titleLegible":bool,"titleClipped":bool,"subjectCropped":bool,"lowContrast":bool,"issues":["short strings"],"score":0-100}`,
      },
    ],
    { ...opts, temperature: 0.1 }
  );
  return parseJson(text);
}

/** An image prompt to paste into the Gemini app / Google Flow. */
export async function llmArtPrompt(meta, opts) {
  const brief = `Write an image-generation prompt for ORIGINAL cover art for a physical game case.

Game: ${meta.name}
Genres: ${meta.genres.join(", ")}
Themes: ${(meta.tags || []).join(", ")}
Description: ${(meta.description || "").slice(0, 700)}

Rules for the prompt you write:
- Original artwork evoking the game's mood, setting and palette. Never name or describe
  specific copyrighted characters, logos, or an existing official cover.
- Portrait 3:4 composition. Subject in the central 80%.
- Bottom third visually calm and uncluttered - printed title text goes there.
- No text, no lettering, no watermarks in the image.
- Describe medium, lighting, palette and composition concretely. 60-90 words.

Return ONLY minified JSON: {"prompt":"...","palette":"3-4 colour words","accentHex":"#RRGGBB"}`;

  const out = parseJson(await chat([{ text: brief }], { ...opts, temperature: 0.8 }).catch(() => null));
  if (out?.prompt) return out;

  return {
    prompt: `Original ${meta.genres.join(" and ").toLowerCase() || "video game"} cover illustration evoking ${meta.name}: ${(meta.tags || []).slice(0, 4).join(", ")}. Portrait 3:4. Single striking focal subject in the upper two-thirds, dramatic directional lighting, painterly detail. Bottom third calm and low-detail for title text. No text, no lettering, no logos, no watermarks.`,
    palette: "",
    accentHex: "",
  };
}

export async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
