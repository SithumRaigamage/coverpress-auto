/* Language-model configuration.

   Ollama is the default: it runs on the user's machine, needs no API key and
   keeps the prompt data local. OpenRouter remains available for people who
   prefer a hosted `:free` model. The key is never part of this config object's
   public shape — `publicLlmConfig` is what API responses are built from.

   Settings are stored per account in `settings`, so the isolation rule in
   repo.mjs still holds when multi-user support is switched back on. */

import * as repo from "./repo.mjs";
import { providerKey } from "./auth.mjs";

export const LLM_DEFAULTS = {
  provider: "ollama",
  ollamaHost: "http://127.0.0.1:11434",
  ollamaTextModel: "llama3.2",
  ollamaVisionModel: "llava",
  openrouterTextModel: "openrouter/free",
  openrouterVisionModel: "openrouter/free",
};

const KEYS = new Set(Object.keys(LLM_DEFAULTS));

/** Patch → validated database values. Unknown keys are dropped, not stored. */
export function normalizeLlmPatch(body = {}, current = LLM_DEFAULTS) {
  const out = {};
  if (body.provider !== undefined) {
    const provider = String(body.provider).toLowerCase();
    if (provider !== "ollama" && provider !== "openrouter") {
      throw Object.assign(new Error("Provider must be ollama or openrouter."), { status: 400 });
    }
    out.llmProvider = provider;
  }

  const ollama = body.ollama && typeof body.ollama === "object" ? body.ollama : {};
  const openrouter = body.openrouter && typeof body.openrouter === "object" ? body.openrouter : {};

  const flat = {
    ollamaHost: body.ollamaHost ?? ollama.host,
    ollamaTextModel: body.ollamaTextModel ?? ollama.textModel,
    ollamaVisionModel: body.ollamaVisionModel ?? ollama.visionModel,
    openrouterTextModel: body.openrouterTextModel ?? openrouter.textModel,
    openrouterVisionModel: body.openrouterVisionModel ?? openrouter.visionModel,
  };
  for (const [key, value] of Object.entries(flat)) {
    if (value === undefined) continue;
    const clean = String(value).trim().slice(0, 200);
    if (!clean) continue;
    if (key === "ollamaHost" && !/^https?:\/\/[^\s]+$/i.test(clean)) {
      throw Object.assign(new Error("Ollama host must be an http:// or https:// URL."), { status: 400 });
    }
    out[key] = clean;
  }
  return out;
}

/** Values used by the build worker. Includes the OpenRouter key; never serialise this. */
export function llmConfig(db, accountId, secret) {
  const saved = repo.getSettings(db, accountId);
  const value = (key) => (typeof saved[key] === "string" && saved[key] ? saved[key] : LLM_DEFAULTS[key]);
  const env = (name, fallback) => String(process.env[name] || fallback);
  return {
    provider: ["ollama", "openrouter"].includes(saved.llmProvider) ? saved.llmProvider : LLM_DEFAULTS.provider,
    ollama: {
      host: value("ollamaHost") || env("OLLAMA_HOST", LLM_DEFAULTS.ollamaHost),
      textModel: value("ollamaTextModel") || env("OLLAMA_TEXT_MODEL", LLM_DEFAULTS.ollamaTextModel),
      visionModel: value("ollamaVisionModel") || env("OLLAMA_VISION_MODEL", LLM_DEFAULTS.ollamaVisionModel),
    },
    openrouter: {
      textModel: value("openrouterTextModel") || env("OPENROUTER_TEXT_MODEL", LLM_DEFAULTS.openrouterTextModel),
      visionModel: value("openrouterVisionModel") || env("OPENROUTER_VISION_MODEL", LLM_DEFAULTS.openrouterVisionModel),
      key: providerKey(db, accountId, "openrouter", secret),
    },
  };
}

/** Safe to send to a browser: capability flags instead of secret values. */
export function publicLlmConfig(config) {
  return {
    provider: config.provider,
    ollama: { ...config.ollama },
    openrouter: {
      textModel: config.openrouter.textModel,
      visionModel: config.openrouter.visionModel,
      configured: Boolean(config.openrouter.key),
    },
  };
}

export const llmAvailable = (config) => config.provider === "ollama" || Boolean(config.openrouter.key);

/** opts for lib/sources.mjs — same shape for both providers. */
export function llmOpts(config, which = "text") {
  if (config.provider === "ollama") {
    return {
      provider: "ollama",
      host: config.ollama.host,
      model: which === "vision" ? config.ollama.visionModel : config.ollama.textModel,
    };
  }
  return {
    provider: "openrouter",
    key: config.openrouter.key,
    model: which === "vision" ? config.openrouter.visionModel : config.openrouter.textModel,
  };
}

export { KEYS as LLM_SETTING_KEYS };
