import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PrintSheet } from './PrintSheet';
import { SHEET, PAGE_MARGIN_MM } from '../../lib/print';

const plan = {
  project: { id: 'p1', name: 'Living room' },
  paper: { size: 'A4', orientation: 'landscape', marginMm: 8, scale: 100 },
  trimMm: { width: 270, height: 148 },
  panelsMm: { back: 128, spine: 14, front: 128 },
  bleedMm: 3,
  pageWidthMm: 276,
  pageHeightMm: 154,
  pages: [{ coverId: 'c1', title: 'Iron Tide', platform: 'PS5', version: 2, wrapUrl: '/api/renders/r2/wrap.png', widthMm: 276, heightMm: 154 }],
  instructions: 'Print at 100% / Actual size on A4 landscape, do not fit to page.',
};

beforeEach(() => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(plan), { status: 200, headers: { 'content-type': 'application/json' } }));
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/print/:projectId', element: <PrintSheet /> }], { initialEntries: ['/print/p1'] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return screen.findByTestId('print-page');
}

describe('print sheet', () => {
  it('lays the wrap out at 270 × 148 mm trim (+3 mm bleed) on an A4 landscape sheet, in mm', async () => {
    const page = await setup();
    expect(page.style.width).toBe('281mm');
    expect(page.style.height).toBe('180mm');

    const img = screen.getByRole('img', { name: /Print wrap for Iron Tide/ });
    expect(img.style.width).toBe('276mm');
    expect(img.style.height).toBe('154mm');

    const trim = page.querySelector('[data-trim]')!;
    expect(Number(trim.getAttribute('width'))).toBe(270);
    expect(Number(trim.getAttribute('height'))).toBe(148);
    // The sheet fits A4 landscape's printable box (297 × 210 minus 8 mm margins).
    expect(SHEET.width).toBeLessThanOrEqual(297 - 2 * PAGE_MARGIN_MM);
    expect(SHEET.height).toBeLessThanOrEqual(210 - 2 * PAGE_MARGIN_MM);
  });

  it('draws crop marks at the trim, fold marks at 128 and 142 mm, and a 100 mm ruler', async () => {
    const page = await setup();
    const trimX = Number(page.querySelector('[data-trim]')!.getAttribute('x'));
    const folds = [...page.querySelectorAll('[data-fold]')].map((g) => Number(g.getAttribute('data-fold')) - trimX);
    expect(folds).toEqual([128, 142]);
    expect(page.querySelectorAll('[data-crop]').length).toBe(4);

    const ruler = page.querySelector('[data-ruler]')!;
    expect(ruler.getAttribute('data-ruler')).toBe('100');
    const base = ruler.querySelector('line')!;
    expect(Number(base.getAttribute('x2')) - Number(base.getAttribute('x1'))).toBe(100);
    // 1 mm in the SVG's user space is 1 mm on paper: viewBox units equal the mm size.
    const svg = page.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${SHEET.width} ${SHEET.height}`);
    expect(svg.getAttribute('width')).toBe(`${SHEET.width}mm`);

    expect(screen.getByRole('note')).toHaveTextContent('Print at 100% / Actual size, do not fit to page.');
  });

  it('print CSS is in millimetres: A4 landscape @page and a 276 × 154 mm wrap', () => {
    // Read the real stylesheet; Vitest runs with css: false, so importing it yields nothing.
    const css = readFileSync('src/styles/app.css', 'utf8') // vitest runs from frontend/;
    expect(css).toMatch(/@page\s*{\s*size:\s*A4 landscape;\s*margin:\s*8mm;/);
    const printBlock = css.slice(css.indexOf('@media print'));
    expect(printBlock).toMatch(/\.print-page\s*{[^}]*width:\s*281mm/);
    expect(printBlock).toMatch(/\.print-page\s*{[^}]*height:\s*180mm/);
    expect(printBlock).toMatch(/\.print-page img\s*{[^}]*width:\s*276mm[^}]*height:\s*154mm/);
    expect(printBlock).not.toMatch(/\.print-page[^{]*{[^}]*\d+px/);
  });
});
