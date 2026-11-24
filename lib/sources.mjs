/* Data sources.

   RAWG        - 20k requests/month, key as a query param, attribution required.
   SteamGridDB - free key, portrait 600x900 grids. Personal use only: the CLI,
                 and the local web app only when SGDB_KEY is set in .env.
   LLM         - Ollama only (local, no key): llama3.2 writes copy and art
                 prompts, llava reviews the rendered front. When Ollama is down
                 every caller falls back to deterministic RAWG-derived text.
   Gemini      - image generation, server-side only, see lib/gemini.mjs. */

const RAWG = "https://api.rawg.io/api";
const SGDB = "https://www.steamgriddb.com/api/v2";

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

/** Strip year/parens/edition noise so "(2023)" and "Standard Edition" don't break exact match. */
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\(\d{4}\)/g, "")
    .replace(/\b(standard|deluxe|ultimate|remastered|remake|collection|edition)\b/gi, "")
    .replace(/[^a-z0-9]/g, "");

/** `onCall` lets the server count RAWG requests against the 20k/month free tier. */
const rawgGet = (path, key, onCall) => {
  onCall?.();
  const sep = path.includes("?") ? "&" : "?";
  return jsonFetch(`${RAWG}${path}${sep}key=${encodeURIComponent(key)}`);
};

/** The shape the renderer and QC read, from a RAWG detail + screenshots pair. */
function rawgMeta(detail, shots, query = "") {
  return {
    id: detail.id,
    name: detail.name,
    slug: detail.slug,
    exactMatch: query ? norm(detail.name) === norm(query) : true,
    released: detail.released,
    description: (detail.description_raw || "").trim(),
    publisher: detail.publishers?.[0]?.name || detail.developers?.[0]?.name || "",
    developer: detail.developers?.[0]?.name || detail.publishers?.[0]?.name || "",
    genres: (detail.genres || []).map((g) => g.name),
    tags: (detail.tags || []).slice(0, 8).map((t) => t.name),
    rating: mapEsrb(detail.esrb_rating?.name),
    metacritic: detail.metacritic,
    heroUrl: detail.background_image_additional || detail.background_image || null,
    shotUrls: (shots.results || []).slice(0, 3).map((s) => s.image),
  };
}

export async function rawgLookup(title, platform, key, { onCall } = {}) {
  const q = new URLSearchParams({
    search: title,
    search_precise: "true",
    page_size: "5",
    platforms: String(PLATFORM_IDS[platform] ?? PLATFORM_IDS.PS5),
  });
  const list = await rawgGet(`/games?${q}`, key, onCall);
  if (!list.results?.length) return null;
  const hit = list.results.find((g) => norm(g.name) === norm(title)) || list.results[0];
  const detail = await rawgGet(`/games/${hit.id}`, key, onCall);
  const shots = await rawgGet(`/games/${hit.id}/screenshots`, key, onCall).catch(() => ({ results: [] }));
  return rawgMeta(detail, shots, title);
}

/**
 * One RAWG game by id: the renderer's metadata plus every screenshot with its
 * pixel size, so art candidates can be scored without downloading them.
 */
export async function rawgGame(id, key, { onCall } = {}) {
  const detail = await rawgGet(`/games/${encodeURIComponent(id)}`, key, onCall);
  const shots = await rawgGet(`/games/${encodeURIComponent(id)}/screenshots?page_size=20`, key, onCall).catch(() => ({
    results: [],
  }));
  const meta = rawgMeta(detail, shots);
  return {
    meta,
    platforms: (detail.platforms || []).map((p) => p.platform?.name).filter(Boolean),
    background: detail.background_image || null,
    backgroundAdditional: detail.background_image_additional || null,
    screenshots: (shots.results || [])
      .filter((s) => s.image)
      .map((s) => ({ id: s.id, url: s.image, width: Number(s.width) || 0, height: Number(s.height) || 0 })),
  };
}

export const RAWG_ORDERING = new Set(["-added", "-released", "-metacritic", "-rating", "name"]);

