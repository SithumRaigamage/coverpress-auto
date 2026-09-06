/* Data sources.

   RAWG        - 20k requests/month, key as a query param, attribution required.
   SteamGridDB - free key, portrait 600x900 grids.
   LLM         - OpenRouter (:free models, 20 req/min, 50/day unfunded or
                 1000/day after a one-time $10 purchase). Text and vision only.
                 Neither provider generates images here: Gemini's image API has no
                 free tier, and Nano Banana 2 via AI Plus is app-only. Custom art
                 comes in through the art/ folder instead. */

const RAWG = "https://api.rawg.io/api";
const SGDB = "https://www.steamgriddb.com/api/v2";
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

/** parts: [{text}] and/or [{image: Buffer}]. Returns raw text via OpenRouter. */
async function chat(parts, { model, key, temperature = 0.6 }) {
  if (!key) return null;

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

/**
 * Generate image prompts for a game's cover artwork.
 * Returns prompts for: front cover, back panel background, and 3 gameplay screenshots.
 * Each prompt includes exact dimensions for print-ready 300 DPI output.
 */
export async function llmArtPrompt(meta, opts) {
  const brief = `Write 5 image-generation prompts for a physical PS4/PS5 game case cover.

Game: ${meta.name}
Genres: ${meta.genres.join(", ")}
Themes: ${(meta.tags || []).join(", ")}
Description: ${(meta.description || "").slice(0, 800)}

Return ONLY a JSON array (5 objects). No markdown fences, no commentary. Each object has
a "prompt" field — the actual image prompt, written in 70-100 words for the front and
back, 30-50 words for each shot. Be specific: subject, composition, lighting, palette,
medium. NEVER name copyrighted characters, real brand logos, or recreate official covers.

Slot 1 — front cover (REQUIRED)
  - Full front panel of a game case. Subject fills the upper 2/3.
  - Bottom 1/3 calm, dark, and uncluttered — printed title goes on top.
  - Portrait 3:4. Painterly or stylised. 70-100 words.
  - Include "palette" (3-4 colour words) and "accentHex" ("#RRGGBB").

Slot 2 — back panel background (OPTIONAL)
  - Dark, moody, low-detail. 80% of this panel is overlaid with text and screenshots.
  - Portrait 3:4. 40-60 words.
  - Include "palette" and "accentHex".

Slots 3-5 — three gameplay screenshots (REQUIRED, vary the framing)
  - Each 721×406 px, 16:9 landscape, no UI, no text, no watermarks.
  - shot 1: wide establishing, shot 2: medium action, shot 3: close detail.
  - 30-50 words each. No palette/accent fields needed.

Shape of the response (fill the prompts in, this is the schema):
[
  { "slot": "front", "prompt": "...", "palette": "...", "accentHex": "#RRGGBB" },
  { "slot": "back",  "prompt": "...", "palette": "...", "accentHex": "#RRGGBB" },
  { "slot": "shot",  "prompt": "..." },
  { "slot": "shot",  "prompt": "..." },
  { "slot": "shot",  "prompt": "..." }
]`;

  try {
    const raw = await chat([{ text: brief }], { ...opts, temperature: 0.8 });
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

    const bySlot = (s) => parsed.find((p) => p.slot === s);
    const firstShot = parsed.filter((p) => p.slot === "shot");

    return {
      front: {
        prompt: bySlot("front")?.prompt || fallbackPrompt(meta, "front"),
        palette: bySlot("front")?.palette || "",
        accentHex: bySlot("front")?.accentHex || "",
      },
      back: {
        prompt: bySlot("back")?.prompt || "",
        palette: bySlot("back")?.palette || "",
        accentHex: bySlot("back")?.accentHex || "",
      },
      shots: firstShot.map((p, i) => p.prompt || fallbackPrompt(meta, "shot", i)),
    };
  } catch {
    // Fallback prompts if the LLM returns malformed JSON
    return {
      front: { prompt: fallbackPrompt(meta, "front"), palette: "", accentHex: "" },
      back:  { prompt: fallbackPrompt(meta, "back"),  palette: "", accentHex: "" },
      shots: [0, 1, 2].map((i) => fallbackPrompt(meta, "shot", i)),
    };
  }
}

function fallbackPrompt(meta, slot, idx = 0) {
  const themes = (meta.tags || []).slice(0, 4).join(", ");
  if (slot === "front") {
    return `Original cover illustration for ${meta.name}. ${meta.genres.join(" and ").toLowerCase()} game. Evoking: ${themes}. Portrait 3:4, 1512×1748 px at 300 DPI. Subject in upper 2/3, bottom 1/3 calm and dark for printed title. Dramatic directional lighting, painterly detail. No text, no lettering, no logos, no watermarks.`;
  }
  if (slot === "back") {
    return `Atmospheric abstract background for a game case back panel. Dark, moody, low-detail texture. ${meta.genres.join(", ").toLowerCase()} mood. Works behind white text and game screenshots. No recognisable characters. 1512×1748 px at 300 DPI.`;
  }
  const scenes = [
    `Wide establishing shot of ${meta.name} — a sweeping environmental scene. 721×406 px, 16:9, no UI, no text.`,
    `Medium action shot from ${meta.name} — the core gameplay moment. 721×406 px, 16:9, no UI, no text.`,
    `Close detail from ${meta.name} — an atmospheric close-up. 721×406 px, 16:9, no UI, no text.`,
  ];
  return scenes[idx] || scenes[0];
}

export async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
