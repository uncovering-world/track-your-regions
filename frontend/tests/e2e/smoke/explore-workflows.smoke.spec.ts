import { expect, type Page, test } from '@playwright/test';

async function selectRootRegion(page: Page) {
  const regionButton = page.getByRole('button', { name: 'Africa' });
  if (await regionButton.count()) {
    await regionButton.first().click();
    return;
  }

  // Fallback for custom datasets/world views: pick first region-like nav entry.
  await page.locator('[role="button"]').first().click();
}

test.describe('Explore Workflows @smoke', () => {
  test('map mode can open and close region explore panel', async ({ page }) => {
    await page.goto('/');

    await selectRootRegion(page);
    await expect(page.getByRole('heading', { level: 2 })).not.toHaveText('Select a region');

    await page.getByRole('button', { name: 'Explore experiences in this region' }).click();

    await expect(page.getByText('Experiences')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close exploration' })).toBeVisible();
    await expect(page.getByText(/World Heritage Sites \(\d+\)/)).toBeVisible();

    await page.getByRole('button', { name: 'Close exploration' }).click();
    await expect(page.getByText('Experiences')).not.toBeVisible();
  });

  test('discover mode opens source workflow from region source tag', async ({ page }) => {
    await page.goto('/discover');

    await expect(page.getByText('Select a category in the tree')).toBeVisible();

    const sourceTag = page
      .locator('[aria-label*="UNESCO World Heritage Sites in"], [aria-label*="Top Museums in"], [aria-label*="Public Art & Monuments in"]')
      .first();

    await expect(sourceTag).toBeVisible();
    await sourceTag.click();

    await expect(page.getByRole('heading', { name: / in / })).toBeVisible();
    await expect(page.getByText(/\d+\s+experiences/)).toBeVisible();
    await expect(page.getByText('Select a category in the tree')).not.toBeVisible();
  });
});
