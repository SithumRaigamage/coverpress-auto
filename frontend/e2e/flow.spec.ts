import { expect, test } from '@playwright/test';

test('search → generate → run completes → approve → print', async ({ page }) => {
  await page.goto('/');

  // Search from the top bar (⌘K focuses it).
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('searchbox', { name: 'Search games on RAWG' })).toBeFocused();
  await page.keyboard.type('iron');
  await expect(page).toHaveURL(/\?q=iron/);
  await expect(page.getByRole('article', { name: 'Iron Tide' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Neon Harbor' })).toHaveCount(0);

  // Generate: no upload, no typing — straight to the run screen.
  await page.getByRole('button', { name: 'Generate cover for Iron Tide' }).click();
  await expect(page).toHaveURL(/\/runs\/[\w-]+$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Iron Tide' })).toBeVisible();

  // Every step finishes (AI art is skipped: off in Settings); 16:9 art is a heavy crop, so it lands in review.
  const steps = page.getByRole('list', { name: 'Pipeline steps' }).getByRole('listitem');
  await expect(steps).toHaveCount(8);
  await expect(page.getByText('Needs review', { exact: true })).toBeVisible();
  await expect(steps.filter({ hasText: 'Waiting' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: /Full wrap for Iron Tide/ })).toBeVisible();
  await expect(page.getByRole('log', { name: 'Pipeline log' })).toContainText('Route the cover');

  // Approve on the review board.
  await page.getByRole('link', { name: 'Go to review' }).click();
  await expect(page).toHaveURL(/\/review\?cover=/);
  const review = page.getByRole('region', { name: 'Needs review' });
  await expect(review.getByRole('article', { name: /Iron Tide/ })).toBeVisible();
  await review.getByRole('button', { name: 'Approve Iron Tide version 1' }).click();
  const approved = page.getByRole('region', { name: 'Approved' });
  await expect(approved.getByRole('article', { name: /Iron Tide/ })).toBeVisible();

  // Print: one A4 landscape page with the real wrap.
  await page.getByRole('link', { name: /Print approved \(1\)/ }).click();
  await expect(page).toHaveURL(/\/print/);
  await page.getByRole('link', { name: 'Open sheet' }).first().click();
  const wrap = page.getByRole('img', { name: /Print wrap for Iron Tide/ });
  await expect(wrap).toBeVisible();
  await expect(wrap).toHaveAttribute('src', /\/api\/renders\/[\w-]+\/wrap\.png$/);
  await expect(page.getByRole('button', { name: /Print \(1\)/ })).toBeEnabled();
  await expect(page.getByRole('note')).toHaveText('Print at 100% / Actual size, do not fit to page.');

  // In print media the wrap is exactly 276 × 154 mm (270 × 148 trim + 3 mm bleed) at 96 CSS px per inch.
  await page.emulateMedia({ media: 'print' });
  const mm = (px: number) => (px * 25.4) / 96;
  const box = await wrap.boundingBox();
  expect(mm(box!.width)).toBeCloseTo(276, 1);
  expect(mm(box!.height)).toBeCloseTo(154, 1);
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
  // A4 landscape in PDF points: 841.89 × 595.28.
  expect(Number(mediaBox![1])).toBeCloseTo(841.89, 0);
  expect(Number(mediaBox![2])).toBeCloseTo(595.28, 0);
});

test('Run again adds a new version to the same card, and any version can be approved', async ({ page }) => {
  await page.goto('/?q=neon');
  await page.getByRole('button', { name: 'Generate cover for Neon Harbor' }).click();
  await expect(page.getByText('Needs review', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Go to review' }).click();
  const card = page.getByRole('region', { name: /^Needs review/ }).getByRole('article', { name: /Neon Harbor/ });
  await card.getByRole('button', { name: 'Run Neon Harbor again' }).click();

  // Still one card for the game; it now holds v1 and v2, showing v2.
  const versions = page.getByRole('radiogroup', { name: 'Versions of Neon Harbor' });
  await expect(versions.getByRole('radio', { name: 'Show version 2' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('article', { name: /Neon Harbor/ })).toHaveCount(1);

  await versions.getByRole('radio', { name: 'Show version 1' }).click();
  await page.getByRole('button', { name: 'Approve Neon Harbor version 1' }).click();
  await expect(page.getByRole('region', { name: /^Approved/ }).getByRole('article', { name: /Neon Harbor/ })).toBeVisible();
});

test('AI art: edit the drafted prompt, generate, and the new image becomes the front', async ({ page }) => {
  await page.goto('/games/103');
  const prompt = page.getByRole('textbox', { name: 'Prompt' });
  await expect(prompt).toHaveValue(/Glass Orchard/);
  await prompt.fill('A glass greenhouse in an orchard at golden hour, soft light, painterly.');
  await page.getByRole('combobox', { name: 'Images per press' }).selectOption('1');
  await page.getByRole('button', { name: 'Generate art' }).click();

  const grid = page.getByRole('list', { name: 'Art candidates' });
  const front = grid.getByRole('button', { pressed: true });
  await expect(front).toHaveAccessibleName(/Use AI AI generated, \d+ by \d+, fit \d+, as front art/);
  await expect(page.getByRole('radio', { name: /^AI/ })).toContainText('1');
  await expect(page.getByText(/Front art · AI · 1512 × 1748/)).toBeVisible();
});

test('the art picker auto-selects the best fit and a click swaps the front', async ({ page }) => {
  await page.goto('/games/101');
  const grid = page.getByRole('list', { name: 'Art candidates' });
  const front = grid.getByRole('button', { pressed: true });
  await expect(front).toHaveAccessibleName(/SteamGridDB portrait grid.*fit 86/);
  await page.getByRole('radio', { name: /^RAWG/ }).click();
  const shot = grid.getByRole('button', { name: /RAWG screenshot/ }).first();
  await shot.click();
  await expect(shot).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Front art · RAWG · 1280 × 720/)).toBeVisible();
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const path of ['/', '/review', '/games/102', '/settings']) {
    test(`${path} has no horizontal page overflow`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test('icon-only buttons carry accessible names', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('article').first()).toBeVisible();
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href]')]
      .filter((el) => !(el as HTMLElement).innerText.trim() && !el.getAttribute('aria-label'))
      .map((el) => el.outerHTML.slice(0, 120)),
  );
  expect(unnamed).toEqual([]);
});
