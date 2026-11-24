/* AI-generated cover art, cached under data/art/generated/<rawgId>/.

   - prompt(): llama3.2 drafts a front-art prompt from RAWG metadata (cached per
     game); the user may edit it on the game screen, and the edit is saved.
   - generate(): calls Gemini `count` times, fits each image to the panel and
     stores it with an index. The no-text/no-logo/no-trademark rules are always
     appended server-side, whatever the prompt says.
   - list(): stored images as art candidates (source "AI"), scored like any
     other art, served through GET /api/generated/:rawgId/:file.
   - pipelineStep(): the optional "Generate AI art" build step.

   Off entirely when GEMINI_API_KEY is unset. */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { geminiImage, fitToPanel, GeminiError, GEMINI_DEFAULT_MODEL } from "../lib/gemini.mjs";
import { ART_PROMPT_RULES, llmFrontArtPrompt } from "../lib/sources.mjs";
import { artFit } from "../lib/qc.mjs";
import { safeJoin } from "./http.mjs";
import { llmConfig, llmOpts } from "./llm.mjs";

const FILE_RE = /^[a-f0-9-]{36}\.png$/;
const URL_RE = /^\/api\/generated\/(\d+)\/([a-f0-9-]{36}\.png)$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const MAX_PER_PRESS = 4;

