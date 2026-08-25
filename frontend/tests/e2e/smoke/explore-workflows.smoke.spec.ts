import { expect, test } from '@playwright/test';

// Mirrors backend/src/db/seed/e2eFixture.ts — keep in sync.
const FIXTURE_WORLD_VIEW = 9001;
const FIXTURE_REGION_ID = 9001;

test.describe('Explore Workflows @smoke', () => {
  test('map mode can open and close region explore panel', async ({ page }) => {
    // The region is in the address (#644), so the spec opens it directly.
    await page.goto('/wv/' + FIXTURE_WORLD_VIEW + '/r/' + FIXTURE_REGION_ID);

    await expect(page.getByRole('heading', { level: 2 })).not.toHaveText('Select a region');

    await page.getByRole('button', { name: 'Explore experiences in this region' }).click();

    await expect(page.getByText('Experiences')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close exploration' })).toBeVisible();
    await expect(page.getByText(/World Heritage Sites \(\d+\)/)).toBeVisible();

    await page.getByRole('button', { name: 'Close exploration' }).click();
    await expect(page.getByText('Experiences')).not.toBeVisible();
  });

  test('discover mode opens source workflow from region source tag', async ({ page }) => {
    await page.goto('/discover/wv/' + FIXTURE_WORLD_VIEW);

    await expect(page.getByText('Select a category in the tree')).toBeVisible();

    const sourceTag = page
      .locator('[aria-label*="UNESCO World Heritage Sites in"], [aria-label*="Top Art Museums in"], [aria-label*="Public Art & Monuments in"]')
      .first();

    await expect(sourceTag).toBeVisible();
    await sourceTag.click();

    await expect(page.getByRole('heading', { name: / in / })).toBeVisible();
    await expect(page.getByText(/\d+\s+experiences/)).toBeVisible();
    await expect(page.getByText('Select a category in the tree')).not.toBeVisible();
  });
});