/**
 * Browse or search RAWG for the game library. An empty query lists popular
 * PS5/PS4 games. Returns simplified results; full detail and screenshots are
 * fetched per game by rawgGame() when someone opens it.
 */
export async function rawgSearch(q, { platform, page = 1, pageSize = 20, genre, year, ordering, key, onCall } = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  const query = String(q || "").trim();
  if (query) params.set("search", query);
  params.set("platforms", platform && PLATFORM_IDS[platform] ? String(PLATFORM_IDS[platform]) : "187,18");
  if (genre) params.set("genres", String(genre));
  if (year && /^\d{4}$/.test(String(year))) params.set("dates", `${year}-01-01,${year}-12-31`);
  // RAWG ranks search hits by relevance; only impose an ordering when asked to,
  // or when browsing with no query (most popular first).
  if (ordering && RAWG_ORDERING.has(ordering)) params.set("ordering", ordering);
  else if (!query) params.set("ordering", "-added");
  const list = await rawgGet(`/games?${params}`, key, onCall);
  const games = (list.results || []).map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    released: g.released,
    year: g.released ? Number(String(g.released).slice(0, 4)) : null,
    genres: (g.genres || []).map((x) => x.name),
    rating: mapEsrb(g.esrb_rating?.name),
    metacritic: g.metacritic,
    backgroundImage: g.background_image || null,
    platforms: (g.platforms || []).map((p) => p.platform?.name).filter(Boolean),
    // RAWG lists the background as a pseudo-screenshot with id -1.
    screenshotCount: (g.short_screenshots || []).filter((s) => s.id !== -1).length,
  }));
  return { games, next: Boolean(list.next), total: Number(list.count) || games.length };
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

/**
 * Portrait grids and hero banners for a title. Personal use only (SteamGridDB's
 * terms): the server calls this only when SGDB_KEY is set in .env. Grids with a
 * white logo lockup are excluded — the renderer prints its own title.
 */
export async function sgdbArt(title, key) {
  if (!key) return { gameId: null, items: [] };
  const h = { headers: { Authorization: `Bearer ${key}` } };
  const search = await jsonFetch(`${SGDB}/search/autocomplete/${encodeURIComponent(title)}`, h).catch(() => null);
  const game = (search?.data || []).find((g) => norm(g.name) === norm(title)) || search?.data?.[0];
  if (!game) return { gameId: null, items: [] };
  const [grids, heroes] = await Promise.all([
    jsonFetch(
      `${SGDB}/grids/game/${game.id}?dimensions=600x900,660x930,342x482&styles=alternate,blurred,no_logo,material&types=static&nsfw=false&humor=false&limit=12`,
      h
    ).catch(() => null),
    jsonFetch(`${SGDB}/heroes/game/${game.id}?types=static&nsfw=false&humor=false&limit=6`, h).catch(() => null),
  ]);
  const map = (rows, kind) =>
    (rows?.data || [])
      .filter((r) => r.url)
      .map((r) => ({ id: r.id, url: r.url, thumb: r.thumb || r.url, width: Number(r.width) || 0, height: Number(r.height) || 0, kind }));
  return { gameId: game.id, items: [...map(grids, "portrait grid"), ...map(heroes, "hero banner")] };
}

/* ------------------------------------------------- LLM provider layer */

const OLLAMA_TIMEOUT = 6000;
const ollamaUrl = (host, path) => `${String(host || "http://127.0.0.1:11434").replace(/\/+$/, "")}${path}`;

/** Ollama's chat endpoint: no key, JSON mode, base64 images for vision models. */
async function ollamaChat(parts, { model, host, temperature = 0.6, seed }) {
  if (!model) return null;
  const images = parts.filter((p) => p.image).map((p) => p.image.toString("base64"));
  const content = parts.filter((p) => p.text).map((p) => p.text).join("\n\n");
  const out = await jsonFetch(
    ollamaUrl(host, "/api/chat"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature, ...(Number.isInteger(seed) ? { seed } : {}) },
        messages: [{ role: "user", content, ...(images.length ? { images } : {}) }],
      }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT),
    },
    1
  );
  return out.message?.content || "";
}

