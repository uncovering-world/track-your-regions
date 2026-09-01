import { expect, test } from '@playwright/test';

/**
 * Finding a place by name (#592).
 *
 * A visitor who knows the name types it in the navigation pane and is taken to
 * the card, in the region that holds it. What this covers end to end is the
 * whole path a name takes: the catalogue-wide read, the region context it
 * carries, the address one click writes, and the card opening at the other end.
 */

// Mirrors backend/src/db/seed/e2eFixture.ts — keep in sync.
const FIXTURE_WORLD_VIEW = 9001;
const FIXTURE_REGION = 'Testland';
const FIXTURE_EXPERIENCE = 'Testland Cathedral';

test.describe('Search @smoke', () => {
  test('a name typed in the pane opens the card in its region', async ({ page }) => {
    await page.goto(`/wv/${FIXTURE_WORLD_VIEW}`);

    await page.getByPlaceholder('Search regions and experiences...').fill(FIXTURE_EXPERIENCE);

    // Under its own heading, so an answer about a place is never mistaken for
    // an answer about a region.
    await expect(page.getByText('Experiences', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(FIXTURE_EXPERIENCE) }).click();

    // The region that holds it, the card open on top of it, and an address that
    // names both — the same one a link would carry.
    await expect(page).toHaveURL(/\/wv\/9001\/r\/9001-testland\/e\/9002-testland-cathedral$/);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(FIXTURE_REGION);
    await expect(page.getByRole('button', { name: 'Close exploration' })).toBeVisible();
  });
});
