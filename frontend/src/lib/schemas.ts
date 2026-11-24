import { z } from 'zod';
import { countTitles } from './format';

export const newShelfSchema = z.object({
  name: z.string().trim().min(1, 'Give the shelf a name.').max(80),
  platform: z.enum(['PS5', 'PS4']),
  layout: z.enum(['auto', 'ps4', 'ps5']),
});
export type NewShelfValues = z.infer<typeof newShelfSchema>;

export const importSchema = z.object({
  titles: z.string().refine((value) => countTitles(value) > 0, 'Add at least one title.'),
});
export type ImportValues = z.infer<typeof importSchema>;

export const styleSchema = z.object({
  accent: z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour.'),
  mark: z.string().max(2, 'Two characters at most.'),
  edition: z.string().max(80),
  address: z.string().max(400),
  layout: z.enum(['auto', 'ps4', 'ps5']),
  platform: z.enum(['PS5', 'PS4']),
});
export type StyleValues = z.infer<typeof styleSchema>;

export const keySchema = z.object({
  value: z.string().min(1, 'Paste a key, or use Clear.'),
});
export type KeyValues = z.infer<typeof keySchema>;

export const llmSchema = z.object({
  provider: z.enum(['ollama', 'openrouter']),
  ollama: z.object({
    host: z.string().url('Enter an http:// or https:// URL.').min(1, 'Host is required.'),
    textModel: z.string().min(1, 'Text model is required.'),
    visionModel: z.string().min(1, 'Vision model is required.'),
  }),
  openrouter: z.object({
    textModel: z.string().min(1, 'Text model is required.'),
    visionModel: z.string().min(1, 'Vision model is required.'),
  }),
});
export type LlmValues = z.infer<typeof llmSchema>;

export const overrideSchema = z.object({
  title: z.string().max(200),
  titleSize: z.number().min(7).max(26),
  titleAnchor: z.enum(['top', 'bottom']),
  titleAlign: z.enum(['left', 'center']),
  zoom: z.number().min(1).max(2.5),
  offX: z.number().min(-30).max(30),
  offY: z.number().min(-30).max(30),
  ribbon: z.string().max(200),
  subtitle: z.string().max(200),
});
export type OverrideValues = z.infer<typeof overrideSchema>;