export function createGenerator({ dataDir, key, model = () => GEMINI_DEFAULT_MODEL, logger = console }) {
  const dir = (rawgId) => safeJoin(dataDir, `art/generated/${Number(rawgId)}`);
  // Gemini's rate limits: 6.5 s between calls (CLAUDE.md). Tests set GEMINI_GAP_MS=0.
  const gap = () => Number(process.env.GEMINI_GAP_MS ?? 6500);

  async function readJson(file, fallback) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  async function index(rawgId) {
    const d = dir(rawgId);
    return d ? readJson(path.join(d, "index.json"), { items: [] }) : { items: [] };
  }

  const enabled = () => Boolean(key());

  /** The current prompt for a game: the user's saved edit, else a cached or fresh llama3.2 draft. */
  async function prompt(rawgId, meta, { refresh = false } = {}) {
    const d = dir(rawgId);
    const file = d && path.join(d, "prompt.json");
    if (file && !refresh) {
      const cached = await readJson(file, null);
      if (cached?.prompt) return cached;
    }
    const drafted = await llmFrontArtPrompt(meta, llmOpts(llmConfig(), "text"));
    if (file) {
      await fs.mkdir(d, { recursive: true });
      await fs.writeFile(file, JSON.stringify({ ...drafted, savedAt: new Date().toISOString() }));
    }
    return drafted;
  }

  async function savePrompt(rawgId, text) {
    const d = dir(rawgId);
    if (!d) return;
    await fs.mkdir(d, { recursive: true });
    await fs.writeFile(path.join(d, "prompt.json"), JSON.stringify({ prompt: text, source: "user", savedAt: new Date().toISOString() }));
  }

  const toCandidate = (rawgId, item) => {
    const fit = artFit(item.width, item.height);
    const url = `/api/generated/${Number(rawgId)}/${item.file}`;
    return { id: `ai:${item.id}`, source: "AI", kind: "AI generated", url, thumb: url, width: item.width, height: item.height, fit: fit.score, printReady: fit.printReady, createdAt: item.createdAt };
  };

  async function list(rawgId) {
    return (await index(rawgId)).items.map((i) => toCandidate(rawgId, i)).reverse();
  }

  /**
   * Generate `count` images. Returns { items, errors }; items are the ones that
   * succeeded. Throws only when none did, with the first error (so a missing
   * key or an exhausted quota is reported as such).
   */
  async function generate(rawgId, meta, { prompt: text, count = 2 } = {}) {
    if (!enabled()) throw new GeminiError("no_key", "Set GEMINI_API_KEY in .env and restart the server to generate AI art.", 400);
    const d = dir(rawgId);
    if (!d) throw new GeminiError("bad_request", "Bad game id.", 400);
    const base = String(text || "").trim() || (await prompt(rawgId, meta)).prompt;
    if (text) await savePrompt(rawgId, base);
    const full = `${base}\n\n${ART_PROMPT_RULES}`;
    const n = Math.max(1, Math.min(MAX_PER_PRESS, Number(count) || 2));

    await fs.mkdir(d, { recursive: true });
    const made = [];
    const errors = [];
    for (let i = 0; i < n; i++) {
      if (i > 0 && gap() > 0) await sleep(gap());
      try {
        const { buffer } = await geminiImage(full, { key: key(), model: model() });
        const fitted = await fitToPanel(buffer);
        const id = crypto.randomUUID();
        const file = `${id}.png`;
        await fs.writeFile(path.join(d, file), fitted.png);
        made.push({ id, file, width: fitted.width, height: fitted.height, original: fitted.source, prompt: base, model: model(), createdAt: new Date().toISOString() });
      } catch (err) {
        errors.push(err);
        logger.error?.(`Gemini image ${i + 1}/${n} for #${rawgId}: ${err.message}`);
        // No point burning further calls on a missing key, bad key or empty quota.
        if (err instanceof GeminiError && ["no_key", "quota", "auth"].includes(err.code)) break;
      }
    }
    if (made.length) {
      const idx = await index(rawgId);
      idx.items.push(...made);
      await fs.writeFile(path.join(d, "index.json"), JSON.stringify(idx));
    }
    if (!made.length) throw errors[0] || new GeminiError("upstream", "Gemini produced no images.", 502);
    return { items: made.map((m) => toCandidate(rawgId, m)).reverse(), errors: errors.map((e) => e.message) };
  }

  /** Absolute path for a /api/generated URL, or null — used by the build to read local art. */
  function localFile(url) {
    const m = URL_RE.exec(String(url || ""));
    if (!m) return null;
    return safeJoin(dataDir, `art/generated/${m[1]}/${m[2]}`);
  }

  function fileFor(rawgId, file) {
    if (!/^\d+$/.test(String(rawgId)) || !FILE_RE.test(String(file))) return null;
    return safeJoin(dataDir, `art/generated/${rawgId}/${file}`);
  }

  /** The optional pipeline step. Never throws: a Gemini problem falls back to fetched art. */
  async function pipelineStep({ rawgId, meta, variant }) {
    if (!enabled()) return { skipped: true, detail: "GEMINI_API_KEY is not set." };
    const cached = await list(rawgId);
    // First run with images already made on the game screen: use them. A variant
    // asks for one fresh image so the new version can have new art.
    if (cached.length && !variant) return { items: cached, detail: `Using ${cached.length} cached AI image${cached.length === 1 ? "" : "s"}.` };
    try {
      const out = await generate(rawgId, meta, { count: cached.length ? 1 : 2 });
      return {
        items: [...out.items, ...cached],
        detail: `${out.items.length} new image${out.items.length === 1 ? "" : "s"} from ${model()}${out.errors.length ? ` (${out.errors.length} failed)` : ""}.`,
      };
    } catch (err) {
      return { items: cached, failed: true, detail: `${err.message} Continuing with fetched art.` };
    }
  }

  /** Delete one AI image (a draft the user doesn't want). False if it wasn't there. */
  async function remove(rawgId, file) {
    const target = fileFor(rawgId, file);
    if (!target) return false;
    const idx = await index(rawgId);
    const before = idx.items.length;
    idx.items = idx.items.filter((i) => i.file !== file);
    await fs.rm(target, { force: true });
    if (idx.items.length === before) return false;
    await fs.writeFile(path.join(dir(rawgId), "index.json"), JSON.stringify(idx));
    return true;
  }

  /** Delete every AI image for a game. The saved prompt stays. Returns how many went. */
  async function clear(rawgId) {
    const d = dir(rawgId);
    if (!d || !/^\d+$/.test(String(rawgId))) return 0;
    const idx = await index(rawgId);
    for (const item of idx.items) if (FILE_RE.test(item.file)) await fs.rm(path.join(d, item.file), { force: true });
    if (idx.items.length) await fs.writeFile(path.join(d, "index.json"), JSON.stringify({ items: [] }));
    return idx.items.length;
  }

  return { enabled, model, prompt, savePrompt, list, generate, localFile, fileFor, pipelineStep, remove, clear };
}
