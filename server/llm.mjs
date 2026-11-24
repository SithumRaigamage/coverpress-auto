/* Language-model configuration — Ollama only, read from the process environment.

   Ollama runs on the user's machine, needs no API key and keeps the prompt data
   local: llama3.2 writes back-cover copy and art prompts, llava reviews the
   rendered front. Nothing here is writable from the browser; .env is the single
   source of truth and changes require a server restart. When Ollama is down,
   every caller falls back to deterministic RAWG-derived text. */

export const LLM_DEFAULTS = {
  ollamaHost: "http://127.0.0.1:11434",
  ollamaTextModel: "llama3.2",
  ollamaVisionModel: "llava",
};

export function llmConfig() {
  const env = (name, fallback) => String(process.env[name] || fallback).trim() || fallback;
  return {
    provider: "ollama",
    ollama: {
      host: env("OLLAMA_HOST", LLM_DEFAULTS.ollamaHost),
      textModel: env("OLLAMA_TEXT_MODEL", LLM_DEFAULTS.ollamaTextModel),
      visionModel: env("OLLAMA_VISION_MODEL", LLM_DEFAULTS.ollamaVisionModel),
    },
    // VISION_REVIEW=false skips the llava check of each rendered front.
    vision: String(process.env.VISION_REVIEW ?? "true").toLowerCase() !== "false",
  };
}

/** Safe to send to a browser. There is no secret in it. */
export function publicLlmConfig(config) {
  return { provider: "ollama", ollama: { ...config.ollama }, vision: config.vision };
}

/** opts for lib/sources.mjs. `extra` carries per-call options such as a seed. */
export function llmOpts(config, which = "text", extra = {}) {
  return {
    provider: "ollama",
    host: config.ollama.host,
    model: which === "vision" ? config.ollama.visionModel : config.ollama.textModel,
    ...extra,
  };
}
