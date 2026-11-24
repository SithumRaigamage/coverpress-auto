/** Print-sheet geometry, all in millimetres. One wrap per A4 landscape page.
 *
 *  A4 landscape is 297 × 210 mm; with the 8 mm @page margin the printable box is
 *  281 × 194 mm. Each sheet is 281 × 180 mm: the 276 × 154 mm wrap (270 × 148 trim
 *  + 3 mm bleed) centred horizontally, 6 mm above and below it for crop and fold
 *  marks, then a 100 mm test ruler. Nothing here is ever scaled. */

export const SHEET = { width: 281, height: 180 } as const;
export const PAGE_MARGIN_MM = 8;
export const RULER_MM = 100;

export interface SheetGeometry {
  image: { x: number; y: number; width: number; height: number };
  trim: { x: number; y: number; width: number; height: number };
  /** x of the two spine fold lines (back|spine and spine|front). */
  folds: [number, number];
  ruler: { x: number; y: number; length: number };
}

export function sheetGeometry(trim: { width: number; height: number }, panels: { back: number; spine: number }, bleed: number): SheetGeometry {
  const image = { width: trim.width + bleed * 2, height: trim.height + bleed * 2, x: 0, y: 6 };
  image.x = (SHEET.width - image.width) / 2;
  const t = { x: image.x + bleed, y: image.y + bleed, width: trim.width, height: trim.height };
  return {
    image,
    trim: t,
    folds: [t.x + panels.back, t.x + panels.back + panels.spine],
    ruler: { x: t.x, y: image.y + image.height + 8, length: RULER_MM },
  };
}