/** parts: [{text}] and/or [{image: Buffer}]. Returns raw text from Ollama. */
const chat = (parts, opts = {}) => ollamaChat(parts, opts);

/** Locally installed Ollama models. Vision support is inferred from the name,
   because /api/tags does not report input modalities in every Ollama release. */
export async function listOllamaModels(host) {
  const out = await jsonFetch(ollamaUrl(host, "/api/tags"), {
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT),
  }, 1);
  return (out.models || []).map((m) => ({
    id: m.name,
    name: m.name,
    vision: /vl|llava|vision|moondream|pixtral/i.test(m.name || ""),
    context: 0,
  }));
}

/** Installed models — used by `npm run models` and GET /api/settings/models. */
export async function listModels({ host } = {}) {
  return listOllamaModels(host);
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

${Number.isInteger(opts?.seed) && opts.seed > 0 ? `This is alternative version #${opts.seed + 1}: take a different angle and different wording from a typical summary.\n\n` : ""}Return ONLY minified JSON, no markdown fences:
{"blurb":"70-90 words, present tense, second person, no marketing superlatives","features":["4 short lines, max 6 words each"],"tagline":"under 8 words"}`,
      },
    ],
    { temperature: Number.isInteger(opts?.seed) && opts.seed > 0 ? 0.95 : 0.7, ...opts }
  );
  return parseJson(text);
}

/** Rules appended to every image prompt, whoever wrote the rest of it. */
export const ART_PROMPT_RULES =
  "Portrait orientation, 3:4. Original artwork. Absolutely no text, letters, numbers, titles, logos, watermarks, " +
  "trademarks, brand marks, rating badges or platform symbols. Keep the top third calm and darker so a printed title " +
  "stays readable. Print quality, sharp detail.";

/** A deterministic front-art prompt from RAWG metadata — the fallback when Ollama is down. */
export function fallbackArtPrompt(meta) {
  const genres = (meta.genres || []).join(" and ").toLowerCase() || "video";
  const themes = (meta.tags || []).slice(0, 4).join(", ");
  const story = firstSentence(meta.description);
  return `Key art illustration for a ${genres} game called ${meta.name}. ${story ? `${story} ` : ""}${themes ? `Mood and themes: ${themes}. ` : ""}A single strong focal subject in the lower two thirds, dramatic directional lighting, rich colour.`;
}

const firstSentence = (text) => (String(text || "").split(/(?<=[.!?])\s/)[0] || "").slice(0, 240);

/**
 * llama3.2 writes a front-cover image prompt from RAWG metadata (title, genre,
 * setting, mood, description). Returns { prompt, source }; never throws.
 */
export async function llmFrontArtPrompt(meta, opts) {
  try {
    const text = await chat(
      [
        {
          text: `Write one image-generation prompt for the FRONT of a game case.

Game: ${meta.name}
Genres: ${(meta.genres || []).join(", ") || "unknown"}
Themes: ${(meta.tags || []).join(", ") || "unknown"}
Description: ${(meta.description || "").slice(0, 900)}

Describe the setting, the mood, one focal subject, lighting and palette in 60-90 words.
Do not mention text, titles or logos. Do not name real brands or trademarked characters.
Return ONLY minified JSON: {"prompt":"..."}`,
        },
      ],
      { temperature: 0.8, ...opts }
    );
    const prompt = String(parseJson(text)?.prompt || "").trim();
    if (prompt.length > 20) return { prompt, source: "ollama" };
  } catch {
    /* fall through */
  }
  return { prompt: fallbackArtPrompt(meta), source: "rawg" };
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
Story: ${(meta.description || "").slice(0, 900)}

Write SPECIFIC, DETAILED prompts that directly reference the game's actual characters, setting,
story, and visual style from the description above. The more specific, the better the result.

Return ONLY a JSON array (5 objects). No markdown fences, no commentary. Each object has
a "prompt" field — the actual image prompt, written in 70-100 words for the front and
back, 30-50 words for each shot. Be specific: subject, composition, lighting, palette,
medium. Do not copy official logos or reproduce existing cover art — create original
illustrations in the same style and spirit.

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
