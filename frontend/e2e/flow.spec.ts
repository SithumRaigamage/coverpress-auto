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

  // All seven steps finish; RAWG-only 16:9 art is a heavy crop, so it lands in review.
  const steps = page.getByRole('list', { name: 'Pipeline steps' }).getByRole('listitem');
  await expect(steps).toHaveCount(7);
  await expect(page.getByText('Needs review', { exact: true })).toBeVisible();
  await expect(steps.filter({ hasText: 'Waiting' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: /Full wrap for Iron Tide/ })).toBeVisible();
  await expect(page.getByRole('log', { name: 'Pipeline log' })).toContainText('Route the cover');

  // Approve on the review board.
  await page.getByRole('link', { name: 'Go to review' }).click();
  await expect(page).toHaveURL(/\/review\?cover=/);
  const review = page.getByRole('region', { name: 'Needs review' });
  await expect(review.getByRole('article', { name: /Iron Tide/ })).toBeVisible();
  await review.getByRole('button', { name: 'Approve Iron Tide' }).click();
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
