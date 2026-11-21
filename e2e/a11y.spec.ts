import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGES = [
  ['home', '/'],
  ['map', '/map'],
  ['city', '/cities/frederick/breweries'],
  ['county', '/counties/frederick/breweries'],
  ['neighborhood', '/neighborhoods/canton'],
  ['brewery', '/breweries/7-locks-brewing'],
  ['neighborhoods index', '/neighborhoods'],
  ['things to do index', '/near'],
  ['attraction', '/near/oriole-park-at-camden-yards'],
  ['place type', '/near/parks'],
  ['FAQ', '/faq'],
  ['contact', '/contact'],
] as const;

/** Serious and critical WCAG 2.x A/AA violations, ignoring third-party frames (ads, maps). */
async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('iframe')
    .exclude('.adsbygoogle')
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join('\n  ')}`
    );
}

for (const [name, path] of PAGES) {
  test(`axe: ${name} has no serious or critical violations`, async ({
    page,
  }) => {
    await page.goto(path);
    await page.waitForLoadState('load');
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('axe: the open mobile menu has no serious or critical violations', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
    expect(await seriousViolations(page)).toEqual([]);
  });
});
