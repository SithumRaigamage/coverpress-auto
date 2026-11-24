/* Language-model configuration — read only from the process environment.

   Ollama is the default: it runs on the user's machine, needs no API key and
   keeps the prompt data local. OpenRouter remains available for people who
   prefer a hosted `:free` model. Nothing here is writable from the browser;
   .env is the single source of truth and changes require a server restart.
   `publicLlmConfig` is the only shape ever sent to a client. */

import { providerKey } from "./auth.mjs";

export const LLM_DEFAULTS = {
  provider: "ollama",
  ollamaHost: "http://127.0.0.1:11434",
  ollamaTextModel: "llama3.2",
  ollamaVisionModel: "llava",
  openrouterTextModel: "openrouter/free",
  openrouterVisionModel: "openrouter/free",
};

/** Values used by the build worker. Includes the OpenRouter key; never serialise this. */
export function llmConfig(_db, _accountId) {
  const env = (name, fallback) => String(process.env[name] || fallback).trim() || fallback;
  const provider = env("LLM_PROVIDER", LLM_DEFAULTS.provider).toLowerCase();
  return {
    provider: ["ollama", "openrouter"].includes(provider) ? provider : LLM_DEFAULTS.provider,
    ollama: {
      host: env("OLLAMA_HOST", LLM_DEFAULTS.ollamaHost),
      textModel: env("OLLAMA_TEXT_MODEL", LLM_DEFAULTS.ollamaTextModel),
      visionModel: env("OLLAMA_VISION_MODEL", LLM_DEFAULTS.ollamaVisionModel),
    },
    openrouter: {
      textModel: env("OPENROUTER_TEXT_MODEL", LLM_DEFAULTS.openrouterTextModel),
      visionModel: env("OPENROUTER_VISION_MODEL", LLM_DEFAULTS.openrouterVisionModel),
      key: providerKey(null, null, "openrouter"),
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
