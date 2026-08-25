import { expect, test } from '@playwright/test';

/**
 * A place has an address (#644): a link to a card opens the card on top of its
 * region, the address canonicalises to carry the slugs, and Back walks the
 * places the visitor chose. And a link that names nothing visible degrades to
 * the nearest place with no error surface.
 */

// Mirrors backend/src/db/seed/e2eFixture.ts — keep in sync.
const FIXTURE_WORLD_VIEW = 9001;
const FIXTURE_REGION_ID = 9001;
const FIXTURE_REGION = 'Testland';
const FIXTURE_EXPERIENCE_ID = 9001;
const FIXTURE_EXPERIENCE = 'Testland Old Town';

test.describe('Addressable places @smoke', () => {
  test('a link to a card opens it on its region, under its canonical address', async ({ page }) => {
    await page.goto(`/wv/${FIXTURE_WORLD_VIEW}/r/${FIXTURE_REGION_ID}/e/${FIXTURE_EXPERIENCE_ID}`);

    // The card is open in the explore panel, on top of the region.
    await expect(page.getByRole('button', { name: 'Close exploration' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(FIXTURE_REGION);

    // Both slugs are filled in place, each by whoever learns the name: the
    // region's by the ancestors read, the card's by the region's list.
    await expect(page).toHaveURL(/\/wv\/9001\/r\/9001-testland\/e\/9001-testland-old-town$/);
  });

  test('opening a card is a step, so Back closes it and leaves the region', async ({ page }) => {
    // Back is asserted from a card opened *here* rather than from a deep link:
    // a link opened cold has nothing behind it, and Back would leave the site.
    await page.goto(`/wv/${FIXTURE_WORLD_VIEW}/r/${FIXTURE_REGION_ID}`);
    await page.getByRole('button', { name: 'Explore experiences in this region' }).click();
    await expect(page.getByText(/World Heritage Sites \(\d+\)/)).toBeVisible();

    // By name, not by row index: index 0 is the category header, and the row
    // the address should name is the one whose name it should carry.
    await page.locator('[data-index]').filter({ hasText: FIXTURE_EXPERIENCE }).first().click();
    await expect(page).toHaveURL(/\/wv\/9001\/r\/9001-testland\/e\/9001-testland-old-town$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/wv\/9001\/r\/9001-testland$/);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(FIXTURE_REGION);
    await expect(page.getByRole('button', { name: 'Close exploration' })).toBeVisible();
  });

  test('a legacy ?wv= link lands on the path form, and an unknown region degrades', async ({ page }) => {
    await page.goto(`/?wv=${FIXTURE_WORLD_VIEW}`);
    await expect(page).toHaveURL(/\/wv\/9001$/);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Select a region');

    // A region id the fixture does not hold degrades to the world view, silently.
    await page.goto(`/wv/${FIXTURE_WORLD_VIEW}/r/424242`);
    await expect(page).toHaveURL(/\/wv\/9001$/);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Select a region');
  });
});
