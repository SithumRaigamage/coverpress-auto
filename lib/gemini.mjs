/* Gemini image generation ("Nano Banana"), server-side only.

   One call → one image. The key is GEMINI_API_KEY from .env and is sent as the
   x-goog-api-key header, never in a URL and never to the browser. The model is
   GEMINI_IMAGE_MODEL (default gemini-2.5-flash-image) so a retired model ID is
   a config change, not a code change. Image generation is billed by Google:
   there is no free tier.

   Output is fitted to the front panel: centre-cropped to 128:148 and scaled to
   at least 1512 × 1748 px (300 DPI). Upscaling a smaller image does not add
   detail; QC still scores the result honestly from its final size. */

import { createCanvas, loadImage } from "@napi-rs/canvas";

const API = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-image";
export const PANEL = { width: 1512, height: 1748 };

export class GeminiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "GeminiError";
    this.code = code; // no_key | quota | auth | bad_request | no_image | upstream
    this.status = status;
  }
}

/** Generate one image. Returns { buffer, mimeType }. Throws GeminiError with a user-facing message. */
export async function geminiImage(prompt, { key, model = GEMINI_DEFAULT_MODEL, aspectRatio = "3:4", timeoutMs = 90_000 } = {}) {
  if (!key) throw new GeminiError("no_key", "Set GEMINI_API_KEY in .env and restart the server to generate AI art.", 400);
  let res;
  try {
    res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new GeminiError("upstream", `Could not reach Gemini: ${err.message}`, 502);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = String(body?.error?.message || res.statusText || "").slice(0, 200);
    if (res.status === 429) {
      throw new GeminiError("quota", "Gemini quota reached — wait and try again, or check billing for this API key.", 429);
    }
    if (res.status === 401 || res.status === 403) {
      throw new GeminiError("auth", `Gemini refused the API key (${res.status}). Check GEMINI_API_KEY.`, 502);
    }
    if (res.status === 404) {
      throw new GeminiError("bad_request", `Gemini has no model "${model}". Set GEMINI_IMAGE_MODEL in .env.`, 502);
    }
    if (res.status === 400) throw new GeminiError("bad_request", `Gemini rejected the request: ${detail}`, 400);
    throw new GeminiError("upstream", `Gemini failed (${res.status}): ${detail}`, 502);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const image = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  if (!image) {
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || "no image in the response";
    throw new GeminiError("no_image", `Gemini returned no image (${reason}). Edit the prompt and try again.`, 422);
  }
  const inline = image.inlineData || image.inline_data;
  return { buffer: Buffer.from(inline.data, "base64"), mimeType: inline.mimeType || inline.mime_type || "image/png" };
}

/** Centre-crop to 128:148 and scale to at least 1512 × 1748. Returns { png, width, height }. */
export async function fitToPanel(buffer) {
  const img = await loadImage(buffer);
  const aspect = PANEL.width / PANEL.height;
  let sw = img.width;
  let sh = img.height;
  if (sw / sh > aspect) sw = Math.round(sh * aspect);
  else sh = Math.round(sw / aspect);
  const sx = Math.round((img.width - sw) / 2);
  const sy = Math.round((img.height - sh) / 2);
  const scale = Math.max(1, PANEL.width / sw);
  const width = Math.max(PANEL.width, Math.round(sw * scale));
  const height = Math.max(PANEL.height, Math.round(width / aspect));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  return { png: canvas.toBuffer("image/png"), width, height, source: { width: img.width, height: img.height } };
}
