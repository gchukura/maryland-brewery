import { expect, test } from '@playwright/test';

const FULL = '/breweries/7-locks-brewing'; // photos, hours, beers, reviews, news
// No hours, photos, beers or website. Real data, so it can fill in (Brothers Ridge Cider did when
// the beer import gave it a menu): pick another brewery with empty hours, no photos and no beers.
const SPARSE = '/breweries/stillwater-artisanal-ales';

test('the lightbox works from the keyboard and returns focus', async ({
  page,
}) => {
  await page.goto(FULL);
  const opener = page.getByRole('button', { name: /^All \d+ photos$/ });
  const total = Number((await opener.innerText()).match(/\d+/)?.[0]);
  expect(total).toBeGreaterThan(1);

  await opener.click();
  const dialog = page.getByRole('dialog', { name: /photos$/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`1 of ${total}`)).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByText(`2 of ${total}`)).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.getByText(`${total} of ${total}`)).toBeVisible();

  // Thumbnails are buttons
  await dialog
    .getByRole('button', { name: new RegExp(`photo 3 of ${total}$`) })
    .click();
  await expect(dialog.getByText(`3 of ${total}`)).toBeVisible();

  // Focus stays inside while open
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => !!document.activeElement?.closest('dialog'))
  ).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Save adds the brewery to /saved and removes it again', async ({
  page,
}) => {
  await page.goto(FULL);
  const save = page.getByRole('button', { name: /^Save 7 Locks/ });
  await expect(save).toHaveAttribute('aria-pressed', 'false');
  await save.click();
  await expect(
    page.getByRole('button', { name: /^Saved: 7 Locks/ })
  ).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/saved');
  await expect(page.getByText('1 saved brewery')).toBeVisible();
  await expect(
    page.locator('main a[href="/breweries/7-locks-brewing"]')
  ).toBeVisible();

  await page.goto(FULL);
  await page.getByRole('button', { name: /^Saved: 7 Locks/ }).click();
  await page.goto('/saved');
  await expect(page.getByText('Nothing saved yet')).toBeVisible();
});

test('a full page shows every section', async ({ page }) => {
  await page.goto(FULL);
  for (const name of [
    'About 7 Locks Brewing',
    'On tap',
    'What people mention',
    'In the news',
    'Nearby breweries',
    'Hours',
  ]) {
    await expect(
      page.getByRole('heading', { name, exact: true })
    ).toBeVisible();
  }
  await expect(
    page.getByRole('link', { name: /Get directions/ })
  ).toHaveAttribute('href', /google\.com\/maps\/dir\//);
  await expect(
    page.getByRole('link', { name: 'Report a change' })
  ).toHaveAttribute('href', '/contact?brewery=7-locks-brewing');
});

test('a sparse page hides empty sections instead of printing placeholders', async ({
  page,
}) => {
  await page.goto(SPARSE);
  await expect(page.locator('h1')).toHaveText('Stillwater Artisanal Ales');
  for (const name of ['On tap', 'Hours'])
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(
      0
    );
  await expect(page.getByRole('region', { name: 'Visit' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /^All \d+ photos$/ })
  ).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(
    /not available|No description|Hours not listed|undefined|null/i
  );
  // Still useful: directions, report a change, nearby breweries
  await expect(
    page.getByRole('link', { name: /Get directions/ })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Nearby breweries' })
  ).toBeVisible();
});

test('Report a change prefills the contact form', async ({ page }) => {
  await page.goto('/contact?brewery=7-locks-brewing');
  await expect(page.locator('#subject')).toHaveValue(
    'Report a change: 7 Locks Brewing'
  );
  await expect(page.locator('#message')).toHaveValue(
    /breweries\/7-locks-brewing/
  );
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('no page is wider than the screen', async ({ page }) => {
    for (const url of [FULL, SPARSE, '/cities/frederick/breweries']) {
      await page.goto(url);
      const { scroll, viewport } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(scroll, `${url} overflows sideways`).toBeLessThanOrEqual(viewport);
    }
  });
});
