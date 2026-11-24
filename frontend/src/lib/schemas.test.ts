import { describe, expect, it } from 'vitest';
import { newShelfSchema, overrideSchema } from './schemas';

describe('newShelfSchema', () => {
  it('needs a name and a valid platform/layout', () => {
    expect(newShelfSchema.safeParse({ name: '  ', platform: 'PS5', layout: 'auto' }).success).toBe(false);
    expect(newShelfSchema.safeParse({ name: 'Shelf', platform: 'XBOX', layout: 'auto' }).success).toBe(false);
    expect(newShelfSchema.safeParse({ name: 'Shelf', platform: 'PS4', layout: 'ps4' }).success).toBe(true);
  });
});

describe('overrideSchema', () => {
  it('clamps to the whitelisted renderer ranges', () => {
    const base = {
      title: 'A',
      titleSize: 18,
      titleAnchor: 'top',
      titleAlign: 'left',
      zoom: 1,
      offX: 0,
      offY: 0,
      ribbon: '',
      subtitle: '',
    } as const;
    expect(overrideSchema.safeParse({ ...base, titleSize: 40 }).success).toBe(false);
    expect(overrideSchema.safeParse({ ...base, zoom: 3 }).success).toBe(false);
    expect(overrideSchema.safeParse({ ...base, titleAnchor: 'center' }).success).toBe(false);
    expect(overrideSchema.safeParse(base).success).toBe(true);
  });
});
